import { QuestionPaper } from "../../models/QuestionPaper";
import { ApiError } from "../../utils/ApiError";
import { regenerateSectionQuestions } from "../../ai/gemini.client";
import { GeneratedPaper } from "../../ai/paper.schema";

export async function getPaper(userId: string, id: string) {
  const paper = await QuestionPaper.findOne({ _id: id, userId }).lean();
  if (!paper) throw ApiError.notFound("Question paper not found");
  return paper;
}

export async function getPaperByAssignment(userId: string, assignmentId: string) {
  const paper = await QuestionPaper.findOne({ assignmentId, userId })
    .sort({ createdAt: -1 })
    .lean();
  if (!paper) throw ApiError.notFound("No paper generated for this assignment yet");
  return paper;
}

/** Full Mongoose document (not lean) — used by the PDF renderer. */
export async function getPaperDoc(userId: string, id: string) {
  const paper = await QuestionPaper.findOne({ _id: id, userId });
  if (!paper) throw ApiError.notFound("Question paper not found");
  return paper;
}

/**
 * Save edits to a paper (AI Teacher's Toolkit). The client sends the full validated
 * paper shape; we keep the existing `school`, recompute `maxMarks` from the sections,
 * and overwrite sections + answerKey.
 */
export async function updatePaper(userId: string, id: string, data: GeneratedPaper) {
  const paper = await QuestionPaper.findOne({ _id: id, userId });
  if (!paper) throw ApiError.notFound("Question paper not found");

  const maxMarks = data.sections.reduce(
    (total, s) => total + s.questions.reduce((sum, q) => sum + (q.marks || 0), 0),
    0
  );

  paper.set("meta.subject", data.meta.subject);
  paper.set("meta.class", data.meta.class);
  paper.set("meta.timeAllowed", data.meta.timeAllowed);
  paper.set("meta.maxMarks", maxMarks); // authoritative — derived from the questions
  paper.set("sections", data.sections);
  paper.set("answerKey", data.answerKey);
  await paper.save();
  return paper.toObject();
}

/** Regenerate one section's questions (+ answers) with AI. */
export async function regenerateSection(
  userId: string,
  id: string,
  sectionIndex: number,
  instruction: string
) {
  const paper = await QuestionPaper.findOne({ _id: id, userId });
  if (!paper) throw ApiError.notFound("Question paper not found");
  const section = paper.sections[sectionIndex];
  if (!section) throw ApiError.badRequest("Section not found");

  const questions = await regenerateSectionQuestions({
    subject: paper.meta?.subject || "",
    className: paper.meta?.class || "",
    sectionTitle: section.title,
    sectionInstruction: section.instruction || "",
    questions: section.questions.map((q) => ({
      text: q.text,
      marks: q.marks,
      options: q.options || [],
    })),
    instruction,
  });

  return { questions };
}
