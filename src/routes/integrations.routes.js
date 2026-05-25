const express = require("express");
const {
  createIntegrationsController,
} = require("../controllers/integrations.controller");

function createIntegrationsRoutes(deps) {
  const router = express.Router();
  const controller = createIntegrationsController(deps);

  router.get("/integrations/status", controller.getStatus);

  router.post("/integrations/configure/jira", controller.configureJira);
  router.post("/integrations/configure/gitlab", controller.configureGitlab);

  router.post("/integrations/test/jira", controller.testJira);
  router.post("/integrations/test/gitlab", controller.testGitlab);

  return router;
}

module.exports = {
  createIntegrationsRoutes,
};
