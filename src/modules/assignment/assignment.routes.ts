import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate";
import * as controller from "./assignment.controller";
import { createAssignmentSchema, listAssignmentsSchema } from "./assignment.validation";

const router = Router();

router.use(requireAuth); // stub now; real JWT later

router.post("/", validate(createAssignmentSchema), controller.create);
router.get("/", validate(listAssignmentsSchema), controller.list);
router.get("/:id", controller.getOne);
router.delete("/:id", controller.remove);
router.post("/:id/generate", controller.generate);

export default router;
