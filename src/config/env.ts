import "dotenv/config";
import { z } from "zod";

/**
 * Environment schema. Data-store + Gemini values are intentionally OPTIONAL so the
 * server can boot before MongoDB / Redis / the Gemini key are configured.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  CLIENT_URL: z.string().default("http://localhost:3000"),

  MONGODB_URI: z.string().optional().or(z.literal("")),
  REDIS_URL: z.string().optional().or(z.literal("")),

  GEMINI_API_KEY: z.string().optional().or(z.literal("")),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),

  MAX_UPLOAD_MB: z.coerce.number().default(10),

  // ─── Auth ───
  // Google OAuth Client ID (Web). Used to verify the Google ID token the frontend sends.
  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal("")),
  // Secret used to sign our own JWTs. Optional so the server still boots without it
  // (a dev-only fallback is used + warned about below); set a strong value in prod.
  JWT_SECRET: z.string().optional().or(z.literal("")),
  JWT_EXPIRES_IN: z.string().default("7d"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const e = parsed.data;

const isProd = e.NODE_ENV === "production";

// JWT secret: required in prod; in dev fall back to a fixed (insecure) value with a warning
// so tokens stay valid across restarts without forcing config for local development.
const DEV_JWT_FALLBACK = "veda-dev-insecure-jwt-secret-change-me";
let jwtSecret = e.JWT_SECRET || "";
if (!jwtSecret) {
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error("❌ JWT_SECRET is required in production.");
    process.exit(1);
  }
  jwtSecret = DEV_JWT_FALLBACK;
  // eslint-disable-next-line no-console
  console.warn("⚠️  JWT_SECRET not set — using an insecure dev fallback. Set JWT_SECRET in .env.");
}

export const env = {
  ...e,
  isProd,
  // normalize empty strings to undefined for cleaner checks
  mongoUri: e.MONGODB_URI || undefined,
  redisUrl: e.REDIS_URL || undefined,
  geminiKey: e.GEMINI_API_KEY || undefined,
  googleClientId: e.GOOGLE_CLIENT_ID || undefined,
  jwtSecret,
  jwtExpiresIn: e.JWT_EXPIRES_IN,
  maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
  // CLIENT_URL may be a comma-separated list of allowed origins (dev convenience).
  clientOrigins: e.CLIENT_URL.split(",").map((s) => s.trim()).filter(Boolean),
};

export type Env = typeof env;
