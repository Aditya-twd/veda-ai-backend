import { Schema, model, InferSchemaType, Types } from "mongoose";

const questionTypeSchema = new Schema(
  {
    type: { type: String, required: true }, // "Multiple Choice Questions"
    numQuestions: { type: Number, required: true, min: 1 },
    marks: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const fileSchema = new Schema(
  {
    originalName: String,
    mimeType: String,
    path: String,
    size: Number,
  },
  { _id: false }
);

export const ASSIGNMENT_STATUS = [
  "draft",
  "queued",
  "generating",
  "completed",
  "failed",
] as const;

const assignmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    file: { type: fileSchema, default: undefined }, // optional uploaded PDF/image
    dueDate: { type: Date },
    questionTypes: {
      type: [questionTypeSchema],
      validate: [(v: unknown[]) => v.length > 0, "At least one question type is required"],
    },
    additionalInstructions: { type: String, default: "" },
    totalQuestions: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    status: { type: String, enum: ASSIGNMENT_STATUS, default: "draft", index: true },
    jobId: { type: String },
    paperId: { type: Schema.Types.ObjectId, ref: "QuestionPaper" },
  },
  { timestamps: true }
);

// Keep totals in sync whenever question types change.
assignmentSchema.pre("save", function (next) {
  if (this.isModified("questionTypes")) {
    this.totalQuestions = this.questionTypes.reduce((s, q) => s + q.numQuestions, 0);
    this.totalMarks = this.questionTypes.reduce((s, q) => s + q.numQuestions * q.marks, 0);
  }
  next();
});

export type AssignmentDoc = InferSchemaType<typeof assignmentSchema> & {
  _id: Types.ObjectId;
};

export const Assignment = model("Assignment", assignmentSchema);
