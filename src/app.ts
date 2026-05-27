import express, { Request, Response } from "express";
import cors from "cors";
import { env } from "./config/env";
import { isDbConnected } from "./config/db";
import { isRedisConfigured } from "./config/redis";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware";
import authRoutes from "./modules/auth/auth.routes";
import assignmentRoutes from "./modules/assignment/assignment.routes";
import paperRoutes from "./modules/paper/paper.routes";
import uploadRoutes from "./modules/upload/upload.routes";

export function createApp() {
  const app = express();

  app.use(
    cors({
      // In dev, reflect any origin so the frontend works on any port/host.
      // In production, restrict to the configured CLIENT_URL list.
      origin: env.isProd ? env.clientOrigins : true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health check — reports the state of each subsystem.
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        status: "ok",
        uptime: process.uptime(),
        services: {
          mongo: isDbConnected() ? "connected" : "not-configured",
          redis: isRedisConfigured() ? "configured" : "not-configured",
          gemini: env.geminiKey ? "configured" : "not-configured",
        },
        env: env.NODE_ENV,
      },
    });
  });

  // ── Feature routes ──
  app.use("/api/auth", authRoutes);
  app.use("/api/assignments", assignmentRoutes);
  app.use("/api/papers", paperRoutes);
  app.use("/api/upload", uploadRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
