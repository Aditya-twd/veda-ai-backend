import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { connectDB, disconnectDB } from "./config/db";
import { closeRedis } from "./config/redis";
import { initSocket } from "./config/socket";
import { startEventBridge } from "./queues/events.bridge";
import { logger } from "./utils/logger";

async function bootstrap() {
  // Connect data stores if configured (server still boots if they're not).
  await connectDB();

  const app = createApp();
  const server = http.createServer(app);

  // Realtime: attach Socket.IO and bridge worker events (Redis → sockets).
  initSocket(server);
  startEventBridge();

  server.listen(env.PORT, () => {
    logger.info(`🚀 VedaAI API listening on http://localhost:${env.PORT}`);
    logger.info(`   Health: http://localhost:${env.PORT}/api/health`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down...`);
    server.close(async () => {
      await disconnectDB();
      await closeRedis();
      process.exit(0);
    });
    // force-exit if it hangs
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});
