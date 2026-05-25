function createHealthController({ getJiraMode, getGitlabMode, getAiMode }) {
  function getHealth(req, res) {
    res.json({
      ok: true,
      service: "wtt-proxy",
      jiraMode: getJiraMode(),
      gitProvider:
        getGitlabMode() === "real" ? "gitlab-compatible" : "not-configured",
      aiProvider:
        getAiMode() === "real" ? "gemini-compatible" : "not-configured",
    });
  }

  return {
    getHealth,
  };
}

module.exports = {
  createHealthController,
};
