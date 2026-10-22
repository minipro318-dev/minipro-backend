const express = require("express");
const journeyController = require("../controllers/journey.controller");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

router.use(requireAuth);

router.get("/destination-search", asyncHandler(journeyController.searchDestinations));
router.get("/destination-reverse", asyncHandler(journeyController.reverseDestination));
router.post("/preview", asyncHandler(journeyController.previewJourney));
router.post("/", asyncHandler(journeyController.startJourney));
router.get("/", asyncHandler(journeyController.listJourneys));
router.get("/:id", asyncHandler(journeyController.getJourneyById));
router.get("/:id/guardian-responses", asyncHandler(journeyController.listGuardianResponses));
router.post("/:id/guardian-responses", asyncHandler(journeyController.sendGuardianResponse));
router.post("/:id/locations", asyncHandler(journeyController.addJourneyLocation));
router.post("/:id/confirm-safety", asyncHandler(journeyController.confirmSafety));
router.patch("/:id/complete", asyncHandler(journeyController.completeJourney));
router.patch("/:id/cancel", asyncHandler(journeyController.cancelJourney));

module.exports = router;
