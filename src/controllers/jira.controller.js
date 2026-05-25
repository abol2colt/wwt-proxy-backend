function createJiraController({
  getEffectiveJiraConfig,
  isJiraConfigured,
  searchJiraIssues,
  getConfiguredJiraSearchFields,
  mapJiraIssueToExternalTask,
  env,
}) {
  async function getAssignedTasks(req, res) {
    const jira = getEffectiveJiraConfig();

    if (!isJiraConfigured()) {
      return res.status(503).json({
        success: false,
        code: "JIRA_NOT_CONFIGURED",
        error: "Jira is not configured.",
      });
    }

    try {
      const issues = await searchJiraIssues(jira, {
        maxResults: 50,
        fields: getConfiguredJiraSearchFields(),
      });

      return res.json(
        issues.map((issue) => mapJiraIssueToExternalTask(issue, jira.mapping)),
      );
    } catch (err) {
      const status = err.response?.status ?? err.statusCode ?? 500;
      const providerMessage =
        err.response?.data?.errorMessages?.join(" | ") ||
        err.response?.data?.message ||
        err.message;

      console.error("Jira assigned tasks failed", {
        status,
        message: err.message,
        providerMessage,
        data: err.response?.data,
      });

      return res.status(status).json({
        success: false,
        error: "Jira assigned tasks failed. Check proxy configuration.",
        debug:
          env.nodeEnv === "development"
            ? {
                status,
                providerMessage,
                data: err.response?.data,
              }
            : undefined,
      });
    }
  }

  return {
    getAssignedTasks,
  };
}

module.exports = {
  createJiraController,
};
