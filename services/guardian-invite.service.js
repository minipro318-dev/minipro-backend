const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { GuardianInviteStatus, UserRole } = require("@prisma/client");
const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");
const { isEmail, isStrongPassword } = require("../utils/validators");
const { sendGuardianInviteEmail } = require("../utils/mailer");

const sanitizeInvite = (invite) => ({
  id: invite.id,
  invitedById: invite.invitedById,
  guardianName: invite.guardianName,
  guardianEmail: invite.guardianEmail,
  guardianMobile: invite.guardianMobile,
  inviteCode: invite.inviteCode,
  status: invite.status,
  expiresAt: invite.expiresAt,
  acceptedAt: invite.acceptedAt,
  createdAt: invite.createdAt,
  updatedAt: invite.updatedAt,
});

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  mobile: user.mobile,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLogin: user.lastLogin,
});

const issueToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" },
  );

const buildInviteCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();

const getUniqueInviteCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = buildInviteCode();
    const existing = await prisma.guardianInvite.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!existing) {
      return inviteCode;
    }
  }

  throw new AppError(500, "Could not generate a unique invite code. Please try again.");
};

const createInvite = async ({ invitedById, role, guardianName, guardianEmail, guardianMobile }) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can create guardian invites.");
  }

  const normalizedName = guardianName?.trim();
  const normalizedEmail = guardianEmail?.trim().toLowerCase();
  const normalizedMobile = guardianMobile?.trim();

  if (!normalizedName || !normalizedEmail || !normalizedMobile) {
    throw new AppError(400, "guardianName, guardianEmail and guardianMobile are required.");
  }

  if (!isEmail(normalizedEmail)) {
    throw new AppError(400, "Please provide a valid guardian email address.");
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { mobile: normalizedMobile }],
    },
    select: { id: true, role: true },
  });

  if (existingUser) {
    throw new AppError(
      409,
      "A user with this guardian email or mobile already exists. Ask that guardian to log in and request admin linking.",
    );
  }

  const pendingExisting = await prisma.guardianInvite.findFirst({
    where: {
      invitedById,
      guardianEmail: normalizedEmail,
      status: GuardianInviteStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
  });

  if (pendingExisting) {
    return sanitizeInvite(pendingExisting);
  }

  const inviteCode = await getUniqueInviteCode();
  const expiryHours = Number(process.env.GUARDIAN_INVITE_EXPIRY_HOURS || 72);
  const expiresAt = new Date(Date.now() + Math.max(1, expiryHours) * 60 * 60 * 1000);

  const invite = await prisma.guardianInvite.create({
    data: {
      invitedById,
      guardianName: normalizedName,
      guardianEmail: normalizedEmail,
      guardianMobile: normalizedMobile,
      inviteCode,
      expiresAt,
    },
  });

  try {
    await sendGuardianInviteEmail({
      toEmail: invite.guardianEmail,
      toName: invite.guardianName,
      inviteCode: invite.inviteCode,
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    await prisma.guardianInvite.delete({ where: { id: invite.id } });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, "Could not send guardian invite email. Please verify SMTP settings and retry.");
  }

  return sanitizeInvite(invite);
};

const listInvites = async ({ invitedById, role }) => {
  if (role !== UserRole.END_USER) {
    throw new AppError(403, "Only END_USER can view guardian invites.");
  }

  const now = new Date();
  await prisma.guardianInvite.updateMany({
    where: {
      invitedById,
      status: GuardianInviteStatus.PENDING,
      expiresAt: { lte: now },
    },
    data: { status: GuardianInviteStatus.EXPIRED },
  });

  const invites = await prisma.guardianInvite.findMany({
    where: { invitedById },
    orderBy: { createdAt: "desc" },
  });

  return invites.map(sanitizeInvite);
};

const acceptInvite = async ({ inviteCode, guardianName, guardianEmail, guardianMobile, password, confirmPassword }) => {
  const normalizedCode = inviteCode?.trim().toUpperCase();
  if (!normalizedCode || !guardianName || !guardianEmail || !guardianMobile || !password || !confirmPassword) {
    throw new AppError(
      400,
      "inviteCode, guardianName, guardianEmail, guardianMobile, password and confirmPassword are required.",
    );
  }

  if (!isEmail(guardianEmail.trim().toLowerCase())) {
    throw new AppError(400, "Please provide a valid guardian email address.");
  }

  if (!isStrongPassword(password)) {
    throw new AppError(400, "Password must be at least 8 chars with uppercase, lowercase and a number.");
  }

  if (password !== confirmPassword) {
    throw new AppError(400, "Password and confirmPassword do not match.");
  }

  const invite = await prisma.guardianInvite.findUnique({
    where: { inviteCode: normalizedCode },
  });

  if (!invite) {
    throw new AppError(404, "Invite code not found.");
  }

  if (invite.status !== GuardianInviteStatus.PENDING) {
    throw new AppError(400, `Invite is ${invite.status.toLowerCase()} and cannot be accepted.`);
  }

  if (invite.expiresAt <= new Date()) {
    await prisma.guardianInvite.update({
      where: { id: invite.id },
      data: { status: GuardianInviteStatus.EXPIRED },
    });
    throw new AppError(400, "Invite has expired. Ask the user to send a new invite.");
  }

  const normalizedEmail = guardianEmail.trim().toLowerCase();
  const normalizedMobile = guardianMobile.trim();
  const normalizedName = guardianName.trim();

  if (invite.guardianEmail !== normalizedEmail || invite.guardianMobile !== normalizedMobile) {
    throw new AppError(400, "Invite details do not match guardian email/mobile.");
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { mobile: normalizedMobile }],
    },
    select: { id: true },
  });

  if (existingUser) {
    throw new AppError(409, "Guardian account already exists for this email/mobile.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const guardian = await tx.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        mobile: normalizedMobile,
        role: UserRole.GUARDIAN,
        passwordHash,
        status: true,
      },
    });

    await tx.guardianLink.upsert({
      where: {
        guardianId_endUserId: {
          guardianId: guardian.id,
          endUserId: invite.invitedById,
        },
      },
      create: {
        guardianId: guardian.id,
        endUserId: invite.invitedById,
      },
      update: {},
    });

    const acceptedInvite = await tx.guardianInvite.update({
      where: { id: invite.id },
      data: {
        status: GuardianInviteStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedGuardianId: guardian.id,
      },
    });

    return { guardian, acceptedInvite };
  });

  return {
    message: "Guardian account created and linked successfully.",
    user: sanitizeUser(result.guardian),
    token: issueToken(result.guardian),
    invite: sanitizeInvite(result.acceptedInvite),
  };
};

module.exports = { createInvite, listInvites, acceptInvite };
