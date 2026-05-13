require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
// ابزار جدید برای وصل کردن axios به V2ray
const { SocksProxyAgent } = require("socks-proxy-agent");

const app = express();
app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json());

// تنظیم پورت V2ray (همان 10809 که پیدا کردیم)
const proxyAgent = new SocksProxyAgent("socks5://127.0.0.1:1080");

app.get("/api/sync-gitlab", async (req, res) => {
  try {
    console.log("1. Fetching commits from local GitLab...");

    // درخواست اول: گیت‌لب (مستقیم و بدون پروکسی چون لوکال است)
    const gitlabResponse = await axios.get(
      `${process.env.GITLAB_URL}/api/v4/projects/${process.env.PROJECT_ID}/repository/commits`,
      {
        headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN },
      },
    );

    const commits = gitlabResponse.data;
    if (!commits || commits.length === 0) {
      return res.json({ description: "کامیتی یافت نشد.", durationMinutes: 0 });
    }

    const commitMessages = commits.map((c) => c.title).join("\n");
    const totalMinutes = commits.length * 45;

    console.log("2. Sending commits to Gemini for Persian translation...");

    // درخواست دوم: جمینی (ارسال با axios و عبور اجباری از V2ray)
    const prompt = `تو یک دستیار مهندسی نرم‌افزار هستی. پیام‌های کامیت زیر را به یک گزارش کارکرد (Worklog) رسمی، یکپارچه، بلند و کاملاً فارسی تبدیل کن. فقط متن نهایی را بنویس.\n\nکامیت‌ها:\n${commitMessages}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    // اینجا proxyAgent باعث می‌شود فیلترینگ دور زده شود
    const aiResponse = await axios.post(geminiUrl, geminiPayload, {
      httpsAgent: proxyAgent,
    });

    // استخراج متن فارسی از جواب گوگل
    const aiPersianDescription =
      aiResponse.data.candidates[0].content.parts[0].text;

    console.log("3. Success! Sending Persian data to Angular.");

    res.json({
      description: aiPersianDescription,
      durationMinutes: totalMinutes,
      success: true,
    });
  } catch (error) {
    console.error("API Error:", error.message);
    if (error.response) {
      console.error("Details:", error.response.data);
    }
    res.status(500).json({ error: "خطا در ارتباط با سرویس‌ها" });
  }
});
app.get("/api/jira/mock-tasks", (req, res) => {
  const mockTasks = [
    {
      id: "WTT-101",
      title: "پیاده‌سازی پروکسی هوشمند",
      project_id: 1,
      service_id: 1,
      contract_id: 1,
    },
    {
      id: "WTT-102",
      title: "رفع باگ لایه شبکه",
      project_id: 1,
      service_id: 2,
      contract_id: 1,
    },
    {
      id: "WTT-103",
      title: "طراحی رابط کاربری جدید",
      project_id: 2,
      service_id: 1,
      contract_id: 2,
    },
  ];
  res.json(mockTasks);
});
app.listen(process.env.PORT, () =>
  console.log(`Smart Proxy running on port ${process.env.PORT} 🚀`),
);
