import mongoose from "mongoose";
import { connectDB, disconnectDB, isDbConnected } from "./config/db";
import { User } from "./models/User";
import { DEMO_USER_ID } from "./middleware/auth.middleware";
import { logger } from "./utils/logger";

/**
 * Seeds the demo teacher used by the stub auth (matches the frontend's
 * "John Doe / Delhi Public School"). Run with: `npm run seed`.
 * Safe to run repeatedly (idempotent upsert).
 */
async function seed() {
  await connectDB();
  if (!isDbConnected()) {
    logger.error("Cannot seed — MongoDB is not connected. Set MONGODB_URI in .env first.");
    process.exit(1);
  }

  const _id = new mongoose.Types.ObjectId(DEMO_USER_ID);

  await User.updateOne(
    { _id },
    {
      $setOnInsert: {
        _id,
        name: "John Doe",
        email: "john.doe@dps-bokaro.edu",
        role: "teacher",
        provider: "demo",
        onboarded: true,
        school: { name: "Delhi Public School", location: "Bokaro Steel City", sector: "Sector-4" },
        avatarUrl: "",
      },
    },
    { upsert: true }
  );

  logger.info(`✅ Seeded demo user (${_id.toString()})`);
  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  logger.error("Seed failed", err);
  process.exit(1);
});
