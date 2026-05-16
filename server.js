require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { SocksProxyAgent } = require("socks-proxy-agent");

const app = express();

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:4200";
const USE_SOCKS_PROXY = process.env.USE_SOCKS_PROXY === "true";
const SOCKS_PROXY_URL = process.env.SOCKS_PROXY_URL ?? "socks5://127.0.0.1:1080";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const proxyAgent = USE_SOCKS_PROXY ? new SocksProxyAgent(SOCKS_PROXY_URL) : undefined;

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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "wtt-proxy",
    jiraMode: "mock",
    gitProvider: process.env.GITLAB_URL ? "gitlab-compatible" : "not-configured",
    aiProvider: process.env.GEMINI_MODEL ? "gemini-compatible" : "not-configured",
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

    res.json({
      success: true,
      description: aiResp.data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      durationMinutes: commits.length * 45, // Temporary MVP heuristic. Branch 016 replaces this.
      evidence: {
        taskKey,
        branch,
        commitCount: commits.length,
        firstCommitAt: commits[commits.length - 1]?.created_at,
        lastCommitAt: commits[0]?.created_at,
      },
    });
  } catch (err) {
    const status = err.response?.status ?? 500;

    console.error("Sync failed", {
      status,
      message: err.message,
      providerMessage: err.response?.data?.message ?? err.response?.data?.error?.message,
    });

    res.status(500).json({
      success: false,
      error: "GitLab/AI sync failed. Check proxy logs and local environment configuration.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy up on ${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
