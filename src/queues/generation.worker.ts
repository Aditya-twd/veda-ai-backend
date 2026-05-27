import { Worker } from "bullmq";
import fs from "fs/promises";
import { makeQueueConnection, GENERATION_QUEUE } from "./connection";
import { GenerationJobData } from "./generation.queue";
import { publishEvent } from "./events.bridge";
import { Assignment } from "../models/Assignment";
import { QuestionPaper } from "../models/QuestionPaper";
import { User } from "../models/User";
import { generatePaper } from "../ai/gemini.client";
import { GenerationInput } from "../ai/types";
import { logger } from "../utils/logger";

/** Registers the generation worker. Called from the worker process (src/worker.ts). */
export function startGenerationWorker(): Worker<GenerationJobData> | null {
  const connection = makeQueueConnection();
  if (!connection) {
    logger.warn("Cannot start generation worker — Redis not configured.");
    return null;
  }

  const worker = new Worker<GenerationJobData>(
    GENERATION_QUEUE,
    async (job) => {
      const { assignmentId } = job.data;
      logger.info(`▶️  generating paper for assignment ${assignmentId}`);

      const assignment = await Assignment.findById(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);

      publishEvent({ type: "started", payload: { assignmentId } });
      assignment.status = "generating";
      await assignment.save();
      publishEvent({
        type: "progress",
        payload: { assignmentId, percent: 25, stage: "Reading inputs" },
      });

      const user = await User.findById(assignment.userId);
      const school = user?.school?.name || "School";

      // Load uploaded file (if any) so Gemini can read it.
      let file: GenerationInput["file"];
      if (assignment.file?.path) {
        try {
          const buffer = await fs.readFile(assignment.file.path);
          file = { mimeType: assignment.file.mimeType || "application/pdf", buffer };
        } catch (e) {
          logger.warn(`Could not read uploaded file: ${(e as Error).message}`);
        }
      }

      publishEvent({
        type: "progress",
        payload: { assignmentId, percent: 50, stage: "Generating questions" },
      });

      const paper = await generatePaper({
        title: assignment.title,
        questionTypes: assignment.questionTypes,
        totalQuestions: assignment.totalQuestions,
        totalMarks: assignment.totalMarks,
        additionalInstructions: assignment.additionalInstructions,
        dueDate: assignment.dueDate,
        school,
        file,
      });

      publishEvent({
        type: "progress",
        payload: { assignmentId, percent: 80, stage: "Saving paper" },
      });

      const saved = await QuestionPaper.create({
        assignmentId: assignment._id,
        userId: assignment.userId,
        meta: { ...paper.meta, school },
        sections: paper.sections,
        answerKey: paper.answerKey,
        generatedBy: process.env.GEMINI_API_KEY ? process.env.GEMINI_MODEL || "gemini" : "mock",
        status: "completed",
      });

      assignment.status = "completed";
      assignment.paperId = saved._id;
      await assignment.save();

      publishEvent({
        type: "completed",
        payload: { assignmentId, paperId: saved._id.toString() },
      });
      logger.info(`✅ paper ${saved._id} ready for assignment ${assignmentId}`);

      return { paperId: saved._id.toString() };
    },
    { connection, concurrency: 3 }
  );

  worker.on("failed", async (job, err) => {
    const assignmentId = job?.data.assignmentId;
    logger.error(`generation failed (${assignmentId}): ${err.message}`);
    if (assignmentId) {
      // Only mark failed after the last attempt.
      if (!job || job.attemptsMade >= (job.opts.attempts ?? 1)) {
        await Assignment.findByIdAndUpdate(assignmentId, { status: "failed" }).catch(() => {});
        publishEvent({ type: "failed", payload: { assignmentId, message: err.message } });
      }
    }
  });

  logger.info("✅ generation worker listening");
  return worker;
}
