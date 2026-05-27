import { connectDB, disconnectDB } from "./config/db";
import { getRedis, closeRedis, isRedisConfigured } from "./config/redis";
import { logger } from "./utils/logger";

/**
 * Standalone BullMQ worker entrypoint. Runs the slow background jobs (AI generation,
 * PDF rendering) separately from the web server. Run with: `npm run worker`.
 *
 * Workers are registered here as later phases land. For now it just verifies it can
 * reach its dependencies so the process is ready to host queues.
 */
async function bootstrap() {
  if (!isRedisConfigured()) {
    logger.warn(
      "REDIS_URL not set — the worker needs Redis for BullMQ. Configure it, then restart."
    );
  }

  await connectDB();
  getRedis(); // initialize shared connection if configured

  // ── Register queue workers ──
  const { startGenerationWorker } = await import("./queues/generation.worker");
  startGenerationWorker();

  logger.info("👷 VedaAI worker running.");

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — worker shutting down...`);
    await disconnectDB();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error("Worker startup error", err);
  process.exit(1);
});
