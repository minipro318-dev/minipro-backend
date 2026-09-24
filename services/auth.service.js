const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { UserRole } = require("@prisma/client");
const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");
const { isEmail, isStrongPassword } = require("../utils/validators");

const REGISTERABLE_ROLES = [UserRole.END_USER, UserRole.GUARDIAN, UserRole.ADMIN];

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

const validateRegisterInput = ({ name, email, password, confirmPassword, role, adminRegistrationKey }) => {
  if (!name || !email || !password || !confirmPassword || !role) {
    throw new AppError(400, "name, email, password, confirmPassword and role are required.");
  }

  if (!isEmail(email)) {
    throw new AppError(400, "Please provide a valid email address.");
  }

  if (!isStrongPassword(password)) {
    throw new AppError(400, "Password must be at least 8 chars with uppercase, lowercase and a number.");
  }

  if (password !== confirmPassword) {
    throw new AppError(400, "Password and confirmPassword do not match.");
  }

  if (!REGISTERABLE_ROLES.includes(role)) {
    throw new AppError(400, "Invalid role. Allowed roles: ADMIN, GUARDIAN, END_USER.");
  }

  if (role === UserRole.ADMIN) {
    if (!process.env.ADMIN_REGISTRATION_KEY) {
      throw new AppError(500, "ADMIN_REGISTRATION_KEY is not configured in server environment.");
    }
    if (!adminRegistrationKey || adminRegistrationKey !== process.env.ADMIN_REGISTRATION_KEY) {
      throw new AppError(403, "Invalid admin registration key.");
    }
  }
};

const register = async (payload) => {
  validateRegisterInput(payload);

  const existing = await prisma.user.findUnique({
    where: { email: payload.email.toLowerCase().trim() },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(409, "Email already registered.");
  }

  const passwordHash = await bcrypt.hash(payload.password, 12);
  const user = await prisma.user.create({
    data: {
      name: payload.name.trim(),
      email: payload.email.toLowerCase().trim(),
      mobile: payload.mobile ? payload.mobile.trim() : null,
      role: payload.role,
      passwordHash,
    },
  });

  return {
    user: sanitizeUser(user),
    token: issueToken(user),
  };
};

const login = async ({ email, password }) => {
  if (!email || !password) {
    throw new AppError(400, "email and password are required.");
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    throw new AppError(401, "Invalid credentials.");
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError(401, "Invalid credentials.");
  }

  if (!user.status) {
    throw new AppError(403, "Your account is inactive. Contact administrator.");
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  return {
    user: sanitizeUser(updatedUser),
    token: issueToken(updatedUser),
  };
};

const getCurrentUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError(404, "User not found.");
  }

  return sanitizeUser(user);
};

const linkGuardianToUser = async ({ guardianId, endUserId }) => {
  if (!guardianId || !endUserId) {
    throw new AppError(400, "guardianId and endUserId are required.");
  }

  if (guardianId === endUserId) {
    throw new AppError(400, "Guardian and end user must be different users.");
  }

  const [guardian, endUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: Number(guardianId) } }),
    prisma.user.findUnique({ where: { id: Number(endUserId) } }),
  ]);

  if (!guardian || guardian.role !== UserRole.GUARDIAN) {
    throw new AppError(400, "guardianId must belong to a GUARDIAN account.");
  }

  if (!endUser || endUser.role !== UserRole.END_USER) {
    throw new AppError(400, "endUserId must belong to an END_USER account.");
  }

  const link = await prisma.guardianLink.upsert({
    where: {
      guardianId_endUserId: {
        guardianId: guardian.id,
        endUserId: endUser.id,
      },
    },
    create: {
      guardianId: guardian.id,
      endUserId: endUser.id,
    },
    update: {},
  });

  return link;
};

module.exports = { register, login, getCurrentUser, linkGuardianToUser };
