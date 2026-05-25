process.env.SOCKS_PROXY_URL ?? "socks5://127.0.0.1:1080";

require("dotenv").config();

const env = {
  nodeEnv: process.env.NODE_ENV || "development",

  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:4200",

  useSocksProxy: process.env.USE_SOCKS_PROXY === "true",
  socksProxyUrl: process.env.SOCKS_PROXY_URL || "socks5://127.0.0.1:1080",

  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL,

  jiraBaseUrl: process.env.JIRA_BASE_URL,
  jiraEmail: process.env.JIRA_EMAIL,
  jiraApiToken: process.env.JIRA_API_TOKEN,
  jiraAuthType: process.env.JIRA_AUTH_TYPE || "bearer",
  jiraApiVersion: process.env.JIRA_API_VERSION || "2",
  jiraJql:
    process.env.JIRA_JQL || "statusCategory != Done ORDER BY updated DESC",

  gitlabUrl: process.env.GITLAB_URL,
  gitlabUsername: process.env.GITLAB_USERNAME || "",
  gitlabToken: process.env.GITLAB_TOKEN,
  gitlabProjectId: process.env.GITLAB_PROJECT_ID || process.env.PROJECT_ID,
};

module.exports = {
  env,
};
