const { generateGeminiContent } = require("../clients/gemini.client");
const { mapGitlabCommitForClient } = require("../mappers/gitlab.mapper");
const {
  calculateEvidenceTimeSuggestion,
} = require("../utils/worklog-time-suggestion");

function buildGitEvidencePrompt({
  taskKey,
  title,
  branch,
  commits,
  tone = "formal",
  detailLevel = "balanced",
  extraInstruction = "",
}) {
  const toneInstruction =
    tone === "technical"
      ? "لحن متن فنی، دقیق و مناسب ثبت کارکرد برنامه‌نویسی باشد."
      : tone === "managerial"
        ? "لحن متن رسمی، نتیجه‌محور و قابل فهم برای لید یا مدیر باشد."
        : "لحن متن رسمی، ساده و مناسب ثبت کارکرد روزانه باشد.";

  const detailInstruction =
    detailLevel === "short"
      ? "متن نهایی ۱ تا ۲ جمله کوتاه باشد."
      : detailLevel === "detailed"
        ? "متن نهایی ۳ تا ۵ جمله باشد و فعالیت انجام‌شده را کمی دقیق‌تر توضیح دهد."
        : "متن نهایی ۲ تا ۳ جمله باشد.";

  return [
    "تو دستیار تولید توضیح کارکرد برای سامانه WTT هستی.",
    "خروجی باید فقط متن نهایی description کارکرد باشد.",
    "هیچ عنوان، markdown، bullet، شماره‌گذاری، جداکننده، جدول یا قالب گزارشی استفاده نکن.",
    "عبارت‌هایی مثل «گزارش کارکرد»، «پیش‌نویس»، «تحلیل»، «درخواست بازبینی» یا «برنامه‌نویس محترم» ننویس.",
    "درباره مرتبط بودن یا نبودن commit با task قضاوت نکن و هشدار نده.",
    "از task title برای فهم هدف کار استفاده کن و از evidence فقط برای کمک به توضیح فعالیت استفاده کن.",
    "اگر evidence ضعیف یا عمومی بود، متن را محتاط بنویس اما همچنان قابل ثبت به عنوان worklog باشد.",
    "داده‌ای که در evidence نیست نساز؛ ولی می‌توانی فعالیت را با زبان کاری و طبیعی خلاصه کنی.",
    toneInstruction,
    detailInstruction,
    "",
    `Task key: ${taskKey || "manual"}`,
    `Task title: ${title || "بدون عنوان"}`,
    `Branch: ${branch || "not provided"}`,
    extraInstruction ? `User instruction: ${extraInstruction}` : "",
    "",
    "Selected Git evidence:",
    commits
      .map((commit, index) => {
        const meta = [
          commit.source ? `source=${commit.source}` : "",
          commit.ref ? `branch=${commit.ref}` : "",
          commit.author_name ? `author=${commit.author_name}` : "",
          commit.created_at ? `date=${commit.created_at}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

        return `${index + 1}. ${commit.title}${meta ? ` (${meta})` : ""}`;
      })
      .join("\n"),
    "",
    "فقط متن description نهایی را برگردان.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeAiWorklogDescription(text) {
  return String(text ?? "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/---+/g, "")
    .replace(/گزارش کارکرد\s*[-:،]?\s*/gi, "")
    .replace(/پیش‌نویس قابل بازبینی\s*[-:،]?\s*/gi, "")
    .replace(/درخواست بازبینی\s*[-:،]?\s*/gi, "")
    .replace(/برنامه‌نویس محترم\s*[-:،]?\s*/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function generateGitEvidenceWorklog({
  taskKey,
  title,
  branch,
  commits,
  tone,
  detailLevel,
  extraInstruction,
}) {
  const timeSuggestion = calculateEvidenceTimeSuggestion(commits);

  const prompt = buildGitEvidencePrompt({
    taskKey,
    title,
    branch,
    commits,
    tone,
    detailLevel,
    extraInstruction,
  });

  try {
    const generatedText = await generateGeminiContent(prompt, {
      timeout: 45000,
    });

    const generatedDescription = normalizeAiWorklogDescription(generatedText);

    return {
      success: true,
      description: generatedDescription,
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
        commitCount: commits.length,
        firstCommitAt: timeSuggestion.firstEvidenceAt,
        lastCommitAt: timeSuggestion.lastEvidenceAt,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        reasoning: timeSuggestion.reasoning,
      },
    };
  } catch (aiErr) {
    const fallbackDescription = normalizeAiWorklogDescription(
      [
        title
          ? `بررسی و پیگیری ${title} انجام شد.`
          : `بررسی و پیگیری کار ${taskKey || "انتخاب‌شده"} انجام شد.`,
        commits.length > 0
          ? `شواهد انتخاب‌شده شامل ${commits.length} فعالیت Git بود و متن نهایی می‌تواند بر اساس همین موارد تکمیل شود.`
          : "شواهد کافی برای تولید متن دقیق وجود نداشت و تکمیل دستی توضیحات لازم است.",
      ].join(" "),
    );

    return {
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
      providerMessage:
        aiErr.code === "ECONNABORTED"
          ? "درخواست AI بیشتر از حد مجاز طول کشید."
          : aiErr.response?.data?.error?.message ||
            aiErr.response?.data?.message ||
            aiErr.message,
      commits: commits.map(mapGitlabCommitForClient),
      evidence: {
        taskKey,
        branch: branch || undefined,
        commitCount: commits.length,
        firstCommitAt: timeSuggestion.firstEvidenceAt,
        lastCommitAt: timeSuggestion.lastEvidenceAt,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        reasoning: "شواهد انتخاب شدند اما AI نتوانست پیش‌نویس نهایی بسازد.",
      },
    };
  }
}

async function generateTaskKeyEvidenceWorklog({
  taskKey,
  branch,
  commits,
  matchedBranchNames = [],
  rawCommitCountBeforeTaskKeyFilter = 0,
}) {
  const prompt = [
    "از روی عنوان کامیت‌های زیر، یک گزارش کارکرد فارسی کامل اما خلاصه تولید کن.",
    "خروجی فقط شامل بولت پوینت باشد.",
    "قطعیت بیش از حد نده؛ متن باید به عنوان پیش‌نویس قابل بررسی توسط برنامه‌نویس باشد.",
    "",
    `Task: ${taskKey}`,
    `Branch: ${branch || "not provided; searched commits by task key"}`,
    "",
    "Commits:",
    commits.map((commit) => `- ${commit.title}`).join("\n"),
  ].join("\n");

  console.log("GitLab AI sync request started", {
    promptLength: prompt.length,
    commitCount: commits.length,
  });

  const timeSuggestion = calculateEvidenceTimeSuggestion(commits);

  try {
    const description = await generateGeminiContent(prompt, {
      timeout: 45000,
    });

    console.log("AI Report request finished");

    return {
      success: true,
      description,
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
        rawCommitCountBeforeTaskKeyFilter,
        firstCommitAt: timeSuggestion.firstEvidenceAt,
        lastCommitAt: timeSuggestion.lastEvidenceAt,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        reasoning: timeSuggestion.reasoning,
      },
    };
  } catch (aiErr) {
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

    return {
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
        rawCommitCountBeforeTaskKeyFilter,
        firstCommitAt: timeSuggestion.firstEvidenceAt,
        lastCommitAt: timeSuggestion.lastEvidenceAt,
        excludedGapMinutes: timeSuggestion.excludedGapMinutes,
        reasoning: "کامیت‌ها پیدا شدند اما AI نتوانست پیش‌نویس نهایی بسازد.",
      },
    };
  }
}
module.exports = {
  buildGitEvidencePrompt,
  normalizeAiWorklogDescription,
  generateGitEvidenceWorklog,
  generateTaskKeyEvidenceWorklog,
};
