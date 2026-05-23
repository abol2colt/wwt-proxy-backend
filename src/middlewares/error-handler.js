// src/middlewares/error-handler.js
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    code: err.code || "INTERNAL_ERROR",
    error: err.message || "Internal server error",
    debug: process.env.NODE_ENV === "development" ? err.details : undefined,
  });
}

module.exports = { errorHandler };
