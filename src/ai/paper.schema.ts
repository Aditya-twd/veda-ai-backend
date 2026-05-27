import { z } from "zod";

/**
 * Zod schema the LLM output must satisfy. We deliberately COERCE common model
 * deviations rather than rejecting the whole paper — e.g. True/False questions
 * often come back as `options: [true, false]` or `answer: true`, difficulties as
 * "Medium"/"Challenging", and marks as "2" (string). Being lenient here keeps a
 * single stray field from failing an otherwise-good paper.
 */

/** Coerce numbers/booleans to plain strings; leave other types untouched. */
const toText = (v: unknown): unknown =>
  typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : v;

/** Coerce to a finite number, falling back to `fallback`. */
const toNum = (v: unknown, fallback: number): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "boolean" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

// "Medium"/"Difficult"/"Challenging"/etc → our three buckets; unknown → moderate.
export const difficultyEnum = z.preprocess((v) => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (["easy", "simple", "basic", "low"].includes(s)) return "easy";
  if (["hard", "difficult", "challenging", "tough", "advanced", "high"].includes(s)) return "hard";
  return "moderate"; // moderate / medium / intermediate / anything else
}, z.enum(["easy", "moderate", "hard"]));

const marksSchema = z
  .preprocess((v) => toNum(v, 1), z.number())
  .transform((n) => Math.max(0, Math.round(n)));

// True/False → [true,false] etc: stringify each option, drop empties/non-coercibles.
const optionsSchema = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v.map(toText).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [],
  z.array(z.string())
);

export const questionSchema = z.object({
  text: z.preprocess(toText, z.string().min(1)),
  difficulty: difficultyEnum.default("moderate"),
  marks: marksSchema.default(1),
  options: optionsSchema.default([]),
});

export const sectionSchema = z.object({
  title: z.preprocess(toText, z.string().min(1)),
  instruction: z.preprocess(toText, z.string()).default(""),
  questions: z.array(questionSchema).min(1),
});

export const answerSchema = z.object({
  index: z.preprocess((v) => toNum(v, 0), z.number().int()),
  answer: z.preprocess(toText, z.string().min(1)),
});

// Drop individual malformed answer-key entries instead of failing the whole paper.
const answerKeySchema = z
  .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()))
  .transform((arr) =>
    arr.flatMap((item) => {
      const parsed = answerSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
  );

export const paperMetaSchema = z.object({
  subject: z.preprocess(toText, z.string()).default(""),
  class: z.preprocess(toText, z.string()).default(""),
  timeAllowed: z.preprocess(toText, z.string()).default(""),
  maxMarks: z
    .preprocess((v) => toNum(v, 0), z.number())
    .transform((n) => Math.max(0, Math.round(n)))
    .default(0),
});

export const generatedPaperSchema = z.object({
  meta: paperMetaSchema.default({}),
  sections: z.array(sectionSchema).min(1),
  answerKey: answerKeySchema.default([]),
});

export type GeneratedPaper = z.infer<typeof generatedPaperSchema>;

// ── Section editing (AI Teacher's Toolkit) ──
// A question bundled with its model answer — what the AI returns when regenerating
// a single section, so the editor can slot answers straight back in.
export const editQuestionSchema = questionSchema.extend({
  answer: z.preprocess(toText, z.string()).default(""),
});
export const sectionEditSchema = z.object({
  questions: z.array(editQuestionSchema).min(1),
});
export type EditQuestion = z.infer<typeof editQuestionSchema>;
