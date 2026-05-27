import { Schema, model, InferSchemaType, Types } from "mongoose";

const schoolSchema = new Schema(
  {
    name: { type: String, required: true }, // "Delhi Public School"
    location: { type: String, default: "" }, // "Bokaro Steel City"
    sector: { type: String, default: "" }, // "Sector-4"
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String }, // unused (OAuth only) — kept for future password auth
    googleId: { type: String, index: true, sparse: true }, // Google account `sub`
    provider: { type: String, enum: ["google", "demo"], default: "google" },
    role: { type: String, enum: ["teacher", "admin"], default: "teacher" },
    // Optional: Google users have no school until they complete onboarding.
    school: { type: schoolSchema, required: false },
    onboarded: { type: Boolean, default: false }, // false until the school is set
    avatarUrl: { type: String, default: "" }, // Google `picture` URL
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User = model("User", userSchema);
