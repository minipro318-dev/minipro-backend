const jwt = require("jsonwebtoken");
const AppError = require("../utils/app-error");

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (token) {
    try {
      req.auth = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {
      return next(new AppError(401, "Invalid or expired authentication token."));
    }
  }

  if (req.session?.user?.id && req.session?.user?.role) {
    req.auth = {
      sub: req.session.user.id,
      role: req.session.user.role,
    };
    return next();
  }

  return next(new AppError(401, "Authentication token is required."));
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.auth.role)) {
    return next(new AppError(403, "You do not have permission to perform this action."));
  }

  return next();
};

module.exports = { requireAuth, authorizeRoles };
