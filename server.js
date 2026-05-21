require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { SocksProxyAgent } = require("socks-proxy-agent");
const app = express();
const fs = require("fs");
const path = require("path");
const RUNTIME_CONFIG_FILE = path.join(__dirname, ".runtime-integrations.json");

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:4200";
const USE_SOCKS_PROXY = process.env.USE_SOCKS_PROXY === "true";
const SOCKS_PROXY_URL =
  process.env.SOCKS_PROXY_URL ?? "socks5://127.0.0.1:1080";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const proxyAgent = USE_SOCKS_PROXY
  ? new SocksProxyAgent(SOCKS_PROXY_URL)
  : undefined;

function loadRuntimeIntegrationConfig() {
  try {
    if (!fs.existsSync(RUNTIME_CONFIG_FILE)) {
      return { jira: null, gitlab: null };
    }

    return JSON.parse(fs.readFileSync(RUNTIME_CONFIG_FILE, "utf8"));
  } catch (error) {
    console.warn("Could not load runtime integration config", error.message);
    return { jira: null, gitlab: null };
  }
}
const runtimeIntegrationConfig = loadRuntimeIntegrationConfig();

function buildGeminiRequestConfig(timeout = 45000) {
  return {
    timeout,
    ...(proxyAgent
      ? {
          httpAgent: proxyAgent,
          httpsAgent: proxyAgent,
          proxy: false,
        }
      : {}),
  };
}

const wttMappings = {
  redesign: { project_id: 22, service_id: 1, contract_id: 1 }, // 22 = WTT
  neobrk: { project_id: 30, service_id: 1, contract_id: 1 }, // 30 = NeoBRK
  irpt: { project_id: 33, service_id: 1, contract_id: 1 }, // 33 = IRPT
};

const mockJiraIssues = [
  {
    key: "WTT-101",
    title: "بازطراحی رابط کاربری و بهبود ساختار مودال تسک‌ها",
    mapping: wttMappings.redesign,
    branch: "feature/WTT-101-ui-redesign",
  },
  {
    key: "IDEAL-730",
    title: "بهبود سرویس getOptionContract برای ارسال best limits",
    mapping: wttMappings.neobrk,
    branch: "feature/IDEAL-730-best-limits-contract",
  },
  {
    key: "IRPT-101",
    title: "پیاده‌سازی فرم ثبت سفارش در پنل IRPT",
    mapping: wttMappings.irpt,
    branch: "feature/IRPT-101-order-form",
  },
];

function getGitlabProjectId() {
  return process.env.GITLAB_PROJECT_ID || process.env.PROJECT_ID;
}

const WORK_SESSION_GAP_LIMIT_MINUTES = 90;
const MIN_WORKLOG_DURATION_MINUTES = 45;
const MIN_MINUTES_PER_COMMIT = 30;

function toMinutesBetween(start, end) {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
  );
}

function toTimeHHMM(dateValue) {
  const date = new Date(dateValue);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function maskValue(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 6) return "******";
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function saveRuntimeIntegrationConfig() {
  fs.writeFileSync(
    RUNTIME_CONFIG_FILE,
    JSON.stringify(runtimeIntegrationConfig, null, 2),
    "utf8",
  );
}

function getRuntimeJiraConfig() {
  return runtimeIntegrationConfig.jira;
}

function getEffectiveJiraConfig() {
  const runtime = getRuntimeJiraConfig();

  return {
    baseUrl: trimTrailingSlash(runtime?.baseUrl || process.env.JIRA_BASE_URL),
    email: runtime?.email || process.env.JIRA_EMAIL,
    token: runtime?.token || process.env.JIRA_API_TOKEN,
    authType: runtime?.authType || process.env.JIRA_AUTH_TYPE || "bearer",
    apiVersion: runtime?.apiVersion || process.env.JIRA_API_VERSION || "2",
    jql:
      runtime?.jql ||
      process.env.JIRA_JQL ||
      "statusCategory != Done ORDER BY updated DESC",
    mapping: runtime?.mapping || null,
  };
}

function getRuntimeGitlabConfig() {
  return runtimeIntegrationConfig.gitlab;
}

function getEffectiveGitlabConfig() {
  const runtime = getRuntimeGitlabConfig();

  return {
    baseUrl: trimTrailingSlash(runtime?.baseUrl || process.env.GITLAB_URL),
    username: runtime?.username || process.env.GITLAB_USERNAME || "",
    token: runtime?.token || process.env.GITLAB_TOKEN,
    projectId:
      runtime?.projectId ||
      process.env.GITLAB_PROJECT_ID ||
      process.env.PROJECT_ID,
    branchPattern: runtime?.branchPattern || "feature/{TASK_KEY}",
  };
}

function buildJiraAxiosAuthConfig(config) {
  if (config.authType === "bearer") {
    return {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    };
  }

  return {
    auth: {
      username: config.email,
      password: config.token,
    },
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

function calculateEvidenceTimeSuggestion(commits) {
  const sortedCommits = [...commits]
    .filter((commit) => commit.created_at)
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  if (sortedCommits.length === 0) {
    return {
      suggestedStartTime: "",
      suggestedEndTime: "",
      suggestedDurationMinutes: 0,
      excludedGapMinutes: 0,
      confidenceScore: 50,
      confidenceLabel: "manual-review",
      reasoning: "No commit timestamp was available.",
    };
  }

  let suggestedDurationMinutes = 0;
  let excludedGapMinutes = 0;

  for (let index = 1; index < sortedCommits.length; index += 1) {
    const previous = sortedCommits[index - 1];
    const current = sortedCommits[index];
    const gapMinutes = toMinutesBetween(
      previous.created_at,
      current.created_at,
    );

    if (gapMinutes <= WORK_SESSION_GAP_LIMIT_MINUTES) {
      suggestedDurationMinutes += gapMinutes;
    } else {
      excludedGapMinutes += gapMinutes;
    }
  }

  const effortFloorMinutes = Math.max(
    MIN_WORKLOG_DURATION_MINUTES,
    sortedCommits.length * MIN_MINUTES_PER_COMMIT,
  );

  suggestedDurationMinutes = Math.max(
    suggestedDurationMinutes,
    effortFloorMinutes,
  );

  const firstCommitAt = sortedCommits[0].created_at;
  const suggestedEndAt = new Date(
    new Date(firstCommitAt).getTime() + suggestedDurationMinutes * 60000,
  ).toISOString();

  const lastCommitAt = suggestedEndAt;
  const confidenceScore =
    sortedCommits.length >= 3 && excludedGapMinutes === 0
      ? 88
      : sortedCommits.length >= 2
        ? 78
        : 65;

  return {
    suggestedStartTime: toTimeHHMM(firstCommitAt),
    suggestedEndTime: toTimeHHMM(lastCommitAt),
    suggestedDurationMinutes,
    excludedGapMinutes,
    confidenceScore,
    confidenceLabel:
      confidenceScore >= 85
        ? "high"
        : confidenceScore >= 70
          ? "medium"
          : "needs-review",
    reasoning:
      excludedGapMinutes > 0
        ? `فاصله‌های زمانی طولانیِ بیش از ${WORK_SESSION_GAP_LIMIT_MINUTES} دقیقه محاسبه نشدند و حداقل زمان استاندارد برای فعالیت‌ها لحاظ شد.`
        : "به دلیل نزدیک بودن زمانِ کامیت‌ها به یکدیگر، حداقل زمان استاندارد اعمال شد تا پیشنهاد گزارش کار واقعی‌تر باشد.",
    firstEvidenceAt: firstCommitAt,
    lastEvidenceAt: lastCommitAt,
  };
}

function isMockIntegrationMode() {
  return process.env.ENABLE_INTEGRATION_MOCK_MODE !== "false";
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
  if (isJiraConfigured()) return "real";
  if (isMockIntegrationMode()) return "mock";
  return "not-configured";
}

function getGitlabMode() {
  return isGitlabConfigured() ? "real" : "not-configured";
}

function getAiMode() {
  return getAiMissingEnv().length === 0 ? "real" : "not-configured";
}

function getIntegrationMissingEnv() {
  const missing = [];

  if (!isMockIntegrationMode()) {
    missing.push(...getJiraMissingEnv());
  }

  missing.push(...getGitlabMissingEnv(), ...getAiMissingEnv());

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

function mapMockJiraIssueToExternalTask(issue) {
  return {
    id: issue.key,
    key: issue.key,
    title: issue.title,
    project_id: issue.mapping.project_id,
    service_id: issue.mapping.service_id,
    contract_id: issue.mapping.contract_id,
    branch_name: issue.branch,
    source: "mock-jira",
  };
}
function jiraFieldToPlainText(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map(jiraFieldToPlainText).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.value === "string") return value.value;
    if (typeof value.name === "string") return value.name;

    if (Array.isArray(value.content)) {
      return value.content.map(jiraFieldToPlainText).filter(Boolean).join("\n");
    }
  }

  return "";
}

function parseWttMetadataBlock(text) {
  const source = String(text ?? "");
  const match = source.match(/WTT:?\s*([\s\S]*?)(?:\n\s*\n|$)/i);

  if (!match) {
    return null;
  }

  const lines = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const data = {};

  for (const line of lines) {
    const [rawKey, ...rawValueParts] = line.split("=");
    const key = rawKey?.trim();
    const value = rawValueParts.join("=").trim();

    if (key && value) {
      data[key] = value;
    }
  }

  return {
    project_id: data.project_id ? Number(data.project_id) : null,
    service_id: data.service_id ? Number(data.service_id) : null,
    contract_id: data.contract_id ? Number(data.contract_id) : null,
    location: data.location || null,
    gitlab_project: data.gitlab_project || null,
    branch_name: data.branch_name || null,
    branch_pattern: data.branch_pattern || null,
    mapping_source: "jira-description",
  };
}

function readCustomField(issue, envName) {
  const fieldId = process.env[envName];

  if (!fieldId) {
    return null;
  }

  return jiraFieldToPlainText(issue.fields?.[fieldId]).trim() || null;
}

function getTaskKeySearchAliases(taskKey) {
  const key = String(taskKey ?? "").trim();
  const numberPart = key.split("-")[1];

  return [
    key,
    key.toLowerCase(),
    numberPart ? `issue-${numberPart}` : "",
    numberPart ? `bugfix/issue-${numberPart}` : "",
    numberPart ? `feature/${key}` : "",
  ].filter(Boolean);
}

function extractWttMetadataFromCustomFields(issue) {
  const projectId = readCustomField(issue, "JIRA_WTT_PROJECT_FIELD");
  const serviceId = readCustomField(issue, "JIRA_WTT_SERVICE_FIELD");
  const contractId = readCustomField(issue, "JIRA_WTT_CONTRACT_FIELD");
  const location = readCustomField(issue, "JIRA_WTT_LOCATION_FIELD");
  const gitlabProject = readCustomField(issue, "JIRA_GITLAB_PROJECT_FIELD");
  const branchPattern = readCustomField(issue, "JIRA_BRANCH_PATTERN_FIELD");

  if (
    !projectId &&
    !serviceId &&
    !contractId &&
    !location &&
    !gitlabProject &&
    !branchPattern
  ) {
    return null;
  }

  return {
    project_id: projectId ? Number(projectId) : null,
    service_id: serviceId ? Number(serviceId) : null,
    contract_id: contractId ? Number(contractId) : null,
    location: location || null,
    gitlab_project: gitlabProject || null,
    branch_pattern: branchPattern || null,
    mapping_source: "jira-custom-fields",
  };
}

function extractWttMetadataFromJiraIssue(issue) {
  const descriptionText = jiraFieldToPlainText(issue.fields?.description);
  const fromDescription = parseWttMetadataBlock(descriptionText);

  if (fromDescription) {
    return fromDescription;
  }

  return extractWttMetadataFromCustomFields(issue);
}

function getConfiguredJiraSearchFields() {
  const baseFields = [
    "summary",
    "status",
    "issuetype",
    "updated",
    "description",
    "project",
    "assignee",
    "labels",
    "components",
  ];

  const customFields = [
    process.env.JIRA_WTT_PROJECT_FIELD,
    process.env.JIRA_WTT_SERVICE_FIELD,
    process.env.JIRA_WTT_CONTRACT_FIELD,
    process.env.JIRA_WTT_LOCATION_FIELD,
    process.env.JIRA_GITLAB_PROJECT_FIELD,
    process.env.JIRA_BRANCH_PATTERN_FIELD,
  ].filter(Boolean);

  return [...new Set([...baseFields, ...customFields])].join(",");
}

function buildBranchNameFromPattern(pattern, key) {
  if (!pattern) return null;

  const issueNumber = String(key ?? "").split("-")[1] || "";

  return String(pattern)
    .replaceAll("{TASK_KEY}", key)
    .replaceAll("{ISSUE_NUMBER}", issueNumber);
}

function mapJiraIssueToExternalTask(issue, runtimeMapping) {
  const key = issue.key;
  const summary = issue.fields?.summary ?? key;
  const wttMetadata = extractWttMetadataFromJiraIssue(issue);

  const mapping = runtimeMapping
    ? {
        project_id: runtimeMapping.project_id,
        service_id: runtimeMapping.service_id,
        contract_id: runtimeMapping.contract_id,
        mapping_source: "runtime",
      }
    : wttMetadata;

  const branchPattern = wttMetadata?.branch_pattern ?? null;
  const branchName =
    wttMetadata?.branch_name ||
    (wttMetadata?.branch_pattern
      ? buildBranchNameFromPattern(wttMetadata.branch_pattern, key)
      : null);

  return {
    id: key,
    key,
    title: summary,

    project_id: mapping?.project_id ?? null,
    service_id: mapping?.service_id ?? null,
    contract_id: mapping?.contract_id ?? null,
    location: wttMetadata?.location ?? null,

    gitlab_project_id: wttMetadata?.gitlab_project ?? null,
    branch_pattern: branchPattern,
    branch_name: branchName,
    mapping_source: mapping?.mapping_source ?? null,

    status: issue.fields?.status?.name,
    source: "jira",
    raw: {
      updated: issue.fields?.updated,
      issueType: issue.fields?.issuetype?.name,
      jiraProjectKey: issue.fields?.project?.key,
      jiraProjectName: issue.fields?.project?.name,
      assignee: issue.fields?.assignee?.displayName,
      labels: issue.fields?.labels ?? [],
      components: issue.fields?.components ?? [],
      descriptionText: jiraFieldToPlainText(issue.fields?.description),
      wttMetadata,
    },
  };
}

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

// Legacy manual-testing route. This always returns mock tasks regardless of mock-mode env.
app.get("/api/jira/mock-tasks", (req, res) => {
  const response = mockJiraIssues.map(mapMockJiraIssueToExternalTask);

  res.json(response);
});

function mapGitlabCommitForClient(commit) {
  return {
    id: commit.id,
    shortId: commit.short_id,
    title: commit.title,
    message: commit.message,
    authorName: commit.author_name,
    createdAt: commit.created_at,
    webUrl: commit.web_url,
  };
}
app.get("/api/sync-gitlab", async (req, res) => {
  const { taskKey, branch, projectId } = req.query;

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

    async function findGitlabBranchesByTaskKey(gitlab, taskKey) {
      const response = await axios.get(
        `${gitlab.baseUrl}/api/v4/projects/${encodeURIComponent(gitlab.projectId)}/repository/branches`,
        {
          headers: { "PRIVATE-TOKEN": gitlab.token },
          params: {
            search: taskKey,
            per_page: 20,
          },
        },
      );

      return Array.isArray(response.data) ? response.data : [];
    }

    async function getGitlabCommits(gitlab, params) {
      const response = await axios.get(
        `${gitlab.baseUrl}/api/v4/projects/${encodeURIComponent(gitlab.projectId)}/repository/commits`,
        {
          headers: { "PRIVATE-TOKEN": gitlab.token },
          params,
        },
      );

      return Array.isArray(response.data) ? response.data : [];
    }

    let commits = [];
    let matchedBranchNames = [];

    async function findBranchesByAliases(gitlab, taskKey) {
      let matchedBranches = [];

      for (const alias of getTaskKeySearchAliases(taskKey)) {
        const branches = await findGitlabBranchesByTaskKey(gitlab, alias);
        matchedBranches.push(...branches);
      }

      const seenBranchNames = new Set();

      return matchedBranches.filter((branchItem) => {
        if (!branchItem?.name || seenBranchNames.has(branchItem.name)) {
          return false;
        }

        seenBranchNames.add(branchItem.name);
        return true;
      });
    }

    async function getRecentGitlabCommits(gitlab) {
      return getGitlabCommits(gitlab, {
        per_page: 20,
      });
    }

    if (branch) {
      commits = await getGitlabCommits(gitlab, {
        ref_name: branch,
        per_page: 20,
      });

      matchedBranchNames = [branch];

      if (commits.length === 0) {
        const matchedBranches = await findBranchesByAliases(gitlab, taskKey);
        matchedBranchNames = matchedBranches.map((item) => item.name);

        for (const matchedBranch of matchedBranches.slice(0, 3)) {
          const branchCommits = await getGitlabCommits(gitlab, {
            ref_name: matchedBranch.name,
            per_page: 20,
          });

          commits.push(...branchCommits);
        }
      }

      if (commits.length === 0) {
        commits = await getGitlabCommits(gitlab, {
          search: taskKey,
          per_page: 20,
        });
      }
    } else {
      const matchedBranches = await findBranchesByAliases(gitlab, taskKey);
      matchedBranchNames = matchedBranches.map((item) => item.name);

      for (const matchedBranch of matchedBranches.slice(0, 3)) {
        const branchCommits = await getGitlabCommits(gitlab, {
          ref_name: matchedBranch.name,
          per_page: 20,
        });

        commits.push(...branchCommits);
      }

      if (commits.length === 0) {
        commits = await getGitlabCommits(gitlab, {
          search: taskKey,
          per_page: 20,
        });
      }
    }

    const seenCommitIds = new Set();

    commits = commits.filter((commit) => {
      if (!commit?.id || seenCommitIds.has(commit.id)) {
        return false;
      }

      seenCommitIds.add(commit.id);
      return true;
    });

    const escapedTaskKey = String(taskKey).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const taskKeyPattern = new RegExp(`\\[?${escapedTaskKey}\\]?`, "i");

    const taskKeyCommits = commits.filter((commit) => {
      const title = commit.title || "";
      const message = commit.message || "";

      return taskKeyPattern.test(title) || taskKeyPattern.test(message);
    });

    const rawCommitCountBeforeTaskKeyFilter = commits.length;

    if (taskKeyCommits.length > 0) {
      commits = taskKeyCommits;
    } else {
      commits = [];
    }

    if (!commits || commits.length === 0) {
      const recentCommits = await getRecentGitlabCommits(gitlab);

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
    const prompt = [
      "از روی عنوان کامیت‌های زیر، یک گزارش کارکرد فارسی کامل اما خلاصه تولید کن.",
      "خروجی فقط شامل بولت پوینت باشد.",
      "قطعیت بیش از حد نده؛ متن باید به عنوان پیش‌نویس قابل بررسی توسط برنامه‌نویس باشد.",
      "",
      `Task: ${taskKey}`,
      `Branch: ${branch || "not provided; searched commits by task key"}`,
      "",
      "Commits:",
      commits.map((c) => `- ${c.title}`).join("\n"),
    ].join("\n");

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    console.log("GitLab AI sync request started", {
      model: process.env.GEMINI_MODEL,
      promptLength: prompt.length,
      commitCount: commits.length,
      useSocksProxy: USE_SOCKS_PROXY,
    });

    const timeSuggestion = calculateEvidenceTimeSuggestion(commits);

    try {
      const aiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        buildGeminiRequestConfig(45000),
      );

      console.log("AI Report request finished", {
        status: aiResp.status,
      });

      return res.json({
        success: true,
        description:
          aiResp.data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
        durationMinutes: timeSuggestion.suggestedDurationMinutes,
        suggestedStartTime: timeSuggestion.suggestedStartTime,
        suggestedEndTime: timeSuggestion.suggestedEndTime,
        suggestedDurationMinutes: timeSuggestion.suggestedDurationMinutes,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        confidenceScore: timeSuggestion.confidenceScore,
        confidenceLabel: timeSuggestion.confidenceLabel,
        commits: commits.map(mapGitlabCommitForClient),
        evidence: {
          taskKey,
          branch: branch || undefined,
          matchedBranches: matchedBranchNames,
          commitCount: commits.length,
          firstCommitAt: timeSuggestion.firstEvidenceAt,
          lastCommitAt: timeSuggestion.lastEvidenceAt,
          excludedGapMinutes: timeSuggestion.excludedGapMinutes,
          reasoning: timeSuggestion.reasoning,
        },
      });
    } catch (aiErr) {
      const providerStatus = aiErr.response?.status ?? 500;
      const providerMessage =
        aiErr.code === "ECONNABORTED"
          ? "درخواست AI بیشتر از حد مجاز طول کشید."
          : aiErr.response?.data?.error?.message ||
            aiErr.response?.data?.message ||
            aiErr.message;

      const fallbackDescription = [
        `AI برای ${taskKey} در حال حاضر پاسخ نداد یا به محدودیت خورد.`,
        "کامیت‌های مرتبط پیدا شدند و می‌توانی متن را دستی از روی آن‌ها تکمیل کنی:",
        "",
        ...commits.map((commit) => `- ${commit.title}`),
      ].join("\n");

      return res.json({
        success: false,
        code:
          aiErr.code === "ECONNABORTED"
            ? "AI_PROVIDER_TIMEOUT"
            : "AI_PROVIDER_FAILED",
        description: fallbackDescription,
        fallbackDescription,
        durationMinutes: timeSuggestion.suggestedDurationMinutes,
        suggestedStartTime: timeSuggestion.suggestedStartTime,
        suggestedEndTime: timeSuggestion.suggestedEndTime,
        suggestedDurationMinutes: timeSuggestion.suggestedDurationMinutes,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        confidenceScore: 55,
        confidenceLabel: "manual-review",
        providerMessage,
        commits: commits.map(mapGitlabCommitForClient),
        evidence: {
          taskKey,
          branch: branch || undefined,
          matchedBranches: matchedBranchNames,
          commitCount: commits.length,
          firstCommitAt: timeSuggestion.firstEvidenceAt,
          lastCommitAt: timeSuggestion.lastEvidenceAt,
          excludedGapMinutes: timeSuggestion.excludedGapMinutes,
          reasoning: "کامیت‌ها پیدا شدند اما AI نتوانست پیش‌نویس نهایی بسازد.",
        },
      });
    }
  } catch (err) {
    const status = err.response?.status ?? 500;
    const providerMessage =
      err.code === "ECONNABORTED"
        ? "AI provider request timed out after 45 seconds."
        : (err.response?.data?.error?.message ??
          err.response?.data?.message ??
          err.message);

    console.error("AI Report Gen failed", {
      status,
      code: err.code,
      message: err.message,
      providerMessage,
    });

    return res.status(500).json({
      success: false,
      error: "AI Summary generation failed. Check proxy and AI configuration.",
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
  saveRuntimeIntegrationConfig();

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

  saveRuntimeIntegrationConfig();

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
    const response = await axios.get(
      `${config.baseUrl}/rest/api/${config.apiVersion}/myself`,
      buildJiraAxiosAuthConfig(config),
    );

    return res.json({
      success: true,
      provider: "jira",
      account:
        response.data?.displayName ||
        response.data?.emailAddress ||
        config.email,
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
    const userResponse = await axios.get(`${config.baseUrl}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": config.token },
    });

    const actualUsername = userResponse.data?.username || "";
    const usernameWarning =
      config.username && actualUsername && config.username !== actualUsername
        ? `Token belongs to "${actualUsername}", not "${config.username}".`
        : null;

    await axios.get(
      `${config.baseUrl}/api/v4/projects/${encodeURIComponent(config.projectId)}`,
      {
        headers: { "PRIVATE-TOKEN": config.token },
      },
    );

    return res.json({
      success: true,
      provider: "gitlab",
      account: actualUsername || userResponse.data?.name || "GitLab user",
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
    if (isMockIntegrationMode()) {
      const response = mockJiraIssues.map(mapMockJiraIssueToExternalTask);
      return res.json(response);
    }

    return res.status(500).json({
      success: false,
      error: "Jira is not configured.",
    });
  }

  try {
    const response = await axios.get(
      `${jira.baseUrl}/rest/api/${jira.apiVersion}/search`,
      {
        ...buildJiraAxiosAuthConfig(jira),
        params: {
          jql: jira.jql,
          maxResults: 50,
          fields: getConfiguredJiraSearchFields(),
        },
      },
    );

    return res.json(
      (response.data.issues ?? []).map((issue) =>
        mapJiraIssueToExternalTask(issue, jira.mapping),
      ),
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
function reportPurposeInstruction(purpose) {
  switch (purpose) {
    case "daily":
      return "هدف گزارش: ارائه دیلی خیلی کوتاه. خروجی باید نهایتاً ۵ بولت کوتاه باشد و روی کارهای انجام‌شده تمرکز کند.";
    case "lead":
      return "هدف گزارش: ارائه به لید فنی. خروجی باید شامل کارهای انجام‌شده، ریسک‌ها، وابستگی‌ها و قدم بعدی باشد.";
    case "self_review":
      return "هدف گزارش: ارزیابی شخصی. خروجی باید نقاط قوت، کمبودها، تمرکز زمانی و پیشنهاد بهبود فردی را بگوید.";
    case "managerial":
      return "هدف گزارش: گزارش مدیریتی. خروجی باید رسمی، خلاصه، نتیجه‌محور و قابل ارائه به مدیر باشد.";
    default:
      return "هدف گزارش: خلاصه عملکرد کاری.";
  }
}

function truncateText(value, maxLength = 240) {
  return String(value ?? "").slice(0, maxLength);
}

app.post("/api/reports/ai-summary", async (req, res) => {
  const missingAiEnv = getAiMissingEnv();

  if (missingAiEnv.length > 0) {
    return res.status(500).json({
      success: false,
      error: `AI configuration is incomplete: ${missingAiEnv.join(", ")}`,
    });
  }

  const {
    rangeLabel = "",
    purpose = "daily",
    tone = "managerial",
    detailLevel = "balanced",
    language = "fa",
    attendanceSummary = {},
    topActivities = [],
    tasks = [],
  } = req.body ?? {};

  const safeTopActivities = Array.isArray(topActivities)
    ? topActivities.slice(0, 8)
    : [];

  const safeTasks = Array.isArray(tasks)
    ? tasks.slice(0, 20).map((task) => ({
        id: task.id,
        title: truncateText(task.title, 160),
        projectTitle: truncateText(task.projectTitle, 80),
        date: truncateText(task.date, 32),
        durationMinutes: Number(task.durationMinutes ?? 0),
        status: truncateText(task.status, 40),
        description: truncateText(task.description, 260),
      }))
    : [];

  const promptLines = [
    "شما یک دستیار هوش مصنوعی برای تولید گزارش عملکرد پرسنل هستید.",
    "بر اساس داده‌های واقعی WTT، یک گزارش فارسی حرفه‌ای و قابل بازبینی تولید کن.",
    "بدون ادعای قطعی و بدون ساختن داده جدید بنویس؛ فقط از داده‌های داده‌شده استفاده کن.",
    `لحن گزارش: ${tone}`,
    `سطح جزئیات: ${detailLevel}`,
    `زبان خروجی: ${language}`,
    reportPurposeInstruction(purpose),
    "",
    `بازه زمانی: ${rangeLabel}`,
    "خلاصه حضور و غیاب:",
    `- مجموع حضور: ${attendanceSummary.presenceMinutes ?? 0} دقیقه`,
    `- کل کارکرد: ${attendanceSummary.totalWorkMinutes ?? 0} دقیقه`,
    `- کارکرد مورد انتظار: ${attendanceSummary.expectedMinutes ?? 0} دقیقه`,
    `- اضافه‌کار/کسرکار: ${attendanceSummary.overtimeMinutes ?? 0} دقیقه`,
    `- راندمان میانگین: ${attendanceSummary.averageEfficiency ?? 0}%`,
    `- روزهای دارای تسک: ${attendanceSummary.taskDays ?? 0} روز`,
    `- تعداد ناهار: ${attendanceSummary.lunches ?? 0}`,
    `- روزهای بدون کارکرد: ${attendanceSummary.noWorkDays ?? 0} روز`,
    `- مرخصی تاییدشده: ${attendanceSummary.acceptedVacations ?? 0}`,
    `- ماموریت تاییدشده: ${attendanceSummary.acceptedMissions ?? 0}`,
    "",
    "عمده فعالیت‌ها:",
  ];

  safeTopActivities.forEach((act) => {
    promptLines.push(
      `- پروژه ${truncateText(act.projectName, 80)} (${truncateText(act.serviceName, 80)}): ${Number(act.spentMinutes ?? 0)} دقیقه (${truncateText(act.percentageText, 24)})`,
    );
  });

  promptLines.push("", "تسک‌های ثبت‌شده در این بازه:");

  safeTasks.forEach((task) => {
    promptLines.push(
      `- [${task.id}] ${task.title} | پروژه: ${task.projectTitle} | تاریخ: ${task.date} | مدت: ${task.durationMinutes} دقیقه | وضعیت: ${task.status} | توضیح: ${task.description || "بدون توضیح"}`,
    );
  });

  promptLines.push(
    "",
    "خروجی را منظم، خوانا و آماده ارائه بنویس. اگر هدف daily است خیلی کوتاه بنویس. اگر هدف lead است، ریسک‌ها و قدم بعدی را هم اضافه کن. اگر هدف self_review است، پیشنهاد بهبود فردی بده.",
  );

  const prompt = promptLines.join("\n");
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  console.log("AI Report request started", {
    model: process.env.GEMINI_MODEL,
    promptLength: prompt.length,
    taskCount: safeTasks.length,
    topActivityCount: safeTopActivities.length,
    useSocksProxy: USE_SOCKS_PROXY,
  });

  try {
    const aiResp = await axios.post(
      geminiUrl,
      {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      },
      buildGeminiRequestConfig(45000),
    );
    console.log("AI Report request finished", {
      status: aiResp.status,
    });

    const generatedText =
      aiResp.data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return res.json({
      success: true,
      summary: generatedText,
      model: process.env.GEMINI_MODEL,
    });
  } catch (err) {
    const status = err.response?.status ?? 500;
    const providerMessage =
      err.code === "ECONNABORTED"
        ? "AI provider request timed out after 45 seconds."
        : (err.response?.data?.error?.message ??
          err.response?.data?.message ??
          err.message);

    console.error("AI Report Gen failed", {
      status,
      code: err.code,
      message: err.message,
      providerMessage,
    });

    return res.status(500).json({
      success: false,
      error: "AI Summary generation failed. Check proxy and AI configuration.",
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

const HOST = process.env.HOST ?? "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Proxy up on http://${HOST}:${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
