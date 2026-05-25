const {
  findGitlabBranches,
  getGitlabCommits,
  getGitlabCurrentUser,
  getGitlabUserEvents,
} = require("../clients/gitlab.client");

function getTaskKeySearchAliases(taskKey) {
  const key = String(taskKey ?? "").trim();
  const numberPart = key.split("-")[1];

  return [
    key,
    key.toLowerCase(),
    numberPart ? `issue-${numberPart}` : "",
    numberPart ? `bugfix/issue-${numberPart}` : "",
    numberPart ? `feature/${key}` : "",
  ].filter(Boolean);
}

async function findBranchesByAliases(gitlab, taskKey) {
  let matchedBranches = [];

  for (const alias of getTaskKeySearchAliases(taskKey)) {
    const branches = await findGitlabBranches(gitlab, alias);
    matchedBranches.push(...branches);
  }

  const seenBranchNames = new Set();

  return matchedBranches.filter((branchItem) => {
    if (!branchItem?.name || seenBranchNames.has(branchItem.name)) {
      return false;
    }

    seenBranchNames.add(branchItem.name);
    return true;
  });
}

function mapGitlabEventForClient(event) {
  const pushData = event.push_data || {};
  const shortId = pushData.commit_to
    ? String(pushData.commit_to).slice(0, 8)
    : undefined;

  return {
    id: `event-${event.id}`,
    shortId,
    title:
      pushData.commit_title ||
      event.target_title ||
      event.action_name ||
      "فعالیت GitLab",
    message: [
      event.action_name || "",
      pushData.ref ? `branch: ${pushData.ref}` : "",
      pushData.commit_count ? `commits: ${pushData.commit_count}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    authorName: event.author?.name || event.author_username || "",
    createdAt: event.created_at,
    webUrl: event.target_url || event.project?.web_url || "",
    source: "gitlab-event",
    ref: pushData.ref || null,
    commitCount: pushData.commit_count || 1,
  };
}

async function getRecentGitlabAuthoredCommits(gitlab, currentUser, limit = 40) {
  const authorCandidates = [
    currentUser.username,
    currentUser.name,
    currentUser.email,
    currentUser.commit_email,
  ].filter(Boolean);

  let commitItems = [];

  for (const author of authorCandidates) {
    try {
      const commits = await getGitlabCommits(gitlab, {
        author,
        per_page: limit,
      });

      commitItems.push(
        ...commits.map((commit) => ({
          ...commit,
          source: "gitlab-commit",
        })),
      );
    } catch (error) {
      console.warn("GitLab authored commits lookup failed", {
        author,
        status: error.response?.status,
        message: error.message,
        data: error.response?.data,
      });
    }
  }

  return commitItems;
}

async function getRecentGitlabUserEvents(gitlab, currentUser, limit = 40) {
  const attempts = [{ action: "pushed", per_page: limit }, { per_page: limit }];

  for (const params of attempts) {
    try {
      const rawEvents = await getGitlabUserEvents(
        gitlab,
        currentUser.id,
        params,
      );
      const events = rawEvents.map(mapGitlabEventForClient);

      if (events.length > 0) {
        return events;
      }
    } catch (error) {
      console.warn("GitLab user events lookup failed", {
        params,
        status: error.response?.status,
        message: error.message,
        data: error.response?.data,
      });
    }
  }

  return [];
}

async function getRecentGitlabCommitsForCurrentUser(gitlab, limit = 40) {
  const currentUser = await getGitlabCurrentUser(gitlab);

  const eventItems = await getRecentGitlabUserEvents(
    gitlab,
    currentUser,
    limit,
  );
  const commitItems = await getRecentGitlabAuthoredCommits(
    gitlab,
    currentUser,
    limit,
  );

  const mixedItems = [...eventItems, ...commitItems];
  const seen = new Set();

  return mixedItems
    .filter((item) => {
      const id = `${item.source || "item"}-${item.id}`;

      if (!item?.id || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    })
    .sort((a, b) => {
      const dateA = new Date(a.created_at ?? a.createdAt ?? 0).getTime();
      const dateB = new Date(b.created_at ?? b.createdAt ?? 0).getTime();

      return dateB - dateA;
    })
    .slice(0, limit);
}

function filterCommitsByTaskKey(commits, taskKey) {
  if (!isTrustedTaskKey(taskKey)) {
    return [];
  }

  const escapedTaskKey = String(taskKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const taskKeyPattern = new RegExp(`\\[?${escapedTaskKey}\\]?`, "i");

  return commits.filter((commit) => {
    const title = commit.title || "";
    const message = commit.message || "";

    return taskKeyPattern.test(title) || taskKeyPattern.test(message);
  });
}

function dedupeCommits(commits) {
  const seenCommitIds = new Set();

  return commits.filter((commit) => {
    if (!commit?.id || seenCommitIds.has(commit.id)) {
      return false;
    }

    seenCommitIds.add(commit.id);
    return true;
  });
}

async function findEvidenceCommitsForTask({ gitlab, taskKey, branch }) {
  if (!isTrustedTaskKey(taskKey)) {
    return {
      commits: [],
      matchedBranchNames: [],
      rawCommitCountBeforeTaskKeyFilter: 0,
    };
  }
  let commits = [];
  let matchedBranchNames = [];

  if (branch) {
    commits = await getGitlabCommits(gitlab, {
      ref_name: branch,
      per_page: 20,
    });

    matchedBranchNames = [branch];

    if (commits.length === 0) {
      const matchedBranches = await findBranchesByAliases(gitlab, taskKey);
      matchedBranchNames = matchedBranches.map((item) => item.name);

      for (const matchedBranch of matchedBranches.slice(0, 3)) {
        const branchCommits = await getGitlabCommits(gitlab, {
          ref_name: matchedBranch.name,
          per_page: 20,
        });

        commits.push(...branchCommits);
      }
    }

    if (commits.length === 0) {
      commits = await getGitlabCommits(gitlab, {
        search: taskKey,
        per_page: 20,
      });
    }
  } else {
    const matchedBranches = await findBranchesByAliases(gitlab, taskKey);
    matchedBranchNames = matchedBranches.map((item) => item.name);

    for (const matchedBranch of matchedBranches.slice(0, 3)) {
      const branchCommits = await getGitlabCommits(gitlab, {
        ref_name: matchedBranch.name,
        per_page: 20,
      });

      commits.push(...branchCommits);
    }

    if (commits.length === 0) {
      commits = await getGitlabCommits(gitlab, {
        search: taskKey,
        per_page: 20,
      });
    }
  }

  commits = dedupeCommits(commits);

  if (commits.length > 0) {
    const currentGitlabUser = await getGitlabCurrentUser(gitlab);

    commits = commits.filter((commit) =>
      isCommitOwnedByGitlabUser(commit, currentGitlabUser),
    );
  }

  const rawCommitCountBeforeTaskKeyFilter = commits.length;
  const taskKeyCommits = filterCommitsByTaskKey(commits, taskKey);

  commits = taskKeyCommits.length > 0 ? taskKeyCommits : [];

  return {
    commits,
    matchedBranchNames,
    rawCommitCountBeforeTaskKeyFilter,
  };
}

function isTrustedTaskKey(taskKey) {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(String(taskKey || "").trim());
}

function normalizeGitIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isCommitOwnedByGitlabUser(commit, currentUser) {
  const currentUserIdentities = new Set(
    [
      currentUser?.username,
      currentUser?.name,
      currentUser?.email,
      currentUser?.commit_email,
    ]
      .filter(Boolean)
      .map(normalizeGitIdentity),
  );

  return [
    commit.author_name,
    commit.author_email,
    commit.committer_name,
    commit.committer_email,
  ]
    .filter(Boolean)
    .map(normalizeGitIdentity)
    .some((identity) => currentUserIdentities.has(identity));
}

module.exports = {
  getTaskKeySearchAliases,
  findBranchesByAliases,
  getRecentGitlabCommitsForCurrentUser,
  filterCommitsByTaskKey,
  dedupeCommits,
  findEvidenceCommitsForTask,
  isTrustedTaskKey,
  normalizeGitIdentity,
  isCommitOwnedByGitlabUser,
};
