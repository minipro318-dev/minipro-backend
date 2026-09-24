const AppError = require("../utils/app-error");

const notFound = (req, res, next) => {
  next(new AppError(404, "Route not found."));
};

const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  if (statusCode === 500) {
    console.error(error);
  }

  return res.status(statusCode).json({
    message: statusCode === 500 ? "An unexpected server error occurred." : error.message,
    ...(error.details ? { details: error.details } : {}),
  });
};

module.exports = { notFound, errorHandler };
