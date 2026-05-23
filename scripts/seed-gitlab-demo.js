require("dotenv").config();
const axios = require("axios");

const API = `${process.env.GITLAB_URL}/api/v4/projects/${process.env.PROJECT_ID}`;
const HEADERS = { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN };

const tasksToSeed = [
  {
    key: "WTT-101",
    branch: "feature/WTT-101-ui-redesign",
    commits: [
      "Refactor task modal structure",
      "Implement Jira dropdown component",
      "Fix Tailwind CSS dark mode issues",
    ],
  },
  {
    key: "IDEAL-730",
    branch: "feature/IDEAL-730-best-limits-contract",
    commits: [
      "Refactor getOptionContract function",
      "Implement best limits logic",
      "Add unit tests for pricing module",
    ],
  },
  {
    key: "IRPT-101",
    branch: "feature/IRPT-101-order-form",
    commits: [
      "Design order form skeleton",
      "Connect to orders API",
      "Handle form validation errors",
    ],
  },
];

async function runSeed() {
  for (const t of tasksToSeed) {
    try {
      await axios.post(`${API}/repository/branches`, null, {
        params: { branch: t.branch, ref: "main" },
        headers: HEADERS,
      });
      for (const msg of t.commits) {
        await axios.post(
          `${API}/repository/commits`,
          {
            branch: t.branch,
            commit_message: `[${t.key}] ${msg}`,
            actions: [
              {
                action: "create",
                filePath: `dev_${t.key}_${Math.random()}.txt`,
                content: "code",
              },
            ],
          },
          { headers: HEADERS },
        );
      }
      console.log(`✅ ${t.key} Seeded!`);
    } catch (e) {
      console.log(`⚠️ ${t.key} already exists.`);
    }
  }
}
runSeed();
