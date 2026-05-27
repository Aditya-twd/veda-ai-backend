import { Request, Response, NextFunction } from "express";
import * as service from "./auth.service";

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

export async function googleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.loginWithGoogle(req.body.credential));
  } catch (e) {
    next(e);
  }
}

export async function guest(_req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.guestLogin());
  } catch (e) {
    next(e);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.getMe(req.user!.id));
  } catch (e) {
    next(e);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.updateProfile(req.user!.id, req.body));
  } catch (e) {
    next(e);
  }
}
