import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { upload } from "../../middleware/upload.middleware";
import { ApiError } from "../../utils/ApiError";

const router = Router();

router.use(requireAuth);

/**
 * POST /api/upload  (multipart/form-data, field name: "file")
 * Returns the stored file's metadata — include it as `file` when creating an assignment.
 */
router.post("/", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest("No file uploaded (use field name 'file')");
  res.status(201).json({
    success: true,
    data: {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: req.file.path,
      size: req.file.size,
    },
  });
});

export default router;
