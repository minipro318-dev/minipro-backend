const express = require("express");
const aiSafetyEventController = require("../controllers/ai-safety-event.controller");
const { authorizeRoles, requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

router.use(requireAuth);

router.post("/detect", authorizeRoles("END_USER"), asyncHandler(aiSafetyEventController.createDetection));
router.get("/", asyncHandler(aiSafetyEventController.listEvents));
router.get("/admin/stats", authorizeRoles("ADMIN"), asyncHandler(aiSafetyEventController.getAdminStats));
router.get("/:id", asyncHandler(aiSafetyEventController.getEventById));
router.post("/:id/acknowledge", asyncHandler(aiSafetyEventController.acknowledgeEvent));
router.post("/:id/false-alarm", asyncHandler(aiSafetyEventController.markFalseAlarm));
router.post("/:id/request-help", asyncHandler(aiSafetyEventController.requestHelp));

module.exports = router;
