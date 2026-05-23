require("dotenv").config();

const { createApp } = require("./app");
const {
  trimTrailingSlash,
  truncateText,
  jiraFieldToPlainText,
} = require("./src/utils/text");

const { maskValue } = require("./src/utils/mask");

const {
  calculateEvidenceTimeSuggestion,
} = require("./src/utils/worklog-time-suggestion");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Proxy up on http://${HOST}:${PORT}`);
});
