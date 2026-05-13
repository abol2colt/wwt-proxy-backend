require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { SocksProxyAgent } = require("socks-proxy-agent");

// =============================================================================
// Smart Worklog Proxy
// =============================================================================
// EN: This proxy is the integration layer between Angular WTT frontend,
// local GitLab sandbox, mock Jira issues, and Gemini AI.
// =============================================================================

const app = express();

// -----------------------------------------------------------------------------
// Runtime configuration
// -----------------------------------------------------------------------------

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:4200";

const GITLAB_URL = process.env.GITLAB_URL;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_PROJECT_ID = process.env.PROJECT_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SOCKS_PROXY_URL =
process.env.SOCKS_PROXY_URL || "socks5://127.0.0.1:1080";

const proxyAgent = new SocksProxyAgent(SOCKS_PROXY_URL);

// -----------------------------------------------------------------------------
// Express middleware
// -----------------------------------------------------------------------------
const corsOptions = {
origin: FRONTEND_ORIGIN,
methods: ["GET", "POST", "OPTIONS"],
allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.\*/, cors(corsOptions));
app.use(express.json());

// =============================================================================
// Utility helpers
// =============================================================================

function clamp(value, min, max) {
return Math.min(max, Math.max(min, value));
}

function roundToNearest15(minutes) {
return Math.max(15, Math.round(minutes / 15) \* 15);
}

function estimateDurationMinutes({ commitsCount, estimatedMinutes }) {
if (estimatedMinutes > 0) {
return roundToNearest15(clamp(estimatedMinutes, 30, 480));
}

const baseMinutes = 30;
const perCommitMinutes = 30;
const rawEstimate = baseMinutes + commitsCount \* perCommitMinutes;

return roundToNearest15(clamp(rawEstimate, 30, 480));
}

function getConfidence({ taskKey, branchName, commitsCount }) {
const normalizedTaskKey = taskKey.toLowerCase();
const normalizedBranch = branchName.toLowerCase();
const branchMatches = normalizedBranch.includes(normalizedTaskKey);

if (branchMatches && commitsCount > 0) return "high";
if (commitsCount > 0) return "medium";

return "low";
}

function buildCommitSummary(commits) {
return commits
.map((commit, index) => {
const title = commit.title || commit.message || "Untitled commit";
const shortId = commit.short_id ? ` (${commit.short_id})` : "";

      return `${index + 1}. ${title}${shortId}`;
    })
    .join("\n");

}

function extractGeminiText(response) {
return (
response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
"- خلاصه‌ای از کامیت‌های مرتبط تولید شد، اما متن دقیق از سرویس AI دریافت نشد."
);
}

function buildFallbackPersianDescription({ taskKey, commits }) {
const bullets = commits.slice(0, 5).map((commit) => {
const title = commit.title || commit.message || "انجام تغییرات مرتبط";

    return `- ${title}`;

});

if (bullets.length === 0) {
return `- انجام تغییرات مرتبط با تسک ${taskKey}`;
}

return bullets.join("\n");
}

function validateGitlabConfig() {
const missing = [];

if (!GITLAB_URL) missing.push("GITLAB_URL");
if (!GITLAB_TOKEN) missing.push("GITLAB_TOKEN");
if (!GITLAB_PROJECT_ID) missing.push("PROJECT_ID");

return missing;
}

function validateGeminiConfig() {
const missing = [];

if (!GEMINI_API_KEY) missing.push("GEMINI_API_KEY");

return missing;
}

// =============================================================================
// GitLab + Gemini Smart Worklog endpoint
// =============================================================================
// Reads GitLab commits related to the selected Jira-like task and asks Gemini
// to turn them into a short Persian WTT worklog description.
// Example:
// GET /api/sync-gitlab?taskKey=IDEAL-730&branch=feature%2FIDEAL-730-best-limits-contract
// =============================================================================

app.get("/api/sync-gitlab", async (req, res) => {
try {
// -------------------------------------------------------------------------
// 1) Read request context
// -------------------------------------------------------------------------

    const taskKey = String(req.query.taskKey || "").trim();
    const branchName = String(req.query.branch || "").trim();
    const estimatedMinutes = Number(req.query.estimatedMinutes || 0);

    if (!taskKey) {
      return res.status(400).json({
        success: false,
        error: "taskKey الزامی است.",
      });
    }
    // -------------------------------------------------------------------------
    // 2) Validate required environment variables
    // -------------------------------------------------------------------------
    const missingGitlabConfig = validateGitlabConfig();

    if (missingGitlabConfig.length > 0) {
      return res.status(500).json({
        success: false,
        error: `GitLab config is incomplete: ${missingGitlabConfig.join(", ")}`,
      });
    }

    // -------------------------------------------------------------------------
    // 3) Fetch commits from GitLab
    // -------------------------------------------------------------------------
    console.log("[sync-gitlab] Fetching branch-only commits", {
      taskKey,
      branchName: branchName || "N/A",
    });

    let commits = [];

    if (branchName) {
      const projectResponse = await axios.get(
        `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}`,
        {
          headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
        },
      );

      const defaultBranch = projectResponse.data?.default_branch || "main";

      const compareResponse = await axios.get(
        `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}/repository/compare`,
        {
          headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
          params: {
            from: defaultBranch,
            to: branchName,
          },
        },
      );

      commits = Array.isArray(compareResponse.data?.commits)
        ? compareResponse.data.commits
        : [];
    } else {
      const gitlabResponse = await axios.get(
        `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}/repository/commits`,
        {
          headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
          params: {
            per_page: 50,
          },
        },
      );

      commits = Array.isArray(gitlabResponse.data) ? gitlabResponse.data : [];
    }
    // -------------------------------------------------------------------------
    // 4) Filter commits by task key / branch context
    // -------------------------------------------------------------------------
    const taskKeyLower = taskKey.toLowerCase();
    const branchMatchesTask = branchName.toLowerCase().includes(taskKeyLower);

    const relatedCommits = commits.filter((commit) => {
      const text =
        `${commit.title || ""}\n${commit.message || ""}`.toLowerCase();

      return branchMatchesTask || text.includes(taskKeyLower);
    });

    if (relatedCommits.length === 0) {
      return res.json({
        success: false,
        taskKey,
        branch: branchName,
        description: "کامیت مرتبطی برای این تسک پیدا نشد.",
        durationMinutes: 0,
        commitsCount: 0,
        confidence: "low",
      });
    }

    // -------------------------------------------------------------------------
    // 5) Estimate duration
    // -------------------------------------------------------------------------

    const totalMinutes = estimateDurationMinutes({
      commitsCount: relatedCommits.length,
      estimatedMinutes,
    });

    const confidence = getConfidence({
      taskKey,
      branchName,
      commitsCount: relatedCommits.length,
    });

    const commitSummary = buildCommitSummary(relatedCommits);

    // -------------------------------------------------------------------------
    // 6) Build a strict AI prompt
    // -------------------------------------------------------------------------
    const prompt = `

تو یک دستیار ثبت کارکرد برنامه‌نویس هستی.

خروجی فقط باید متن توضیحات worklog برای فیلد توضیحات WTT باشد.
هیچ عنوانی مثل "گزارش کارکرد رسمی"، "تاریخ"، "پروژه"، "دوره گزارش‌دهی" ننویس.
هیچ placeholder مثل [نام پروژه] یا [تاریخ] ننویس.
حداکثر 3 تا 5 bullet کوتاه فارسی بنویس.
هر bullet با "- " شروع شود.
از اغراق، حدس زیاد، و متن اداری طولانی پرهیز کن.
فقط بر اساس داده‌های commit بنویس.
اگر داده کم بود، خلاصه و محتاط بنویس.

تسک:
${taskKey}

برنچ:
${branchName || "نامشخص"}

کامیت‌های مرتبط:
${commitSummary}
`.trim();

    // -------------------------------------------------------------------------
    // 7) Ask Gemini
    // -------------------------------------------------------------------------

    console.log("[sync-gitlab] Sending related commits to Gemini", {
      relatedCommits: relatedCommits.length,
      confidence,
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    let aiPersianDescription = "";
    let aiUsed = true;

    try {
      const aiResponse = await axios.post(geminiUrl, geminiPayload, {
        httpsAgent: proxyAgent,
        timeout: 45_000,
      });

      aiPersianDescription = extractGeminiText(aiResponse);
    } catch (aiError) {
      aiUsed = false;

      console.warn("[sync-gitlab] Gemini failed, using fallback description", {
        message: aiError.message,
        status: aiError.response?.status,
      });

      aiPersianDescription = buildFallbackPersianDescription({
        taskKey,
        commits: relatedCommits,
      });
    }

    // -------------------------------------------------------------------------
    // 8) Return structured response to Angular
    // -------------------------------------------------------------------------

    return res.json({
      success: true,
      taskKey,
      branch: branchName,
      description: aiPersianDescription,
      durationMinutes: totalMinutes,
      commitsCount: relatedCommits.length,
      confidence,
      aiUsed,
    });

} catch (error) {
const upstreamStatus = error.response?.status;
const upstreamData = error.response?.data;

    console.error("[sync-gitlab] API Error:", error.message);

    if (upstreamData) {
      console.error("[sync-gitlab] Upstream details:", upstreamData);
    }

    if (upstreamStatus === 404) {
      return res.status(404).json({
        success: false,
        error: "branch یا ref انتخاب‌شده در GitLab پیدا نشد.",
        debugMessage: error.message,
        upstreamStatus,
        upstreamData,
      });
    }

    return res.status(500).json({
      success: false,
      error: "خطا در ارتباط با GitLab یا سرویس AI.",
      debugMessage: error.message,
      upstreamStatus,
      upstreamData,
    });

}
});

// =============================================================================
// Jira Mock Mapping
// =============================================================================
// This is not real Jira yet. It is a Jira-like contract for the frontend.
//
// Future real flow:
// Jira API issue/component/label/custom-field
// -> Proxy mapping layer
// -> WTT-compatible issue shape
// -> Angular smart task modal
// =============================================================================

const wttMappings = {
neobrkDevelopment: {
project_id: 30,
project_title: "NeoBRK",
service_id: 233,
service_title: "توسعه",
contract_id: 45,
contract_title: "ایده آل کوشا",
},

irptDevelopment: {
project_id: 33,
project_title: "IRPT",
service_id: 229,
service_title: "توسعه",
contract_id: 2,
contract_title: "IRPT - 1403 - طراحی و بهره برداری",
},

irptDevops: {
project_id: 33,
project_title: "IRPT",
service_id: 143,
service_title: "DevOps",
contract_id: 23,
contract_title: "سانای",
},

irptSecurity: {
project_id: 33,
project_title: "IRPT",
service_id: 348,
service_title: "امنیت",
contract_id: 27,
contract_title: "R&D",
},

irptTestingDocs: {
project_id: 33,
project_title: "IRPT",
service_id: 461,
service_title: "تست و مستندسازی و کارهای جانبی",
contract_id: 23,
contract_title: "سانای",
},
};


const mockJiraIssues = [
{
key: "IDEAL-730",
title: "بهبود سرویس getOptionContract برای ارسال best limits",
mapping: wttMappings.neobrkDevelopment,
branch_name: "feature/IDEAL-730-best-limits-contract",
status: "in_progress",
estimated_minutes: 90,
},
{
key: "IDEAL-992",
title: "بررسی و review نهایی + merge",
mapping: wttMappings.neobrkDevelopment,
branch_name: "feature/IDEAL-992-final-review-merge",
status: "review",
estimated_minutes: 60,
},
{
key: "IRPT-101",
title: "پیاده‌سازی فرم ثبت سفارش در پنل IRPT",
mapping: wttMappings.irptDevelopment,
branch_name: "feature/IRPT-101-order-form",
status: "todo",
estimated_minutes: 120,
},
{
key: "IRPT-102",
title: "رفع خطای pagination در لیست سفارش‌ها",
mapping: wttMappings.irptDevelopment,
branch_name: "bugfix/IRPT-102-orders-pagination",
status: "in_progress",
estimated_minutes: 75,
},
{
key: "IRPT-103",
title: "بهبود Docker compose برای محیط توسعه",
mapping: wttMappings.irptDevops,
branch_name: "chore/IRPT-103-dev-compose",
status: "todo",
estimated_minutes: 90,
},
{
key: "IRPT-104",
title: "افزودن لاگ‌های امنیتی برای درخواست‌های حساس",
mapping: wttMappings.irptSecurity,
branch_name: "feature/IRPT-104-security-logs",
status: "in_progress",
estimated_minutes: 90,
},
{
key: "IRPT-105",
title: "نوشتن مستند تست سناریوهای ورود کاربر",
mapping: wttMappings.irptTestingDocs,
branch_name: "docs/IRPT-105-login-test-scenarios",
status: "todo",
estimated_minutes: 60,
},
{
key: "IRPT-106",
title: "رفع مشکل نمایش وضعیت سفارش در داشبورد",
mapping: wttMappings.irptDevelopment,
branch_name: "bugfix/IRPT-106-dashboard-order-status",
status: "review",
estimated_minutes: 75,
},
{
key: "IRPT-107",
title: "بهینه‌سازی queryهای گزارش‌گیری",
mapping: wttMappings.irptDevelopment,
branch_name: "feature/IRPT-107-report-query-optimization",
status: "in_progress",
estimated_minutes: 120,
},
{
key: "IRPT-108",
title: "بررسی دسترسی‌ها و نقش‌های کاربری",
mapping: wttMappings.irptSecurity,
branch_name: "feature/IRPT-108-role-permissions",
status: "todo",
estimated_minutes: 90,
},
];

// -----------------------------------------------------------------------------
// GET /api/jira/mock-tasks
// -----------------------------------------------------------------------------

app.get("/api/jira/mock-tasks", (req, res) => {
const response = mockJiraIssues.map((issue) => ({
id: issue.key,
key: issue.key,
title: issue.title,

    project_id: issue.mapping.project_id,
    project_title: issue.mapping.project_title,

    service_id: issue.mapping.service_id,
    service_title: issue.mapping.service_title,

    contract_id: issue.mapping.contract_id,
    contract_title: issue.mapping.contract_title,

    branch_name: issue.branch_name,
    status: issue.status,
    estimated_minutes: issue.estimated_minutes,

}));

return res.json(response);
});

// =============================================================================
// Health check / startup
// =============================================================================

app.get("/api/health", (req, res) => {
return res.json({
ok: true,
service: "smart-worklog-proxy",
});
});

app.listen(PORT, () => {
console.log(`🚀 Smart Worklog Proxy is running on port ${PORT}`);
console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
console.log(`🔗 Jira mock: http://localhost:${PORT}/api/jira/mock-tasks`);
});
