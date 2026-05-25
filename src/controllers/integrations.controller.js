function createIntegrationsController({
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
}) {
  function getStatus(req, res) {
    res.json({
      ok: true,
      jira: {
        mode: getJiraMode(),
      },
      gitlab: {
        mode: getGitlabMode(),
      },
      ai: {
        mode: getAiMode(),
      },
      missingEnv: getIntegrationMissingEnv(),
    });
  }

  function configureJira(req, res) {
    const {
      baseUrl,
      email,
      token,
      authType = "bearer",
      apiVersion = "2",
      jql,
    } = req.body ?? {};

    if (!baseUrl || !email || !token) {
      return res.status(400).json({
        success: false,
        error: "Jira baseUrl, email and token are required.",
      });
    }

    runtimeIntegrationConfig.jira = {
      baseUrl: trimTrailingSlash(baseUrl),
      email,
      token,
      authType,
      apiVersion,
      jql:
        jql ||
        "assignee=currentUser() AND statusCategory != Done ORDER BY updated DESC",
      mapping: null,
    };

    saveRuntimeIntegrationConfig(runtimeIntegrationConfig);

    return res.json({
      success: true,
      provider: "jira",
      mode: getJiraMode(),
      baseUrl: runtimeIntegrationConfig.jira.baseUrl,
      maskedAccount: email,
    });
  }

  function configureGitlab(req, res) {
    const {
      baseUrl,
      username = "",
      token,
      projectId,
      branchPattern = "feature/{TASK_KEY}",
    } = req.body ?? {};

    if (!baseUrl || !token || !projectId) {
      return res.status(400).json({
        success: false,
        error: "GitLab baseUrl, token and projectId are required.",
      });
    }

    runtimeIntegrationConfig.gitlab = {
      baseUrl: trimTrailingSlash(baseUrl),
      username,
      token,
      projectId: String(projectId),
      branchPattern,
    };

    saveRuntimeIntegrationConfig(runtimeIntegrationConfig);

    return res.json({
      success: true,
      provider: "gitlab",
      mode: getGitlabMode(),
      baseUrl: runtimeIntegrationConfig.gitlab.baseUrl,
      username,
      projectId: runtimeIntegrationConfig.gitlab.projectId,
      token: maskValue(token),
    });
  }

  async function testJira(req, res) {
    const config = req.body?.baseUrl
      ? {
          baseUrl: trimTrailingSlash(req.body.baseUrl),
          email: req.body.email,
          token: req.body.token,
          authType: req.body.authType || "bearer",
          apiVersion: req.body.apiVersion || "2",
        }
      : getEffectiveJiraConfig();

    if (!config.baseUrl || !config.email || !config.token) {
      return res.status(400).json({
        success: false,
        error: "Jira config is incomplete.",
      });
    }

    try {
      const account = await testJiraConnection(config);

      return res.json({
        success: true,
        provider: "jira",
        account: account?.displayName || account?.emailAddress || config.email,
      });
    } catch (err) {
      return res.status(err.response?.status ?? 500).json({
        success: false,
        error: "Jira connection failed.",
      });
    }
  }

  async function testGitlab(req, res) {
    const config = req.body?.baseUrl
      ? {
          baseUrl: trimTrailingSlash(req.body.baseUrl),
          username: req.body.username || "",
          token: req.body.token,
          projectId: String(req.body.projectId || "").trim(),
        }
      : getEffectiveGitlabConfig();

    if (!config.baseUrl || !config.token || !config.projectId) {
      return res.status(400).json({
        success: false,
        error: "GitLab baseUrl, token and projectId/projectPath are required.",
      });
    }

    try {
      const { user } = await testGitlabConnection(config);

      const actualUsername = user?.username || "";

      const usernameWarning =
        config.username && actualUsername && config.username !== actualUsername
          ? `Token belongs to "${actualUsername}", not "${config.username}".`
          : null;

      return res.json({
        success: true,
        provider: "gitlab",
        account: actualUsername || user?.name || "GitLab user",
        usernameWarning,
        projectId: config.projectId,
      });
    } catch (err) {
      const providerStatus = err.response?.status ?? 500;
      const safeStatus =
        providerStatus === 401 || providerStatus === 403 ? 400 : 502;

      console.error("GitLab connection test failed", {
        providerStatus,
        message: err.message,
        providerMessage: err.response?.data,
      });

      return res.status(safeStatus).json({
        success: false,
        error:
          providerStatus === 401 || providerStatus === 403
            ? "GitLab token is invalid or does not have enough permissions."
            : "GitLab connection failed.",
        debug:
          process.env.NODE_ENV === "development"
            ? {
                providerStatus,
                message: err.message,
                data: err.response?.data,
              }
            : undefined,
      });
    }
  }

  return {
    getStatus,
    configureJira,
    configureGitlab,
    testJira,
    testGitlab,
  };
}

module.exports = {
  createIntegrationsController,
};
