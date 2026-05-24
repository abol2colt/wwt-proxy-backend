const fs = require("fs");
const path = require("path");

const RUNTIME_CONFIG_FILE = path.resolve(
  __dirname,
  "../../.runtime-integrations.json",
);

function createEmptyRuntimeIntegrationConfig() {
  return {
    jira: null,
    gitlab: null,
  };
}

function loadRuntimeIntegrationConfig() {
  try {
    if (!fs.existsSync(RUNTIME_CONFIG_FILE)) {
      return createEmptyRuntimeIntegrationConfig();
    }

    return JSON.parse(fs.readFileSync(RUNTIME_CONFIG_FILE, "utf8"));
  } catch (error) {
    console.warn("Could not load runtime integration config", error.message);
    return createEmptyRuntimeIntegrationConfig();
  }
}

function saveRuntimeIntegrationConfig(config) {
  fs.writeFileSync(
    RUNTIME_CONFIG_FILE,
    JSON.stringify(config, null, 2),
    "utf8",
  );
}

module.exports = {
  RUNTIME_CONFIG_FILE,
  loadRuntimeIntegrationConfig,
  saveRuntimeIntegrationConfig,
};
