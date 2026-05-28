import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { buildPrompt, buildSectionEditPrompt } from "./prompt.builder";
import { parsePaper } from "./parser";
import { mockPaper } from "./mock";
import { GeneratedPaper, EditQuestion, sectionEditSchema } from "./paper.schema";
import { GenerationInput } from "./types";

// Transient Gemini failures worth retrying: rate limit (429), and Google-side
// overload/outage (500/502/503/504). Anything else (400/401/403) is a real bug.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const MAX_DELAY_MS = 40_000;

/** Best-effort extraction of the HTTP status from a @google/genai error. */
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.code === "number") return e.code;
  const m = e?.message?.match(/"code"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Honor the server's `retryDelay` hint (sent on 429) if present, else exponential backoff. */
function backoffMs(err: unknown, attempt: number, maxDelayMs = MAX_DELAY_MS): number {
  const hint = (err as { message?: string })?.message?.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (hint) return Math.min((Number(hint[1]) + 1) * 1000, maxDelayMs);
  const base = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s, …
  return Math.min(base + Math.floor(Math.random() * 500), maxDelayMs); // + jitter
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RetryOpts {
  maxAttempts?: number;
  maxDelayMs?: number;
}

/**
 * Run a Gemini call, retrying transient failures with backoff.
 * Background jobs use the generous defaults; interactive calls (the section
 * editor) pass a small budget so the user isn't left waiting through a 30s
 * rate-limit backoff.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const maxDelayMs = opts.maxDelayMs ?? MAX_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      if (attempt === maxAttempts || status === undefined || !RETRYABLE_STATUS.has(status)) {
        throw err;
      }
      const delay = backoffMs(err, attempt, maxDelayMs);
      logger.warn(
        `Gemini ${label} failed (HTTP ${status}) — retrying in ${Math.round(delay / 1000)}s ` +
          `[attempt ${attempt}/${maxAttempts}]`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Where a generated paper came from — drives `generatedBy` + the UI "sample output" note. */
export type PaperSource = "gemini" | "mock" | "fallback";

export interface GenerateResult {
  paper: GeneratedPaper;
  source: PaperSource;
}

/**
 * Generate a structured question paper.
 * - No GEMINI_API_KEY      → deterministic mock (full pipeline still works).
 * - Key present            → calls Gemini with structured-JSON output, attaching the
 *                            uploaded PDF/image inline when provided (Gemini is multimodal).
 * - Gemini fails entirely  → falls back to the mock (source: "fallback") so generation
 *                            NEVER hard-fails for the user; the UI surfaces a note.
 */
export async function generatePaper(input: GenerationInput): Promise<GenerateResult> {
  if (!env.geminiKey) {
    logger.warn("GEMINI_API_KEY not set — using mock generator.");
    return { paper: mockPaper(input), source: "mock" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiKey });
    const { systemInstruction, userPrompt } = buildPrompt(input);

    // Single user turn: text prompt (+ optional inline document/image).
    const parts: Array<Record<string, unknown>> = [{ text: userPrompt }];
    if (input.file) {
      parts.push({
        inlineData: {
          mimeType: input.file.mimeType,
          data: input.file.buffer.toString("base64"),
        },
      });
    }

    const generateOnce = () =>
      withRetry("generateContent", () =>
        ai.models.generateContent({
          model: env.GEMINI_MODEL,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contents: parts as any,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        })
      );

    // The model occasionally returns JSON that doesn't fit our schema (more likely on
    // lighter models like flash-lite). Regenerate once before giving up.
    const MAX_PARSE_ATTEMPTS = 2;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      const response = await generateOnce();
      try {
        return { paper: parsePaper(response.text ?? ""), source: "gemini" };
      } catch (err) {
        lastErr = err;
        logger.warn(
          `paper failed parsing/validation (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}) — ` +
            `${(err as Error).message}${attempt < MAX_PARSE_ATTEMPTS ? "; regenerating" : ""}`
        );
      }
    }
    throw lastErr;
  } catch (err) {
    // Last resort: rate limit exhausted, outage, revoked key, or unparseable output.
    // Return a valid sample paper so the user always gets something (clearly marked).
    logger.error(
      `Gemini generation failed after all attempts — falling back to a sample paper. ` +
        `${(err as Error)?.message ?? err}`
    );
    return { paper: mockPaper(input), source: "fallback" };
  }
}

export interface SectionEditInput {
  subject: string;
  className: string;
  sectionTitle: string;
  sectionInstruction: string;
  questions: { text: string; marks: number; options: string[] }[];
  instruction: string;
}

/** Lightly-revised questions — served when no key is set OR Gemini is unavailable. */
function revisedSectionFallback(input: SectionEditInput): EditQuestion[] {
  return input.questions.map((q) => ({
    text: `${q.text} (revised)`,
    difficulty: "moderate" as const,
    marks: q.marks,
    options: q.options ?? [],
    answer: q.options?.length ? q.options[0] : "Updated sample answer.",
  }));
}

/**
 * Regenerate the questions (+ answers) of a single section for the editor.
 *
 * This runs synchronously inside the HTTP request (the user is waiting on it),
 * so unlike full generation it uses a SMALL retry budget — failing fast rather
 * than honoring a 30s rate-limit backoff that would blow past the client timeout.
 * It also NEVER throws: on a missing key, rate-limit exhaustion, outage, or bad
 * output it returns lightly-revised questions so the editor degrades gracefully
 * instead of surfacing a 500.
 */
export async function regenerateSectionQuestions(input: SectionEditInput): Promise<EditQuestion[]> {
  if (!env.geminiKey) {
    logger.warn("GEMINI_API_KEY not set — using mock section editor.");
    return revisedSectionFallback(input);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiKey });
    const { systemInstruction, userPrompt } = buildSectionEditPrompt(input);

    const response = await withRetry(
      "regenerateSection",
      () =>
        ai.models.generateContent({
          model: env.GEMINI_MODEL,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contents: [{ text: userPrompt }] as any,
          config: { systemInstruction, responseMimeType: "application/json", temperature: 0.7 },
        }),
      { maxAttempts: 2, maxDelayMs: 4_000 } // interactive: one quick retry, then give up
    );

    const cleaned = (response.text ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const json = JSON.parse(cleaned);
    const parsed = sectionEditSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        `section edit validation failed at: ${parsed.error.issues
          .slice(0, 6)
          .map((i) => i.path.join("."))
          .join("; ")}`
      );
      throw new Error("AI output failed schema validation while editing the section");
    }
    return parsed.data.questions;
  } catch (err) {
    logger.error(
      `Gemini section regenerate failed — returning revised fallback. ${(err as Error)?.message ?? err}`
    );
    return revisedSectionFallback(input);
  }
}
