// src/services/integration-config.service.js

const { env } = require("../config/env");
const { trimTrailingSlash } = require("../utils/text");

function createIntegrationConfigService(runtimeIntegrationConfig) {
  function getRuntimeJiraConfig() {
    return runtimeIntegrationConfig.jira;
  }

  function getEffectiveJiraConfig() {
    const runtime = getRuntimeJiraConfig();

    return {
      baseUrl: trimTrailingSlash(runtime?.baseUrl || env.jiraBaseUrl),
      email: runtime?.email || env.jiraEmail,
      token: runtime?.token || env.jiraApiToken,
      authType: runtime?.authType || env.jiraAuthType || "bearer",
      apiVersion: runtime?.apiVersion || env.jiraApiVersion || "2",
      jql: runtime?.jql || env.jiraJql,
      mapping: runtime?.mapping || null,
    };
  }

  function getRuntimeGitlabConfig() {
    return runtimeIntegrationConfig.gitlab;
  }

  function getEffectiveGitlabConfig() {
    const runtime = getRuntimeGitlabConfig();

    return {
      baseUrl: trimTrailingSlash(runtime?.baseUrl || env.gitlabUrl),
      username: runtime?.username || env.gitlabUsername || "",
      token: runtime?.token || env.gitlabToken,
      projectId: runtime?.projectId || env.gitlabProjectId,
      branchPattern: runtime?.branchPattern || "feature/{TASK_KEY}",
    };
  }

  function isJiraConfigured() {
    const jira = getEffectiveJiraConfig();
    return Boolean(jira.baseUrl && jira.email && jira.token);
  }

  function isGitlabConfigured() {
    const gitlab = getEffectiveGitlabConfig();
    return Boolean(gitlab.baseUrl && gitlab.token && gitlab.projectId);
  }

  function getRequiredEnvMissing(keys) {
    return keys.filter((key) => !process.env[key]);
  }

  function getAiMissingEnv() {
    return getRequiredEnvMissing(["GEMINI_API_KEY", "GEMINI_MODEL"]);
  }

  function getJiraMissingEnv() {
    const jira = getEffectiveJiraConfig();
    const missing = [];

    if (!jira.baseUrl) missing.push("JIRA_BASE_URL");
    if (!jira.email) missing.push("JIRA_EMAIL");
    if (!jira.token) missing.push("JIRA_API_TOKEN");

    return missing;
  }

  function getGitlabMissingEnv() {
    const gitlab = getEffectiveGitlabConfig();
    const missing = [];

    if (!gitlab.baseUrl) missing.push("GITLAB_URL");
    if (!gitlab.token) missing.push("GITLAB_TOKEN");
    if (!gitlab.projectId) missing.push("GITLAB_PROJECT_ID");

    return missing;
  }

  function getJiraMode() {
    return isJiraConfigured() ? "real" : "not-configured";
  }

  function getGitlabMode() {
    return isGitlabConfigured() ? "real" : "not-configured";
  }

  function getAiMode() {
    return getAiMissingEnv().length === 0 ? "real" : "not-configured";
  }

  function getIntegrationMissingEnv() {
    const missing = [
      ...getJiraMissingEnv(),
      ...getGitlabMissingEnv(),
      ...getAiMissingEnv(),
    ];

    return [...new Set(missing)];
  }

  function requireEnv(keys) {
    const missing = keys.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      const error = new Error(`Missing env: ${missing.join(", ")}`);
      error.statusCode = 500;
      throw error;
    }

    return true;
  }

  function requireGitlabAndAiEnv() {
    const missing = [...getGitlabMissingEnv(), ...getAiMissingEnv()];

    if (missing.length > 0) {
      const error = new Error(`Missing env: ${missing.join(", ")}`);
      error.statusCode = 500;
      error.missingEnv = missing;
      throw error;
    }

    return true;
  }

  return {
    getRuntimeJiraConfig,
    getEffectiveJiraConfig,
    getRuntimeGitlabConfig,
    getEffectiveGitlabConfig,
    isJiraConfigured,
    isGitlabConfigured,
    getRequiredEnvMissing,
    getAiMissingEnv,
    getJiraMissingEnv,
    getGitlabMissingEnv,
    getJiraMode,
    getGitlabMode,
    getAiMode,
    getIntegrationMissingEnv,
    requireEnv,
    requireGitlabAndAiEnv,
  };
}

module.exports = {
  createIntegrationConfigService,
};
