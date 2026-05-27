import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ApiError } from "../utils/ApiError";
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
function backoffMs(err: unknown, attempt: number): number {
  const hint = (err as { message?: string })?.message?.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (hint) return Math.min((Number(hint[1]) + 1) * 1000, MAX_DELAY_MS);
  const base = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s, …
  return Math.min(base + Math.floor(Math.random() * 500), MAX_DELAY_MS); // + jitter
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a Gemini call, retrying transient failures with backoff. */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      if (attempt === MAX_ATTEMPTS || status === undefined || !RETRYABLE_STATUS.has(status)) {
        throw err;
      }
      const delay = backoffMs(err, attempt);
      logger.warn(
        `Gemini ${label} failed (HTTP ${status}) — retrying in ${Math.round(delay / 1000)}s ` +
          `[attempt ${attempt}/${MAX_ATTEMPTS}]`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Generate a structured question paper.
 * - No GEMINI_API_KEY  → deterministic mock (full pipeline still works).
 * - Key present        → calls Gemini with structured-JSON output, attaching the
 *                         uploaded PDF/image inline when provided (Gemini is multimodal).
 */
export async function generatePaper(input: GenerationInput): Promise<GeneratedPaper> {
  if (!env.geminiKey) {
    logger.warn("GEMINI_API_KEY not set — using mock generator.");
    return mockPaper(input);
  }

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
      return parsePaper(response.text ?? "");
    } catch (err) {
      lastErr = err;
      logger.warn(
        `paper failed parsing/validation (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}) — ` +
          `${(err as Error).message}${attempt < MAX_PARSE_ATTEMPTS ? "; regenerating" : ""}`
      );
    }
  }
  throw lastErr;
}

export interface SectionEditInput {
  subject: string;
  className: string;
  sectionTitle: string;
  sectionInstruction: string;
  questions: { text: string; marks: number; options: string[] }[];
  instruction: string;
}

/**
 * Regenerate the questions (+ answers) of a single section for the editor.
 * Falls back to a lightly-revised mock when no GEMINI_API_KEY is set.
 */
export async function regenerateSectionQuestions(input: SectionEditInput): Promise<EditQuestion[]> {
  if (!env.geminiKey) {
    logger.warn("GEMINI_API_KEY not set — using mock section editor.");
    return input.questions.map((q) => ({
      text: `${q.text} (revised)`,
      difficulty: "moderate" as const,
      marks: q.marks,
      options: q.options ?? [],
      answer: q.options?.length ? q.options[0] : "Updated sample answer.",
    }));
  }

  const ai = new GoogleGenAI({ apiKey: env.geminiKey });
  const { systemInstruction, userPrompt } = buildSectionEditPrompt(input);

  const response = await withRetry("regenerateSection", () =>
    ai.models.generateContent({
      model: env.GEMINI_MODEL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: [{ text: userPrompt }] as any,
      config: { systemInstruction, responseMimeType: "application/json", temperature: 0.7 },
    })
  );

  const cleaned = (response.text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw ApiError.internal("AI returned invalid JSON while editing the section");
  }
  const parsed = sectionEditSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn(
      `section edit validation failed at: ${parsed.error.issues
        .slice(0, 6)
        .map((i) => i.path.join("."))
        .join("; ")}`
    );
    throw ApiError.internal("AI output failed schema validation while editing the section");
  }
  return parsed.data.questions;
}
