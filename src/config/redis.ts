import IORedis, { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "../utils/logger";

let client: Redis | null = null;

/**
 * Lazily create a shared Redis connection if REDIS_URL is configured.
 * BullMQ needs `maxRetriesPerRequest: null`. Returns null when Redis is not set up
 * so the rest of the app can degrade gracefully during early development.
 */
export function getRedis(): Redis | null {
  if (client) return client;
  if (!env.redisUrl) {
    logger.warn("REDIS_URL not set — Redis/queues disabled (configure it later).");
    return null;
  }

  client = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on("connect", () => logger.info("✅ Redis connected"));
  client.on("error", (err) => logger.error("Redis error", err.message));

  return client;
}

export function isRedisConfigured(): boolean {
  return Boolean(env.redisUrl);
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
