const express = require("express");
const incidentController = require("../controllers/incident.controller");
const analyticsController = require("../controllers/incident-analytics.controller");
const { authorizeRoles, requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

router.use(requireAuth);

router.post("/sos", asyncHandler(incidentController.triggerSos));
router.get("/analytics", authorizeRoles("ADMIN"), asyncHandler(analyticsController.getSafetyAnalytics));
router.get("/analytics/export.csv", authorizeRoles("ADMIN"), asyncHandler(analyticsController.exportSafetyAnalyticsCsv));
router.get("/", asyncHandler(incidentController.listIncidents));
router.get("/:id", asyncHandler(incidentController.getIncidentById));
router.post("/:id/locations", asyncHandler(incidentController.addLocation));
router.patch("/:id/resolve", asyncHandler(incidentController.resolveIncident));
router.patch("/:id/cancel", asyncHandler(incidentController.cancelIncident));

module.exports = router;
