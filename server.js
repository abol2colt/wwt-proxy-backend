const express = require("express");
const cors = require("cors");

const { env } = require("./src/config/env");
const app = express();
const {
  loadRuntimeIntegrationConfig,
  saveRuntimeIntegrationConfig,
} = require("./src/config/runtime-integrations.repository");

const {
  mapJiraIssueToExternalTask,
  getConfiguredJiraSearchFields,
} = require("./src/mappers/jira.mapper");

const {
  testJiraConnection,
  searchJiraIssues,
} = require("./src/clients/jira.client");

const {
  generateReportSummary,
} = require("./src/services/report-summary.service");

const {
  mapGitlabCommitForClient,
  normalizeClientEvidenceCommit,
} = require("./src/mappers/gitlab.mapper");

const { trimTrailingSlash } = require("./src/utils/text");

const { maskValue } = require("./src/utils/mask");

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

const runtimeIntegrationConfig = loadRuntimeIntegrationConfig();
const {
  createIntegrationConfigService,
} = require("./src/services/integration-config.service");

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

const { testGitlabConnection } = require("./src/clients/gitlab.client");

const {
  getRecentGitlabCommitsForCurrentUser,
  findEvidenceCommitsForTask,
} = require("./src/services/gitlab-evidence.service");

const {
  generateGitEvidenceWorklog,
  generateTaskKeyEvidenceWorklog,
} = require("./src/services/ai-worklog.service");

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "wtt-proxy",
    jiraMode: getJiraMode(),
    gitProvider:
      getGitlabMode() === "real" ? "gitlab-compatible" : "not-configured",
    aiProvider: getAiMode() === "real" ? "gemini-compatible" : "not-configured",
  });
});

app.get("/api/integrations/status", (req, res) => {
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
});

app.get("/api/sync-gitlab", async (req, res) => {
  const { taskKey, branch, projectId, preview } = req.query;

  if (!taskKey) {
    return res.status(400).json({
      success: false,
      error: "taskKey is required.",
    });
  }

  try {
    requireGitlabAndAiEnv();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `Proxy configuration is incomplete: ${err.missingEnv.join(", ")}`,
    });
  }

  try {
    const gitlab = getEffectiveGitlabConfig();

    if (projectId) {
      gitlab.projectId = String(projectId);
    }

    const { commits, matchedBranchNames, rawCommitCountBeforeTaskKeyFilter } =
      await findEvidenceCommitsForTask({
        gitlab,
        taskKey,
        branch,
      });

    const isPreviewOnly =
      preview === "true" || preview === "1" || preview === "candidates";

    if (!commits || commits.length === 0) {
      let recentCommits = [];

      try {
        recentCommits = await getRecentGitlabCommitsForCurrentUser(gitlab, 40);
      } catch (recentErr) {
        console.warn("Recent GitLab evidence fallback failed", {
          status: recentErr.response?.status,
          message: recentErr.message,
          data: recentErr.response?.data,
        });
      }

      if (isPreviewOnly) {
        return res.json({
          success: true,
          code: "GIT_EVIDENCE_CANDIDATES",
          description: `برای ${taskKey} شاهد مستقیمی پیدا نشد. از فعالیت‌های اخیر موارد مرتبط را انتخاب کن.`,
          durationMinutes: 0,
          commits: [],
          recentCommits: recentCommits.map(mapGitlabCommitForClient),
          evidence: {
            taskKey,
            branch: branch || undefined,
            matchedBranches: matchedBranchNames,
            commitCount: 0,
            rawCommitCountBeforeTaskKeyFilter,
            reason: "preview-no-direct-evidence",
          },
        });
      }

      return res.json({
        success: false,
        code: "NO_GIT_EVIDENCE",
        description: `برای ${taskKey} کامیتی در GitLab پیدا نشد. ممکن است commitها با این کلید ثبت نشده باشند یا در پروژه دیگری باشند.`,
        durationMinutes: 0,
        evidence: {
          taskKey,
          branch: branch || undefined,
          matchedBranches: matchedBranchNames,
          commitCount: 0,
          rawCommitCountBeforeTaskKeyFilter,
          reason: "no-task-key-commits-found",
        },
        recentCommits: recentCommits.map(mapGitlabCommitForClient),
      });
    }

    if (isPreviewOnly) {
      let recentCommits = [];

      try {
        recentCommits = await getRecentGitlabCommitsForCurrentUser(gitlab, 40);
      } catch (recentErr) {
        console.warn("Recent GitLab evidence preview failed", {
          status: recentErr.response?.status,
          message: recentErr.message,
          data: recentErr.response?.data,
        });
      }

      const matchedIds = new Set(commits.map((commit) => commit.id));
      const recentWithoutDuplicates = recentCommits.filter(
        (commit) => !matchedIds.has(commit.id),
      );

      return res.json({
        success: true,
        code: "GIT_EVIDENCE_CANDIDATES",
        description: `${commits.length} شاهد مرتبط با ${taskKey} پیدا شد. قبل از ساخت پیش‌نویس می‌توانی انتخاب‌ها را تغییر بدهی.`,
        durationMinutes: 0,
        commits: commits.map((commit) => ({
          ...mapGitlabCommitForClient(commit),
          matched: true,
        })),
        recentCommits: recentWithoutDuplicates.map(mapGitlabCommitForClient),
        evidence: {
          taskKey,
          branch: branch || undefined,
          matchedBranches: matchedBranchNames,
          commitCount: commits.length,
          rawCommitCountBeforeTaskKeyFilter,
          reason: "preview-before-ai",
        },
      });
    }

    const response = await generateTaskKeyEvidenceWorklog({
      taskKey,
      branch,
      commits,
      matchedBranchNames,
      rawCommitCountBeforeTaskKeyFilter,
    });

    return res.json(response);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const providerMessage =
      err.code === "ECONNABORTED"
        ? "Provider request timed out after 45 seconds."
        : (err.response?.data?.error?.message ??
          err.response?.data?.message ??
          err.message);

    console.error("GitLab sync failed", {
      status,
      code: err.code,
      message: err.message,
      providerMessage,
    });

    return res.status(500).json({
      success: false,
      error:
        "Git evidence sync failed. Check proxy and provider configuration.",
      debug:
        process.env.NODE_ENV === "development"
          ? {
              status,
              code: err.code,
              providerMessage,
            }
          : undefined,
    });
  }
});
app.post("/api/sync-gitlab/from-commits", async (req, res) => {
  const missingAiEnv = getAiMissingEnv();

  if (missingAiEnv.length > 0) {
    return res.status(500).json({
      success: false,
      error: `AI configuration is incomplete: ${missingAiEnv.join(", ")}`,
    });
  }

  const {
    taskKey = "",
    title = "",
    branch = "",
    commits = [],
    tone = "formal",
    detailLevel = "balanced",
    extraInstruction = "",
  } = req.body ?? {};

  if (!Array.isArray(commits) || commits.length === 0) {
    return res.status(400).json({
      success: false,
      error: "حداقل یک evidence برای تولید گزارش لازم است.",
    });
  }

  const normalizedCommits = commits.map(normalizeClientEvidenceCommit);

  const response = await generateGitEvidenceWorklog({
    taskKey,
    title,
    branch,
    commits: normalizedCommits,
    tone,
    detailLevel,
    extraInstruction,
  });

  return res.json(response);
});

app.post("/api/integrations/configure/jira", (req, res) => {
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
});

app.post("/api/integrations/configure/gitlab", (req, res) => {
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
});

app.post("/api/integrations/test/jira", async (req, res) => {
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
});

app.post("/api/integrations/test/gitlab", async (req, res) => {
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
});

app.get("/api/jira/assigned-tasks", async (req, res) => {
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
        process.env.NODE_ENV === "development"
          ? {
              status,
              providerMessage,
              data: err.response?.data,
            }
          : undefined,
    });
  }
});

app.post("/api/reports/ai-summary", async (req, res) => {
  const missingAiEnv = getAiMissingEnv();

  if (missingAiEnv.length > 0) {
    return res.status(500).json({
      success: false,
      error: `AI configuration is incomplete: ${missingAiEnv.join(", ")}`,
    });
  }

  const response = await generateTaskKeyEvidenceWorklog({
    taskKey,
    branch,
    commits,
    matchedBranchNames,
    rawCommitCountBeforeTaskKeyFilter,
  });

  return res.json(response);
});

app.listen(env.port, env.host, () => {
  console.log(`Proxy up on http://${env.host}:${env.port}`);
  console.log(`CORS origin: ${env.corsOrigin}`);
});
