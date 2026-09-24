const express = require("express");
const incidentController = require("../controllers/incident.controller");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

router.use(requireAuth);

router.post("/sos", asyncHandler(incidentController.triggerSos));
router.get("/", asyncHandler(incidentController.listIncidents));
router.get("/:id", asyncHandler(incidentController.getIncidentById));
router.post("/:id/locations", asyncHandler(incidentController.addLocation));
router.patch("/:id/resolve", asyncHandler(incidentController.resolveIncident));
router.patch("/:id/cancel", asyncHandler(incidentController.cancelIncident));

module.exports = router;
