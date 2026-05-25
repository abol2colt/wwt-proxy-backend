const express = require("express");
const {
  createReportsController,
} = require("../controllers/reports.controller");

function createReportsRoutes(deps) {
  const router = express.Router();
  const controller = createReportsController(deps);

  router.post("/reports/ai-summary", controller.generateAiSummary);

  return router;
}

module.exports = {
  createReportsRoutes,
};
