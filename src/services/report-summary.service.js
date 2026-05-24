const { env } = require("../config/env");
const { generateGeminiContent } = require("../clients/gemini.client");
const {
  buildReportSummaryPrompt,
} = require("../prompts/report-summary.prompt");

async function generateReportSummary(payload) {
  const { prompt, taskCount, topActivityCount } =
    buildReportSummaryPrompt(payload);

  console.log("AI Report request started", {
    model: env.geminiModel,
    promptLength: prompt.length,
    taskCount,
    topActivityCount,
    useSocksProxy: env.useSocksProxy,
  });

  const summary = await generateGeminiContent(prompt, {
    timeout: 45000,
  });

  console.log("AI Report request finished");

  return {
    summary,
    model: env.geminiModel,
  };
}

module.exports = {
  generateReportSummary,
};
