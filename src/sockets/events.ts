/** Socket.IO event names + payload types shared between server and (future) client. */

export const SOCKET_EVENTS = {
  // client → server
  SUBSCRIBE: "subscribe", // { assignmentId }
  UNSUBSCRIBE: "unsubscribe",
  // server → client
  GENERATION_STARTED: "generation:started",
  GENERATION_PROGRESS: "generation:progress",
  GENERATION_COMPLETED: "generation:completed",
  GENERATION_FAILED: "generation:failed",
} as const;

export type GenerationStarted = { assignmentId: string };
export type GenerationProgress = { assignmentId: string; percent: number; stage: string };
export type GenerationCompleted = { assignmentId: string; paperId: string };
export type GenerationFailed = { assignmentId: string; message: string };

/** Room name a client joins to receive updates for one assignment. */
export const assignmentRoom = (assignmentId: string) => `assignment:${assignmentId}`;
