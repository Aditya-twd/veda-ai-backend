/** Input to the AI generator, assembled by the worker from an Assignment + its owner. */
export interface QuestionTypeInput {
  type: string;
  numQuestions: number;
  marks: number;
}

export interface GenerationInput {
  title: string;
  questionTypes: QuestionTypeInput[];
  totalQuestions: number;
  totalMarks: number;
  additionalInstructions?: string;
  dueDate?: Date | null;
  school: string;
  /** Optional uploaded source material (PDF/image) — Gemini reads it natively. */
  file?: { mimeType: string; buffer: Buffer };
}
