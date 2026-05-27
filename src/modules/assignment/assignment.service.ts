import { FilterQuery } from "mongoose";
import { Assignment, AssignmentDoc } from "../../models/Assignment";
import { QuestionPaper } from "../../models/QuestionPaper";
import { ApiError } from "../../utils/ApiError";
import { addGenerationJob } from "../../queues/generation.queue";
import { CreateAssignmentBody, parseDate } from "./assignment.validation";

export async function createAssignment(userId: string, body: CreateAssignmentBody) {
  const assignment = await Assignment.create({
    userId,
    title: body.title,
    dueDate: parseDate(body.dueDate),
    questionTypes: body.questionTypes,
    additionalInstructions: body.additionalInstructions ?? "",
    file: body.file,
    status: "draft",
  });
  return assignment;
}

export async function listAssignments(
  userId: string,
  opts: { q?: string; status?: string; page: number; limit: number }
) {
  const filter: FilterQuery<AssignmentDoc> = { userId };
  // Hide failed generations from the list unless a status is explicitly requested.
  if (opts.status) filter.status = opts.status;
  else filter.status = { $ne: "failed" };
  if (opts.q) filter.title = { $regex: opts.q, $options: "i" };

  const skip = (opts.page - 1) * opts.limit;
  const [items, total] = await Promise.all([
    Assignment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(opts.limit).lean(),
    Assignment.countDocuments(filter),
  ]);

  return { items, total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) };
}

export async function getAssignment(userId: string, id: string) {
  const assignment = await Assignment.findOne({ _id: id, userId }).lean();
  if (!assignment) throw ApiError.notFound("Assignment not found");
  return assignment;
}

export async function deleteAssignment(userId: string, id: string) {
  const assignment = await Assignment.findOneAndDelete({ _id: id, userId });
  if (!assignment) throw ApiError.notFound("Assignment not found");
  if (assignment.paperId) await QuestionPaper.deleteOne({ _id: assignment.paperId }).catch(() => {});
  return { id };
}

/** Move an assignment into the generation queue. */
export async function queueGeneration(userId: string, id: string) {
  const assignment = await Assignment.findOne({ _id: id, userId });
  if (!assignment) throw ApiError.notFound("Assignment not found");
  if (assignment.status === "generating" || assignment.status === "queued") {
    throw ApiError.badRequest("Generation already in progress");
  }

  const jobId = await addGenerationJob(assignment.id);
  assignment.status = "queued";
  assignment.jobId = jobId;
  await assignment.save();

  return { assignmentId: assignment.id, jobId, status: assignment.status };
}
