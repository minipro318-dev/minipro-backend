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

const acceptInvite = async (req, res) => {
  const result = await guardianInviteService.acceptInvite(req.body);
  return res.status(201).json(result);
};

module.exports = { createInvite, listInvites, acceptInvite };
