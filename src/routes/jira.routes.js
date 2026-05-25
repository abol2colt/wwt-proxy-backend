const express = require("express");
const { createJiraController } = require("../controllers/jira.controller");

function createJiraRoutes(deps) {
  const router = express.Router();
  const controller = createJiraController(deps);

  router.get("/jira/assigned-tasks", controller.getAssignedTasks);

  return router;
}

module.exports = {
  createJiraRoutes,
};
