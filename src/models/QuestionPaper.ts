import { Schema, model, InferSchemaType, Types } from "mongoose";

export const DIFFICULTY = ["easy", "moderate", "hard"] as const;

const questionSchema = new Schema(
  {
    text: { type: String, required: true },
    difficulty: { type: String, enum: DIFFICULTY, default: "moderate" },
    marks: { type: Number, required: true, min: 0 },
    options: { type: [String], default: [] }, // MCQ choices; empty for non-MCQ
  },
  { _id: false }
);

const sectionSchema = new Schema(
  {
    title: { type: String, required: true }, // "Section A"
    instruction: { type: String, default: "" }, // "Attempt all questions..."
    questions: { type: [questionSchema], default: [] },
  },
  { _id: false }
);

const answerSchema = new Schema(
  {
    index: { type: Number, required: true }, // question number
    answer: { type: String, required: true },
  },
  { _id: false }
);

const metaSchema = new Schema(
  {
    school: { type: String, default: "" },
    subject: { type: String, default: "" },
    class: { type: String, default: "" },
    timeAllowed: { type: String, default: "" }, // "45 minutes"
    maxMarks: { type: Number, default: 0 },
  },
  { _id: false }
);

const questionPaperSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    meta: { type: metaSchema, default: {} },
    sections: { type: [sectionSchema], default: [] },
    answerKey: { type: [answerSchema], default: [] },
    generatedBy: { type: String, default: "" }, // model id
    status: { type: String, enum: ["completed", "failed"], default: "completed" },
  },
  { timestamps: true }
);

export type QuestionPaperDoc = InferSchemaType<typeof questionPaperSchema> & {
  _id: Types.ObjectId;
};

export const QuestionPaper = model("QuestionPaper", questionPaperSchema);
