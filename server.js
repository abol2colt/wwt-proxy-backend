require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { SocksProxyAgent } = require("socks-proxy-agent");

// =============================================================================
// Smart Worklog Proxy
// =============================================================================
// EN: This proxy is the integration layer between Angular WTT frontend,
//     local GitLab sandbox, mock Jira issues, and Gemini AI.
//
// FA:
// این فایل نقش یک لایه واسط را دارد.
// فرانت نباید مستقیم با GitLab، Jira یا Gemini حرف بزند.
// فرانت فقط به این proxy درخواست می‌دهد و proxy داده‌ها را آماده، فیلتر و قابل مصرف می‌کند.
//
// هدف MVP فعلی:
// 1. دریافت taskهای Jira-like از mock
// 2. نگاشت task به project/service/contract معتبر WTT
// 3. دریافت commitهای GitLab مربوط به همان task/branch
// 4. ساخت توضیح کوتاه فارسی برای textarea توضیحات WTT
// 5. بدون ثبت واقعی task در WTT
// =============================================================================

const app = express();

// -----------------------------------------------------------------------------
// Runtime configuration
// -----------------------------------------------------------------------------
// FA:
// همه تنظیمات حساس باید از .env بیاید، نه از کد.
// .env نباید commit شود.
// فقط .env.example را commit می‌کنیم.

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:4200";

const GITLAB_URL = process.env.GITLAB_URL;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_PROJECT_ID = process.env.PROJECT_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// FA:
// چون Gemini ممکن است از شبکه مستقیم در دسترس نباشد، درخواست Gemini را با SOCKS/V2Ray می‌فرستیم.
// اگر بعداً Gemini مستقیم در دسترس بود، می‌توانیم این بخش را شرطی کنیم.
const SOCKS_PROXY_URL =
  process.env.SOCKS_PROXY_URL || "socks5://127.0.0.1:1080";

const proxyAgent = new SocksProxyAgent(SOCKS_PROXY_URL);

// -----------------------------------------------------------------------------
// Express middleware
// -----------------------------------------------------------------------------
// FA:
// Angular روی localhost:4200 اجرا می‌شود و proxy روی localhost:3000.
// این دو origin متفاوت هستند، پس CORS لازم داریم.
//
// Authorization را allow کردیم چون ممکن است interceptor فرانت آن را بفرستد.
// ولی راه بهتر این است که authInterceptor برای smart proxy اصلاً Authorization نفرستد.

const corsOptions = {
  origin: FRONTEND_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

// =============================================================================
// Utility helpers
// =============================================================================

// FA:
// عدد را بین min و max محدود می‌کند.
// برای جلوگیری از durationهای غیرواقعی استفاده می‌کنیم.
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// FA:
// زمان را به نزدیک‌ترین ۱۵ دقیقه گرد می‌کنیم.
// چون ثبت کارکرد معمولاً با بازه‌های ۱۵ دقیقه‌ای قابل فهم‌تر است.
function roundToNearest15(minutes) {
  return Math.max(15, Math.round(minutes / 15) * 15);
}

// FA:
// duration را rule-based حساب می‌کنیم، نه با AI.
// دلیل: AI ممکن است حدس بزند یا خروجی ناپایدار بدهد.
// پس زمان باید deterministic و قابل توضیح باشد.
function estimateDurationMinutes({ commitsCount, estimatedMinutes }) {
  if (estimatedMinutes > 0) {
    return roundToNearest15(clamp(estimatedMinutes, 30, 480));
  }

  const baseMinutes = 30;
  const perCommitMinutes = 30;
  const rawEstimate = baseMinutes + commitsCount * perCommitMinutes;

  return roundToNearest15(clamp(rawEstimate, 30, 480));
}

// FA:
// confidence به فرانت می‌گوید چقدر مطمئنیم این commitها مربوط به task انتخاب‌شده‌اند.
//
// high:
// branch شامل taskKey بوده و commit مرتبط داریم.
//
// medium:
// commit مرتبط داریم ولی branch کاملاً taskKey را تأیید نکرده.
//
// low:
// commit مرتبط نداریم.
function getConfidence({ taskKey, branchName, commitsCount }) {
  const normalizedTaskKey = taskKey.toLowerCase();
  const normalizedBranch = branchName.toLowerCase();
  const branchMatches = normalizedBranch.includes(normalizedTaskKey);

  if (branchMatches && commitsCount > 0) return "high";
  if (commitsCount > 0) return "medium";

  return "low";
}

// FA:
// فعلاً فقط title/message کامیت‌ها را به AI می‌دهیم.
// diff کامل نمی‌دهیم تا هم خروجی کوتاه‌تر شود، هم ریسک ارسال کد حساس کمتر شود.
// مرحله بعد می‌توانیم diff کوتاه و محدود اضافه کنیم.
function buildCommitSummary(commits) {
  return commits
    .map((commit, index) => {
      const title = commit.title || commit.message || "Untitled commit";
      const shortId = commit.short_id ? ` (${commit.short_id})` : "";

      return `${index + 1}. ${title}${shortId}`;
    })
    .join("\n");
}

// FA:
// خروجی Gemini همیشه تضمین‌شده نیست.
// اگر ساختار response تغییر کرد یا متن خالی بود، نباید server crash کند.
function extractGeminiText(response) {
  return (
    response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    "- خلاصه‌ای از کامیت‌های مرتبط تولید شد، اما متن دقیق از سرویس AI دریافت نشد."
  );
}

// FA:
// قبل از sync با GitLab، configهای ضروری را چک می‌کنیم.
function validateGitlabConfig() {
  const missing = [];

  if (!GITLAB_URL) missing.push("GITLAB_URL");
  if (!GITLAB_TOKEN) missing.push("GITLAB_TOKEN");
  if (!GITLAB_PROJECT_ID) missing.push("PROJECT_ID");

  return missing;
}

// FA:
// قبل از درخواست به Gemini، API key را چک می‌کنیم.
function validateGeminiConfig() {
  const missing = [];

  if (!GEMINI_API_KEY) missing.push("GEMINI_API_KEY");

  return missing;
}

// =============================================================================
// GitLab + Gemini Smart Worklog endpoint
// =============================================================================
// EN:
// Reads GitLab commits related to the selected Jira-like task and asks Gemini
// to turn them into a short Persian WTT worklog description.
//
// FA:
// این endpoint فقط draft می‌سازد.
// اینجا هیچ task واقعی در WTT ساخته/ویرایش/حذف نمی‌شود.
//
// Example:
// GET /api/sync-gitlab?taskKey=IDEAL-730&branch=feature%2FIDEAL-730-best-limits-contract
// =============================================================================

app.get("/api/sync-gitlab", async (req, res) => {
  try {
    // -------------------------------------------------------------------------
    // 1) Read request context
    // -------------------------------------------------------------------------
    // FA:
    // req فقط داخل route وجود دارد.
    // پس taskKey و branch را باید همین‌جا بخوانیم، نه بالای فایل.

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
    // FA:
    // اگر config ناقص باشد، به جای خطای مبهم، error واضح برمی‌گردانیم.

    const missingGitlabConfig = validateGitlabConfig();

    if (missingGitlabConfig.length > 0) {
      return res.status(500).json({
        success: false,
        error: `GitLab config is incomplete: ${missingGitlabConfig.join(", ")}`,
      });
    }

    const missingGeminiConfig = validateGeminiConfig();

    if (missingGeminiConfig.length > 0) {
      return res.status(500).json({
        success: false,
        error: `Gemini config is incomplete: ${missingGeminiConfig.join(", ")}`,
      });
    }

    // -------------------------------------------------------------------------
    // 3) Fetch commits from GitLab
    // -------------------------------------------------------------------------
    // FA:
    // اگر branch داشته باشیم، GitLab را با ref_name محدود می‌کنیم.
    // این باعث می‌شود commitهای بی‌ربط project وارد گزارش نشوند.
    //
    // نکته:
    // branchName باید دقیقاً همان چیزی باشد که روی GitLab push شده.

    const gitlabParams = {
      per_page: 50,
    };

    if (branchName) {
      gitlabParams.ref_name = branchName;
    }

    console.log("[sync-gitlab] Fetching commits", {
      taskKey,
      branchName: branchName || "N/A",
    });

    const gitlabResponse = await axios.get(
      `${GITLAB_URL}/api/v4/projects/${GITLAB_PROJECT_ID}/repository/commits`,
      {
        headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
        params: gitlabParams,
      },
    );

    const commits = Array.isArray(gitlabResponse.data)
      ? gitlabResponse.data
      : [];

    // -------------------------------------------------------------------------
    // 4) Filter commits by task key / branch context
    // -------------------------------------------------------------------------
    // FA:
    // اگر branch شامل taskKey باشد، commitهای همان branch را مرتبط حساب می‌کنیم.
    // چرا؟ چون معمولاً branch برای همان issue ساخته شده و ممکن است بعضی commit titleها taskKey نداشته باشند.
    //
    // اگر branch شامل taskKey نبود، title/message کامیت را بررسی می‌کنیم.

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
    // FA:
    // duration را از relatedCommits حساب می‌کنیم، نه از کل commits.
    // باگ قبلی این بود که کل commitهای برگشتی حساب می‌شدند.

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
    // FA:
    // prompt باید خروجی را محدود کند.
    // قبلاً چون گفتیم "گزارش رسمی"، Gemini خروجی طولانی و اداری می‌داد.
    // الان فقط متن کوتاه مناسب textarea توضیحات WTT می‌خواهیم.

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
    // FA:
    // فقط درخواست Gemini از SOCKS proxy استفاده می‌کند.
    // GitLab local مستقیم خوانده می‌شود و نیازی به SOCKS ندارد.

    console.log("[sync-gitlab] Sending related commits to Gemini", {
      relatedCommits: relatedCommits.length,
      confidence,
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    const aiResponse = await axios.post(geminiUrl, geminiPayload, {
      httpsAgent: proxyAgent,
      timeout: 45_000,
    });

    const aiPersianDescription = extractGeminiText(aiResponse);

    // -------------------------------------------------------------------------
    // 8) Return structured response to Angular
    // -------------------------------------------------------------------------
    // FA:
    // response را structured نگه می‌داریم تا فرانت بتواند description/time/confidence را جدا مدیریت کند.

    return res.json({
      success: true,
      taskKey,
      branch: branchName,
      description: aiPersianDescription,
      durationMinutes: totalMinutes,
      commitsCount: relatedCommits.length,
      confidence,
    });
  } catch (error) {
    // FA:
    // خطا را برای developer لاگ می‌کنیم ولی secret/token را به client برنمی‌گردانیم.

    console.error("[sync-gitlab] API Error:", error.message);

    if (error.response) {
      console.error("[sync-gitlab] Upstream details:", error.response.data);
    }

    return res.status(500).json({
      success: false,
      error: "خطا در ارتباط با GitLab یا سرویس AI.",
    });
  }
});

// =============================================================================
// Jira Mock Mapping
// =============================================================================
// EN:
// This is not real Jira yet. It is a Jira-like contract for the frontend.
//
// FA:
// این بخش فعلاً Jira واقعی نیست؛ قرارداد mock ماست.
// هدف این است که فرانت طوری کار کند که بعداً source داده از mock به Jira واقعی عوض شود
// بدون اینکه فرم WTT دوباره از اول نوشته شود.
//
// Future real flow:
// Jira API issue/component/label/custom-field
//   -> Proxy mapping layer
//   -> WTT-compatible issue shape
//   -> Angular smart task modal
// =============================================================================

// FA:
// این mappingها از WTT واقعی گرفته شده‌اند.
// یعنی project/service/contract در فرم WTT واقعاً قابل انتخاب هستند.
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

// FA:
// این‌ها taskهای mock هستند که شبیه Jira issue رفتار می‌کنند.
// هر task یک branch_name دارد تا بعداً GitLab sync بتواند commitهای همان branch را بگیرد.
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
// FA:
// خروجی این endpoint دقیقاً همان چیزی است که فرانت برای dropdown لازم دارد.
// id را برای backward compatibility نگه داشته‌ایم.
// key مدل واقعی‌تر Jira است.
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
// FA:
// health برای تست سریع اینکه proxy روشن است.
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
