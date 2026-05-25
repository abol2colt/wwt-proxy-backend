const axios = require("axios");

function buildGitlabHeaders(gitlab) {
  return {
    "PRIVATE-TOKEN": gitlab.token,
  };
}

function buildGitlabProjectUrl(gitlab, path) {
  return `${gitlab.baseUrl}/api/v4/projects/${encodeURIComponent(
    gitlab.projectId,
  )}${path}`;
}

async function findGitlabBranches(gitlab, search) {
  const response = await axios.get(
    buildGitlabProjectUrl(gitlab, "/repository/branches"),
    {
      headers: buildGitlabHeaders(gitlab),
      params: {
        search,
        per_page: 20,
      },
    },
  );

  return Array.isArray(response.data) ? response.data : [];
}

async function getGitlabCommits(gitlab, params = {}) {
  const response = await axios.get(
    buildGitlabProjectUrl(gitlab, "/repository/commits"),
    {
      headers: buildGitlabHeaders(gitlab),
      params,
    },
  );

  return Array.isArray(response.data) ? response.data : [];
}

async function getGitlabCurrentUser(gitlab) {
  const response = await axios.get(`${gitlab.baseUrl}/api/v4/user`, {
    headers: buildGitlabHeaders(gitlab),
  });

  return response.data;
}

async function getGitlabUserEvents(gitlab, userId, params = {}) {
  const response = await axios.get(
    `${gitlab.baseUrl}/api/v4/users/${userId}/events`,
    {
      headers: buildGitlabHeaders(gitlab),
      params,
    },
  );

  return Array.isArray(response.data) ? response.data : [];
}

async function getGitlabProject(gitlab) {
  const response = await axios.get(buildGitlabProjectUrl(gitlab, ""), {
    headers: buildGitlabHeaders(gitlab),
  });

  return response.data;
}

async function testGitlabConnection(gitlab) {
  const user = await getGitlabCurrentUser(gitlab);
  const project = await getGitlabProject(gitlab);

  return {
    user,
    project,
  };
}

module.exports = {
  findGitlabBranches,
  getGitlabCommits,
  getGitlabCurrentUser,
  getGitlabUserEvents,
  getGitlabProject,
  testGitlabConnection,
};
