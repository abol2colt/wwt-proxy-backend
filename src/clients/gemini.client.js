const { env } = require("../config/env");
const { buildProxyAxiosConfig } = require("../config/proxy-agent");
const axios = require("axios");

function buildGeminiGenerateContentUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
}

async function generateGeminiContent(prompt, { timeout = 45000 } = {}) {
  const response = await axios.post(
    buildGeminiGenerateContentUrl(),
    {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    },
    buildProxyAxiosConfig(timeout),
  );

  return response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

module.exports = {
  buildGeminiGenerateContentUrl,
  generateGeminiContent,
};
