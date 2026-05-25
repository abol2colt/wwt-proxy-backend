const express = require("express");
const cors = require("cors");

const { env } = require("./config/env");

const {
  loadRuntimeIntegrationConfig,
  saveRuntimeIntegrationConfig,
} = require("./config/runtime-integrations.repository");

const {
  createIntegrationConfigService,
} = require("./services/integration-config.service");

const {
  mapJiraIssueToExternalTask,
  getConfiguredJiraSearchFields,
} = require("./mappers/jira.mapper");

const {
  mapGitlabCommitForClient,
  normalizeClientEvidenceCommit,
} = require("./mappers/gitlab.mapper");

const {
  testJiraConnection,
  searchJiraIssues,
} = require("./clients/jira.client");

const { testGitlabConnection } = require("./clients/gitlab.client");

const {
  getRecentGitlabCommitsForCurrentUser,
  findEvidenceCommitsForTask,
} = require("./services/gitlab-evidence.service");

const {
  generateGitEvidenceWorklog,
  generateTaskKeyEvidenceWorklog,
} = require("./services/ai-worklog.service");

const { generateReportSummary } = require("./services/report-summary.service");

const { trimTrailingSlash } = require("./utils/text");
const { maskValue } = require("./utils/mask");

const { createHealthRoutes } = require("./routes/health.routes");
const { createIntegrationsRoutes } = require("./routes/integrations.routes");
const { createJiraRoutes } = require("./routes/jira.routes");
const { createReportsRoutes } = require("./routes/reports.routes");
const { createGitlabRoutes } = require("./routes/gitlab.routes");

function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  const runtimeIntegrationConfig = loadRuntimeIntegrationConfig();

  const integrationConfigService = createIntegrationConfigService(
    runtimeIntegrationConfig,
  );

  const {
    getEffectiveJiraConfig,
    getEffectiveGitlabConfig,
    isJiraConfigured,
    getAiMissingEnv,
    getJiraMode,
    getGitlabMode,
    getAiMode,
    getIntegrationMissingEnv,
    requireGitlabAndAiEnv,
  } = integrationConfigService;

  app.use(
    "/api",
    createHealthRoutes({
      getJiraMode,
      getGitlabMode,
      getAiMode,
    }),
  );

  app.use(
    "/api",
    createIntegrationsRoutes({
      runtimeIntegrationConfig,
      saveRuntimeIntegrationConfig,

      getEffectiveJiraConfig,
      getEffectiveGitlabConfig,
      getJiraMode,
      getGitlabMode,
      getAiMode,
      getIntegrationMissingEnv,

      testJiraConnection,
      testGitlabConnection,

      trimTrailingSlash,
      maskValue,
    }),
  );

  app.use(
    "/api",
    createJiraRoutes({
      getEffectiveJiraConfig,
      isJiraConfigured,
      searchJiraIssues,
      getConfiguredJiraSearchFields,
      mapJiraIssueToExternalTask,
      env,
    }),
  );

  app.use(
    "/api",
    createReportsRoutes({
      getAiMissingEnv,
      generateReportSummary,
      env,
    }),
  );

  app.use(
    "/api",
    createGitlabRoutes({
      getEffectiveGitlabConfig,
      getAiMissingEnv,
      requireGitlabAndAiEnv,

      getRecentGitlabCommitsForCurrentUser,
      findEvidenceCommitsForTask,

      mapGitlabCommitForClient,
      normalizeClientEvidenceCommit,

      generateGitEvidenceWorklog,
      generateTaskKeyEvidenceWorklog,

      env,
    }),
  );

  return app;
}

module.exports = {
  createApp,
};
