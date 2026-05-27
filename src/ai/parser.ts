import { generatedPaperSchema, GeneratedPaper } from "./paper.schema";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";

/**
 * Parse + validate the LLM response into our structured paper. Strips accidental code
 * fences, then validates against the Zod schema. Raw model text is NEVER surfaced.
 */
export function parsePaper(raw: string): GeneratedPaper {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    logger.warn(`AI returned non-JSON output (first 300 chars): ${cleaned.slice(0, 300)}`);
    throw ApiError.internal("AI returned invalid JSON");
  }

  const result = generatedPaperSchema.safeParse(json);
  if (!result.success) {
    // Log the exact field paths that failed so we never have to guess again.
    logger.warn(
      `schema validation failed at: ${result.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".")} (${i.message})`)
        .join("; ")}`
    );
    throw ApiError.internal("AI output failed schema validation", result.error.flatten());
  }
  return result.data;
}
