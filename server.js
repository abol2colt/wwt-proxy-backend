require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { SocksProxyAgent } = require("socks-proxy-agent");

const app = express();
app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json());

const proxyAgent = new SocksProxyAgent("socks5://127.0.0.1:1080");

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

app.get("/api/jira/mock-tasks", (req, res) => {
  const response = mockJiraIssues.map((issue) => ({
    id: issue.key,
    key: issue.key,
    title: issue.title,
    project_id: issue.mapping.project_id,
    service_id: issue.mapping.service_id,
    contract_id: issue.mapping.contract_id,
    branch_name: issue.branch,
  }));
  res.json(response);
});

app.get("/api/sync-gitlab", async (req, res) => {
  const { taskKey, branch } = req.query;
  try {
    // فقط کامیت‌های همون برنچ رو بگیر
    const resp = await axios.get(
      `${process.env.GITLAB_URL}/api/v4/projects/${process.env.PROJECT_ID}/repository/commits`,
      {
        headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN },
        params: { ref_name: branch, per_page: 5 },
      },
    );

    const commits = resp.data;

    if (!commits || commits.length === 0) {
      return res.json({
        success: false,
        description: "کامیتی در این برنچ یافت نشد.",
      });
    }

    const prompt = `فقط یک گزارش کارکرد فارسی کامل  با بولت پوینت (-) از این کامیت‌ها بساز:\n${commits.map((c) => c.title).join("\n")}`;
    const aiResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { httpsAgent: proxyAgent },
    );

    res.json({
      success: true,
      description: aiResp.data.candidates[0].content.parts[0].text,
      durationMinutes: commits.length * 45, // هر کامیت ۴۵ دقیقه
    });
  } catch (err) {
    console.error("❌ Sync Error Details:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error:
        err.response?.data?.error?.message || err.message || "Internal Error",
    });
  }
});

app.listen(3000, () => console.log("🚀 Proxy up on 3000"));
