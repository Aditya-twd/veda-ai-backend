import mongoose from "mongoose";
import { OAuth2Client } from "google-auth-library";
import { User, UserDoc } from "../../models/User";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { signToken, DEMO_USER_ID } from "../../middleware/auth.middleware";
import { UpdateProfileBody } from "./auth.validation";

const googleClient = new OAuth2Client(env.googleClientId);

/** The shape returned to the frontend — never includes passwordHash. */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: "teacher" | "admin";
  avatarUrl: string;
  school?: { name: string; location: string; sector: string };
  onboarded: boolean;
  provider: string;
}

function toSafeUser(doc: UserDoc): SafeUser {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    role: (doc.role as "teacher" | "admin") ?? "teacher",
    avatarUrl: doc.avatarUrl ?? "",
    school: doc.school
      ? {
          name: doc.school.name,
          location: doc.school.location ?? "",
          sector: doc.school.sector ?? "",
        }
      : undefined,
    onboarded: Boolean(doc.onboarded),
    provider: doc.provider ?? "google",
  };
}

/** Verify a Google ID token (the `credential` from Google Identity Services). */
async function verifyGoogleToken(credential: string) {
  if (!env.googleClientId) {
    throw ApiError.internal("Google login is not configured (GOOGLE_CLIENT_ID missing).");
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized("Invalid Google credential");
  }
  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized("Google credential missing required fields");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || "",
    emailVerified: Boolean(payload.email_verified),
  };
}

/** Verify a Google credential, upsert the user, and return our JWT + the safe user. */
export async function loginWithGoogle(credential: string) {
  const g = await verifyGoogleToken(credential);

  // Match by googleId first, then by email (so an existing record links cleanly).
  let user = await User.findOne({ $or: [{ googleId: g.sub }, { email: g.email }] });

  if (!user) {
    user = await User.create({
      googleId: g.sub,
      email: g.email,
      name: g.name,
      avatarUrl: g.picture,
      provider: "google",
      role: "teacher",
      onboarded: false,
    });
  } else {
    // Keep the profile fresh on each login + backfill googleId for pre-existing accounts.
    user.googleId = g.sub;
    user.name = g.name;
    if (g.picture) user.avatarUrl = g.picture;
    await user.save();
  }

  return { token: signToken({ id: user._id.toString(), role: user.role as "teacher" | "admin" }), user: toSafeUser(user) };
}

/**
 * "Continue as guest" — logs in as the seeded demo teacher. Idempotently ensures the demo
 * user exists so this works even if `npm run seed` was never run.
 */
export async function guestLogin() {
  const _id = new mongoose.Types.ObjectId(DEMO_USER_ID);
  // $set (not $setOnInsert) so the shared demo account self-heals to its canonical state
  // even if it was created by an older seed that predates the provider/onboarded fields.
  await User.updateOne(
    { _id },
    {
      $set: {
        name: "John Doe",
        email: "john.doe@dps-bokaro.edu",
        role: "teacher",
        provider: "demo",
        onboarded: true,
        school: { name: "Delhi Public School", location: "Bokaro Steel City", sector: "Sector-4" },
      },
    },
    { upsert: true }
  );
  const user = await User.findById(_id);
  if (!user) throw ApiError.internal("Failed to create guest user");
  return { token: signToken({ id: user._id.toString(), role: user.role as "teacher" | "admin" }), user: toSafeUser(user) };
}

export async function getMe(userId: string): Promise<SafeUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized("User no longer exists");
  return toSafeUser(user);
}

/** Onboarding / profile update — sets the school and marks the user onboarded. */
export async function updateProfile(userId: string, body: UpdateProfileBody): Promise<SafeUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized("User no longer exists");
  user.school = {
    name: body.school.name,
    location: body.school.location ?? "",
    sector: body.school.sector ?? "",
  };
  user.onboarded = true;
  await user.save();
  return toSafeUser(user);
}
