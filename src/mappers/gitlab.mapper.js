function mapGitlabCommitForClient(commit) {
  return {
    id: commit.id,
    shortId: commit.short_id ?? commit.shortId,
    title: commit.title,
    message: commit.message,
    authorName: commit.author_name ?? commit.authorName,
    createdAt: commit.created_at ?? commit.createdAt,
    webUrl: commit.web_url ?? commit.webUrl,
    source: commit.source ?? "gitlab-commit",
    ref: commit.ref ?? null,
    commitCount: commit.commitCount ?? 1,
  };
}

function normalizeClientEvidenceCommit(commit) {
  return {
    id: commit.id,
    short_id: commit.shortId,
    title: commit.title || commit.message || "GitLab evidence",
    message: commit.message || commit.title || "",
    author_name: commit.authorName || "",
    created_at: commit.createdAt || new Date().toISOString(),
    web_url: commit.webUrl || "",
    source: commit.source || "gitlab-commit",
    ref: commit.ref || null,
    commitCount: commit.commitCount || 1,
  };
}

module.exports = {
  mapGitlabCommitForClient,
  normalizeClientEvidenceCommit,
};
