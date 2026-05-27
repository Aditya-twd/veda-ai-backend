import { Request, Response, NextFunction } from "express";
import * as service from "./paper.service";
import { buildPaperPdf } from "./pdf.service";
import { generatedPaperSchema } from "../../ai/paper.schema";
import { ApiError } from "../../utils/ApiError";

const ok = (res: Response, data: unknown) => res.json({ success: true, data });

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.getPaper(req.user!.id, req.params.id));
  } catch (e) {
    next(e);
  }
}

export async function getByAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await service.getPaperByAssignment(req.user!.id, req.params.assignmentId));
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = generatedPaperSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid paper data");
    ok(res, await service.updatePaper(req.user!.id, req.params.id, parsed.data));
  } catch (e) {
    next(e);
  }
}

export async function regenerateSection(req: Request, res: Response, next: NextFunction) {
  try {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw ApiError.badRequest("Invalid section index");
    const instruction =
      typeof req.body?.instruction === "string" ? req.body.instruction.slice(0, 500) : "";
    ok(res, await service.regenerateSection(req.user!.id, req.params.id, index, instruction));
  } catch (e) {
    next(e);
  }
}

export async function downloadPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const paper = await service.getPaperDoc(req.user!.id, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="question-paper-${paper._id}.pdf"`
    );
    const doc = buildPaperPdf(paper);
    doc.pipe(res);
    doc.end();
  } catch (e) {
    next(e);
  }
}
