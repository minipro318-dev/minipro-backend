const express = require("express");
const guardianInviteController = require("../controllers/guardian-invite.controller");
const { requireAuth, authorizeRoles } = require("../middleware/auth");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

router.post("/accept", asyncHandler(guardianInviteController.acceptInvite));

router.use(requireAuth);

router.post(
  "/",
  authorizeRoles("END_USER"),
  asyncHandler(guardianInviteController.createInvite),
);
router.get(
  "/",
  authorizeRoles("END_USER"),
  asyncHandler(guardianInviteController.listInvites),
);
router.get(
  "/linked",
  authorizeRoles("END_USER"),
  asyncHandler(guardianInviteController.listLinkedGuardians),
);
router.patch(
  "/linked/:guardianId",
  authorizeRoles("END_USER"),
  asyncHandler(guardianInviteController.updateLinkedGuardian),
);
router.delete(
  "/linked/:guardianId",
  authorizeRoles("END_USER"),
  asyncHandler(guardianInviteController.removeLinkedGuardian),
);

module.exports = router;
