const authService = require("../services/auth.service");
const AppError = require("../utils/app-error");

const register = async (req, res) => {
  const { user, token } = await authService.register(req.body);

  req.session.user = {
    id: user.id,
    role: user.role,
  };

  return res.status(201).json({
    message: "Registration successful.",
    token,
    user,
  });
};

const login = async (req, res) => {
  const { user, token } = await authService.login(req.body);

  req.session.user = {
    id: user.id,
    role: user.role,
  };

  return res.status(200).json({
    message: "Login successful.",
    token,
    user,
  });
};

const me = async (req, res) => {
  const user = await authService.getCurrentUser(Number(req.auth.sub));
  return res.status(200).json({ user });
};

const logout = async (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(new AppError(500, "Could not complete logout."));
    }
    res.clearCookie("safety.sid");
    return res.status(200).json({ message: "Logged out successfully." });
  });
};

const linkGuardian = async (req, res) => {
  const link = await authService.linkGuardianToUser(req.body);
  return res.status(201).json({
    message: "Guardian linked to end user successfully.",
    link,
  });
};

module.exports = {
  register,
  login,
  me,
  logout,
  linkGuardian,
};
