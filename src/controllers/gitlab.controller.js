function createGitlabController({
  getEffectiveGitlabConfig,
  getAiMissingEnv,
  requireGitlabAndAiEnv,

  getRecentGitlabCommitsForCurrentUser,
  findEvidenceCommitsForTask,

  mapGitlabCommitForClient,
  normalizeClientEvidenceCommit,

  generateGitEvidenceWorklog,
  generateTaskKeyEvidenceWorklog,

  env,
}) {
  async function syncGitlab(req, res) {
    const { taskKey, branch, projectId, preview } = req.query;

    if (!taskKey) {
      return res.status(400).json({
        success: false,
        error: "taskKey is required.",
      });
    }

    try {
      requireGitlabAndAiEnv();
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: `Proxy configuration is incomplete: ${err.missingEnv.join(", ")}`,
      });
    }

    try {
      const gitlab = getEffectiveGitlabConfig();

      if (projectId) {
        gitlab.projectId = String(projectId);
      }

      const { commits, matchedBranchNames, rawCommitCountBeforeTaskKeyFilter } =
        await findEvidenceCommitsForTask({
          gitlab,
          taskKey,
          branch,
        });

      const isPreviewOnly =
        preview === "true" || preview === "1" || preview === "candidates";

      if (!commits || commits.length === 0) {
        let recentCommits = [];

        try {
          recentCommits = await getRecentGitlabCommitsForCurrentUser(
            gitlab,
            40,
          );
        } catch (recentErr) {
          console.warn("Recent GitLab evidence fallback failed", {
            status: recentErr.response?.status,
            message: recentErr.message,
            data: recentErr.response?.data,
          });
        }

        if (isPreviewOnly) {
          return res.json({
            success: true,
            code: "GIT_EVIDENCE_CANDIDATES",
            description: `برای ${taskKey} شاهد مستقیمی پیدا نشد. از فعالیت‌های اخیر موارد مرتبط را انتخاب کن.`,
            durationMinutes: 0,
            commits: [],
            recentCommits: recentCommits.map(mapGitlabCommitForClient),
            evidence: {
              taskKey,
              branch: branch || undefined,
              matchedBranches: matchedBranchNames,
              commitCount: 0,
              rawCommitCountBeforeTaskKeyFilter,
              reason: "preview-no-direct-evidence",
            },
          });
        }

        return res.json({
          success: false,
          code: "NO_GIT_EVIDENCE",
          description: `برای ${taskKey} کامیتی در GitLab پیدا نشد. ممکن است commitها با این کلید ثبت نشده باشند یا در پروژه دیگری باشند.`,
          durationMinutes: 0,
          evidence: {
            taskKey,
            branch: branch || undefined,
            matchedBranches: matchedBranchNames,
            commitCount: 0,
            rawCommitCountBeforeTaskKeyFilter,
            reason: "no-task-key-commits-found",
          },
          recentCommits: recentCommits.map(mapGitlabCommitForClient),
        });
      }

      if (isPreviewOnly) {
        let recentCommits = [];

        try {
          recentCommits = await getRecentGitlabCommitsForCurrentUser(
            gitlab,
            40,
          );
        } catch (recentErr) {
          console.warn("Recent GitLab evidence preview failed", {
            status: recentErr.response?.status,
            message: recentErr.message,
            data: recentErr.response?.data,
          });
        }

        const matchedIds = new Set(commits.map((commit) => commit.id));
        const recentWithoutDuplicates = recentCommits.filter(
          (commit) => !matchedIds.has(commit.id),
        );

        return res.json({
          success: true,
          code: "GIT_EVIDENCE_CANDIDATES",
          description: `${commits.length} شاهد مرتبط با ${taskKey} پیدا شد. قبل از ساخت پیش‌نویس می‌توانی انتخاب‌ها را تغییر بدهی.`,
          durationMinutes: 0,
          commits: commits.map((commit) => ({
            ...mapGitlabCommitForClient(commit),
            matched: true,
          })),
          recentCommits: recentWithoutDuplicates.map(mapGitlabCommitForClient),
          evidence: {
            taskKey,
            branch: branch || undefined,
            matchedBranches: matchedBranchNames,
            commitCount: commits.length,
            rawCommitCountBeforeTaskKeyFilter,
            reason: "preview-before-ai",
          },
        });
      }

      const response = await generateTaskKeyEvidenceWorklog({
        taskKey,
        branch,
        commits,
        matchedBranchNames,
        rawCommitCountBeforeTaskKeyFilter,
      });

      return res.json(response);
    } catch (err) {
      const status = err.response?.status ?? 500;
      const providerMessage =
        err.code === "ECONNABORTED"
          ? "Provider request timed out after 45 seconds."
          : (err.response?.data?.error?.message ??
            err.response?.data?.message ??
            err.message);

      console.error("GitLab sync failed", {
        status,
        code: err.code,
        message: err.message,
        providerMessage,
      });

      return res.status(500).json({
        success: false,
        error:
          "Git evidence sync failed. Check proxy and provider configuration.",
        debug:
          env.nodeEnv === "development"
            ? {
                status,
                code: err.code,
                providerMessage,
              }
            : undefined,
      });
    }
  }

  async function generateFromCommits(req, res) {
    const missingAiEnv = getAiMissingEnv();

    if (missingAiEnv.length > 0) {
      return res.status(500).json({
        success: false,
        error: `AI configuration is incomplete: ${missingAiEnv.join(", ")}`,
      });
    }

    const {
      taskKey = "",
      title = "",
      branch = "",
      commits = [],
      tone = "formal",
      detailLevel = "balanced",
      extraInstruction = "",
    } = req.body ?? {};

    if (!Array.isArray(commits) || commits.length === 0) {
      return res.status(400).json({
        success: false,
        error: "حداقل یک evidence برای تولید گزارش لازم است.",
      });
    }

    const normalizedCommits = commits.map(normalizeClientEvidenceCommit);

    const response = await generateGitEvidenceWorklog({
      taskKey,
      title,
      branch,
      commits: normalizedCommits,
      tone,
      detailLevel,
      extraInstruction,
    });

    return res.json(response);
  }

  return {
    syncGitlab,
    generateFromCommits,
  };
}

module.exports = {
  createGitlabController,
};
