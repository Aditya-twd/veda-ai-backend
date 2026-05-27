import IORedis, { Redis } from "ioredis";
import { env } from "../config/env";

/**
 * BullMQ requires `maxRetriesPerRequest: null`. Queue and Worker should each get their
 * own connection, so this is a factory (not a shared singleton).
 */
export function makeQueueConnection(): Redis | null {
  if (!env.redisUrl) return null;
  return new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
}

export const GENERATION_QUEUE = "generation";
