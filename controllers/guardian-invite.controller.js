const guardianInviteService = require("../services/guardian-invite.service");

const createInvite = async (req, res) => {
  const invite = await guardianInviteService.createInvite({
    invitedById: Number(req.auth.sub),
    role: req.auth.role,
    guardianName: req.body.guardianName,
    guardianEmail: req.body.guardianEmail,
    guardianMobile: req.body.guardianMobile,
  });

  return res.status(201).json({
    message: "Guardian invite created successfully.",
    invite,
  });
};

const listInvites = async (req, res) => {
  const invites = await guardianInviteService.listInvites({
    invitedById: Number(req.auth.sub),
    role: req.auth.role,
  });

  return res.status(200).json({ invites });
};

const listLinkedGuardians = async (req, res) => {
  const guardians = await guardianInviteService.listLinkedGuardians({
    endUserId: Number(req.auth.sub),
    role: req.auth.role,
  });

  return res.status(200).json({ guardians });
};

const updateLinkedGuardian = async (req, res) => {
  const guardian = await guardianInviteService.updateLinkedGuardian({
    endUserId: Number(req.auth.sub),
    role: req.auth.role,
    guardianId: Number(req.params.guardianId),
    guardianName: req.body.guardianName,
    guardianEmail: req.body.guardianEmail,
    guardianMobile: req.body.guardianMobile,
  });

  return res.status(200).json({
    message: "Guardian details updated successfully.",
    guardian,
  });
};

const removeLinkedGuardian = async (req, res) => {
  await guardianInviteService.removeLinkedGuardian({
    endUserId: Number(req.auth.sub),
    role: req.auth.role,
    guardianId: Number(req.params.guardianId),
  });

  return res.status(200).json({
    message: "Guardian removed successfully.",
  });
};

const acceptInvite = async (req, res) => {
  const result = await guardianInviteService.acceptInvite(req.body);
  return res.status(201).json(result);
};

module.exports = {
  createInvite,
  listInvites,
  listLinkedGuardians,
  updateLinkedGuardian,
  removeLinkedGuardian,
  acceptInvite,
};
