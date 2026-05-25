const express = require("express");
const { createGitlabController } = require("../controllers/gitlab.controller");

function createGitlabRoutes(deps) {
  const router = express.Router();
  const controller = createGitlabController(deps);

  router.get("/sync-gitlab", controller.syncGitlab);
  router.post("/sync-gitlab/from-commits", controller.generateFromCommits);

  return router;
}

module.exports = {
  createGitlabRoutes,
};
