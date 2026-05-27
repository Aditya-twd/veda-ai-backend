import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

/**
 * JWT authentication.
 *
 * The frontend obtains a token from `/api/auth/google` (or `/api/auth/guest`) and sends it as
 * `Authorization: Bearer <jwt>`. We verify it here and attach the user to `req.user`.
 */

// The seeded demo teacher's id (see src/seed.ts). Used by the "Continue as guest" login.
export const DEMO_USER_ID = process.env.DEMO_USER_ID || "000000000000000000000001";

export interface AuthUser {
  id: string;
  role: "teacher" | "admin";
}

export interface JwtPayload {
  sub: string;
  role: "teacher" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Sign a JWT for a user. */
export function signToken(user: { id: string; role: "teacher" | "admin" }): string {
  const payload: JwtPayload = { sub: user.id, role: user.role };
  const options: jwt.SignOptions = { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(ApiError.unauthorized("Missing or malformed Authorization header"));
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}
