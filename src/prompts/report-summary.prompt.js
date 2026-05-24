const { truncateText } = require("../utils/text");

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

function buildReportSummaryPrompt({
  rangeLabel = "",
  purpose = "daily",
  tone = "managerial",
  detailLevel = "balanced",
  language = "fa",
  attendanceSummary = {},
  topActivities = [],
  tasks = [],
}) {
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
      `- پروژه ${truncateText(act.projectName, 80)} (${truncateText(act.serviceName, 80)}): ${Number(
        act.spentMinutes ?? 0,
      )} دقیقه (${truncateText(act.percentageText, 24)})`,
    );
  });

  promptLines.push("", "تسک‌های ثبت‌شده در این بازه:");

  safeTasks.forEach((task) => {
    promptLines.push(
      `- [${task.id}] ${task.title} | پروژه: ${task.projectTitle} | تاریخ: ${task.date} | مدت: ${task.durationMinutes} دقیقه | وضعیت: ${task.status} | توضیح: ${
        task.description || "بدون توضیح"
      }`,
    );
  });

  promptLines.push(
    "",
    "خروجی را منظم، خوانا و آماده ارائه بنویس. اگر هدف daily است خیلی کوتاه بنویس. اگر هدف lead است، ریسک‌ها و قدم بعدی را هم اضافه کن. اگر هدف self_review است، پیشنهاد بهبود فردی بده.",
  );

  return {
    prompt: promptLines.join("\n"),
    taskCount: safeTasks.length,
    topActivityCount: safeTopActivities.length,
  };
}

module.exports = {
  reportPurposeInstruction,
  buildReportSummaryPrompt,
};
