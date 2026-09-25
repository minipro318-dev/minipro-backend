const express = require("express");
const nearbyHelpController = require("../controllers/nearby-help.controller");
const { requireAuth, authorizeRoles } = require("../middleware/auth");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

router.use(requireAuth, authorizeRoles("END_USER"));

router.get("/", asyncHandler(nearbyHelpController.getNearbyHelp));
router.post("/route", asyncHandler(nearbyHelpController.getRouteToHelp));

module.exports = router;

