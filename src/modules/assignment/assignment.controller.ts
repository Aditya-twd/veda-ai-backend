import { Request, Response, NextFunction } from "express";
import * as service from "./assignment.service";

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const assignment = await service.createAssignment(req.user!.id, req.body);
    ok(res, assignment, 201);
  } catch (e) {
    next(e);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, status, page, limit } = req.query as Record<string, string>;
    const result = await service.listAssignments(req.user!.id, {
      q,
      status,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.getAssignment(req.user!.id, req.params.id));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.deleteAssignment(req.user!.id, req.params.id));
  } catch (e) {
    next(e);
  }
}

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.queueGeneration(req.user!.id, req.params.id), 202);
  } catch (e) {
    next(e);
  }
}
