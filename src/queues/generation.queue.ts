import { Queue } from "bullmq";
import { makeQueueConnection, GENERATION_QUEUE } from "./connection";
import { ApiError } from "../utils/ApiError";

export interface GenerationJobData {
  assignmentId: string;
}

let queue: Queue<GenerationJobData> | null = null;

function getQueue(): Queue<GenerationJobData> | null {
  if (queue) return queue;
  const connection = makeQueueConnection();
  if (!connection) return null;
  queue = new Queue<GenerationJobData>(GENERATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return queue;
}

/** Enqueue an AI generation job. Returns the BullMQ job id. */
export async function addGenerationJob(assignmentId: string): Promise<string> {
  const q = getQueue();
  if (!q) {
    throw ApiError.internal("Generation queue unavailable — Redis is not configured.");
  }
  const job = await q.add("generate", { assignmentId });
  return job.id as string;
}

export function isQueueAvailable(): boolean {
  return getQueue() !== null;
}
