require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { SocksProxyAgent } = require("socks-proxy-agent");

const app = express();

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

function getMissingEnv(keys) {
  return keys.filter((key) => !process.env[key]);
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
  const rawLastCommitAt = sortedCommits[sortedCommits.length - 1].created_at;
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "wtt-proxy",
    jiraMode: "mock",
    gitProvider: process.env.GITLAB_URL
      ? "gitlab-compatible"
      : "not-configured",
    aiProvider: process.env.GEMINI_MODEL
      ? "gemini-compatible"
      : "not-configured",
  });
});

app.get("/api/jira/mock-tasks", (req, res) => {
  const response = mockJiraIssues.map((issue) => ({
    id: issue.key,
    key: issue.key,
    title: issue.title,
    project_id: issue.mapping.project_id,
    service_id: issue.mapping.service_id,
    contract_id: issue.mapping.contract_id,
    branch_name: issue.branch,
    source: "mock-jira",
  }));

  res.json(response);
});

app.get("/api/sync-gitlab", async (req, res) => {
  const { taskKey, branch } = req.query;

  if (!taskKey || !branch) {
    return res.status(400).json({
      success: false,
      error: "taskKey and branch are required.",
    });
  }

  const missingEnv = getMissingEnv([
    "GITLAB_URL",
    "PROJECT_ID",
    "GITLAB_TOKEN",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
  ]);

  if (missingEnv.length > 0) {
    return res.status(500).json({
      success: false,
      error: `Proxy configuration is incomplete: ${missingEnv.join(", ")}`,
    });
  }

  try {
    const resp = await axios.get(
      `${process.env.GITLAB_URL}/api/v4/projects/${process.env.PROJECT_ID}/repository/commits`,
      {
        headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN },
        params: { ref_name: branch, per_page: 20 },
      },
    );

    const commits = resp.data;

    if (!commits || commits.length === 0) {
      return res.json({
        success: false,
        description: "کامیتی در این برنچ یافت نشد.",
        durationMinutes: 0,
      });
    }

    const prompt = [
      "از روی عنوان کامیت‌های زیر، یک گزارش کارکرد فارسی کامل اما خلاصه تولید کن.",
      "خروجی فقط شامل بولت پوینت باشد.",
      "قطعیت بیش از حد نده؛ متن باید به عنوان پیش‌نویس قابل بررسی توسط برنامه‌نویس باشد.",
      "",
      `Task: ${taskKey}`,
      `Branch: ${branch}`,
      "",
      "Commits:",
      commits.map((c) => `- ${c.title}`).join("\n"),
    ].join("\n");

    const aiResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      proxyAgent ? { httpsAgent: proxyAgent } : undefined,
    );

    const timeSuggestion = calculateEvidenceTimeSuggestion(commits);

    res.json({
      success: true,
      description: aiResp.data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      durationMinutes: timeSuggestion.suggestedDurationMinutes,
      suggestedStartTime: timeSuggestion.suggestedStartTime,
      suggestedEndTime: timeSuggestion.suggestedEndTime,
      suggestedDurationMinutes: timeSuggestion.suggestedDurationMinutes,
      excludedGapMinutes: timeSuggestion.excludedGapMinutes,
      confidenceScore: timeSuggestion.confidenceScore,
      confidenceLabel: timeSuggestion.confidenceLabel,
      evidence: {
        taskKey,
        branch,
        commitCount: commits.length,
        firstCommitAt: timeSuggestion.firstEvidenceAt,
        lastCommitAt: timeSuggestion.lastEvidenceAt,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        reasoning: timeSuggestion.reasoning,
      },
    });
  } catch (err) {
    const status = err.response?.status ?? 500;

    console.error("Sync failed", {
      status,
      message: err.message,
      providerMessage:
        err.response?.data?.message ?? err.response?.data?.error?.message,
    });

    res.status(500).json({
      success: false,
      error:
        "GitLab/AI sync failed. Check proxy logs and local environment configuration.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy up on ${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
