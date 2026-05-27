import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import * as controller from "./paper.controller";

const router = Router();

router.use(requireAuth);

router.get("/by-assignment/:assignmentId", controller.getByAssignment);
router.get("/:id/pdf", controller.downloadPdf);
router.get("/:id", controller.getOne);
router.patch("/:id", controller.update);
router.post("/:id/sections/:index/regenerate", controller.regenerateSection);

export default router;
