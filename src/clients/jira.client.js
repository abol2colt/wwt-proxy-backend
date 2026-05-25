const axios = require("axios");

function buildJiraAxiosAuthConfig(config) {
  if (config.authType === "bearer") {
    return {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    };
  }

  return {
    auth: {
      username: config.email,
      password: config.token,
    },
  };
}

async function testJiraConnection(config) {
  const response = await axios.get(
    `${config.baseUrl}/rest/api/${config.apiVersion}/myself`,
    buildJiraAxiosAuthConfig(config),
  );

  return response.data;
}

async function searchJiraIssues(
  config,
  { jql = config.jql, maxResults = 50, fields } = {},
) {
  const response = await axios.get(
    `${config.baseUrl}/rest/api/${config.apiVersion}/search`,
    {
      ...buildJiraAxiosAuthConfig(config),
      params: {
        jql,
        maxResults,
        fields,
      },
    },
  );

  return Array.isArray(response.data?.issues) ? response.data.issues : [];
}

module.exports = {
  buildJiraAxiosAuthConfig,
  testJiraConnection,
  searchJiraIssues,
};
