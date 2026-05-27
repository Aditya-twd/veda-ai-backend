import { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { env } from "./env";
import { logger } from "../utils/logger";
import {
  SOCKET_EVENTS,
  assignmentRoom,
  GenerationStarted,
  GenerationProgress,
  GenerationCompleted,
  GenerationFailed,
} from "../sockets/events";

let io: IOServer | null = null;

/** Attach Socket.IO to the HTTP server. Clients subscribe to per-assignment rooms. */
export function initSocket(server: HttpServer): IOServer {
  io = new IOServer(server, {
    cors: { origin: env.isProd ? env.clientOrigins : true, credentials: true },
  });

  io.on("connection", (socket) => {
    logger.debug(`socket connected: ${socket.id}`);

    socket.on(SOCKET_EVENTS.SUBSCRIBE, (payload: { assignmentId?: string }) => {
      if (payload?.assignmentId) {
        socket.join(assignmentRoom(payload.assignmentId));
        logger.debug(`socket ${socket.id} subscribed to ${payload.assignmentId}`);
      }
    });

    socket.on(SOCKET_EVENTS.UNSUBSCRIBE, (payload: { assignmentId?: string }) => {
      if (payload?.assignmentId) socket.leave(assignmentRoom(payload.assignmentId));
    });
  });

  logger.info("✅ Socket.IO initialized");
  return io;
}

export function getIO(): IOServer | null {
  return io;
}

/**
 * Emit helpers. These work from the web process. The BullMQ worker runs in a separate
 * process, so it publishes via Redis pub/sub instead (see queues/events.bridge.ts) — but
 * when the worker runs in-process (dev convenience) these are used directly.
 */
export const emit = {
  started(p: GenerationStarted) {
    io?.to(assignmentRoom(p.assignmentId)).emit(SOCKET_EVENTS.GENERATION_STARTED, p);
  },
  progress(p: GenerationProgress) {
    io?.to(assignmentRoom(p.assignmentId)).emit(SOCKET_EVENTS.GENERATION_PROGRESS, p);
  },
  completed(p: GenerationCompleted) {
    io?.to(assignmentRoom(p.assignmentId)).emit(SOCKET_EVENTS.GENERATION_COMPLETED, p);
  },
  failed(p: GenerationFailed) {
    io?.to(assignmentRoom(p.assignmentId)).emit(SOCKET_EVENTS.GENERATION_FAILED, p);
  },
};
