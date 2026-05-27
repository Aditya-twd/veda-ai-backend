import path from "path";
import fs from "fs";
import multer from "multer";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(ApiError.badRequest("Only PDF, PNG, or JPEG files are allowed"));
  },
});

export const UPLOAD_DIR_PATH = UPLOAD_DIR;
