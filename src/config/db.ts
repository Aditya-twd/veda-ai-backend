import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

let connected = false;

/**
 * Connect to MongoDB *if* MONGODB_URI is configured. The server is allowed to run
 * without a database during early development — endpoints that need the DB will
 * report it clearly via `isDbConnected()`.
 */
export async function connectDB(): Promise<void> {
  if (!env.mongoUri) {
    logger.warn("MONGODB_URI not set — skipping DB connection (configure it later).");
    return;
  }

  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    connected = true;
    logger.info("✅ MongoDB connected");

    mongoose.connection.on("disconnected", () => {
      connected = false;
      logger.warn("MongoDB disconnected");
    });
    mongoose.connection.on("reconnected", () => {
      connected = true;
      logger.info("MongoDB reconnected");
    });
  } catch (err) {
    connected = false;
    logger.error("MongoDB connection failed — continuing without DB.", (err as Error).message);
  }
}

export function isDbConnected(): boolean {
  return connected && mongoose.connection.readyState === 1;
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    connected = false;
  }
}
