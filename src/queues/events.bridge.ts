import IORedis, { Redis } from "ioredis";
import { env } from "../config/env";
import { emit } from "../config/socket";
import { logger } from "../utils/logger";
import {
  GenerationStarted,
  GenerationProgress,
  GenerationCompleted,
  GenerationFailed,
} from "../sockets/events";

/**
 * The BullMQ worker runs in a separate process from the web server (which owns the
 * Socket.IO instance). So the worker PUBLISHES generation events to a Redis channel,
 * and the web process SUBSCRIBES and re-emits them through Socket.IO. Works regardless
 * of whether the worker is in-process or standalone.
 */
const CHANNEL = "vedaai:generation-events";

type EventMsg =
  | { type: "started"; payload: GenerationStarted }
  | { type: "progress"; payload: GenerationProgress }
  | { type: "completed"; payload: GenerationCompleted }
  | { type: "failed"; payload: GenerationFailed };

let pub: Redis | null = null;

/** Called by the worker. */
export function publishEvent(msg: EventMsg): void {
  if (!env.redisUrl) return;
  if (!pub) pub = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  pub.publish(CHANNEL, JSON.stringify(msg)).catch((e) =>
    logger.error("publishEvent failed", (e as Error).message)
  );
}

/** Called once by the web process after Socket.IO is initialized. */
export function startEventBridge(): void {
  if (!env.redisUrl) return;
  const sub = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  sub.subscribe(CHANNEL, (err) => {
    if (err) logger.error("Event bridge subscribe failed", err.message);
    else logger.info("✅ Event bridge subscribed (Redis → Socket.IO)");
  });
  sub.on("message", (_channel, raw) => {
    try {
      const msg = JSON.parse(raw) as EventMsg;
      switch (msg.type) {
        case "started":
          return emit.started(msg.payload);
        case "progress":
          return emit.progress(msg.payload);
        case "completed":
          return emit.completed(msg.payload);
        case "failed":
          return emit.failed(msg.payload);
      }
    } catch (e) {
      logger.error("Event bridge parse error", (e as Error).message);
    }
  });
}
