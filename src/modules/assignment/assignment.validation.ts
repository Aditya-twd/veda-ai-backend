import { z } from "zod";

/** No empty / negative values, per the brief. */
const questionTypeSchema = z.object({
  type: z.string().trim().min(1, "Question type is required"),
  numQuestions: z.number().int("Must be a whole number").positive("Must be greater than 0"),
  marks: z.number().int("Must be a whole number").positive("Must be greater than 0"),
});

const fileSchema = z.object({
  originalName: z.string(),
  mimeType: z.string(),
  path: z.string(),
  size: z.number().nonnegative(),
});

export const createAssignmentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1, "Title is required"),
    dueDate: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || !Number.isNaN(parseDate(v)?.getTime()), "Invalid date"),
    questionTypes: z.array(questionTypeSchema).min(1, "Add at least one question type"),
    additionalInstructions: z.string().trim().optional().default(""),
    file: fileSchema.optional(),
  }),
});

export const listAssignmentsSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  }),
});

export type CreateAssignmentBody = z.infer<typeof createAssignmentSchema>["body"];

/** Accepts DD-MM-YYYY (frontend format) or any Date-parseable string. */
export function parseDate(input?: string): Date | undefined {
  if (!input) return undefined;
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(input);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
