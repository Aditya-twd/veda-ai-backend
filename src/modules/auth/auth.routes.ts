import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate";
import * as controller from "./auth.controller";
import { googleLoginSchema, updateProfileSchema } from "./auth.validation";

const router = Router();

// Public — exchange a credential for our JWT.
router.post("/google", validate(googleLoginSchema), controller.googleLogin);
router.post("/guest", controller.guest);

// Authenticated — current user + onboarding/profile update.
router.get("/me", requireAuth, controller.me);
router.patch("/me", requireAuth, validate(updateProfileSchema), controller.updateMe);

export default router;
