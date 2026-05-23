// src/utils/worklog-time-suggestion.js

const { toMinutesBetween, toTimeHHMM } = require("./time");

const WORK_SESSION_GAP_LIMIT_MINUTES = 90;
const MIN_WORKLOG_DURATION_MINUTES = 45;
const MIN_MINUTES_PER_COMMIT = 30;

function calculateEvidenceTimeSuggestion(commits) {
  const sortedCommits = [...commits]
    .filter((commit) => commit.created_at)
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  if (sortedCommits.length === 0) {
    return {
      suggestedStartTime: "",
      suggestedEndTime: "",
      suggestedDurationMinutes: 0,
      excludedGapMinutes: 0,
      confidenceScore: 50,
      confidenceLabel: "manual-review",
      reasoning: "No commit timestamp was available.",
    };
  }

  let suggestedDurationMinutes = 0;
  let excludedGapMinutes = 0;

  const WORK_SESSION_GAP_LIMIT_MINUTES = 90;
  const MIN_WORKLOG_DURATION_MINUTES = 45;
  const MIN_MINUTES_PER_COMMIT = 30;

  for (let index = 1; index < sortedCommits.length; index += 1) {
    const previous = sortedCommits[index - 1];
    const current = sortedCommits[index];
    const gapMinutes = toMinutesBetween(
      previous.created_at,
      current.created_at,
    );

    if (gapMinutes <= WORK_SESSION_GAP_LIMIT_MINUTES) {
      suggestedDurationMinutes += gapMinutes;
    } else {
      excludedGapMinutes += gapMinutes;
    }
  }

  const effortFloorMinutes = Math.max(
    MIN_WORKLOG_DURATION_MINUTES,
    sortedCommits.length * MIN_MINUTES_PER_COMMIT,
  );

  suggestedDurationMinutes = Math.max(
    suggestedDurationMinutes,
    effortFloorMinutes,
  );

  const firstCommitAt = sortedCommits[0].created_at;
  const suggestedEndAt = new Date(
    new Date(firstCommitAt).getTime() + suggestedDurationMinutes * 60000,
  ).toISOString();

  const lastCommitAt = suggestedEndAt;
  const confidenceScore =
    sortedCommits.length >= 3 && excludedGapMinutes === 0
      ? 88
      : sortedCommits.length >= 2
        ? 78
        : 65;

  return {
    suggestedStartTime: toTimeHHMM(firstCommitAt),
    suggestedEndTime: toTimeHHMM(lastCommitAt),
    suggestedDurationMinutes,
    excludedGapMinutes,
    confidenceScore,
    confidenceLabel:
      confidenceScore >= 85
        ? "high"
        : confidenceScore >= 70
          ? "medium"
          : "needs-review",
    reasoning:
      excludedGapMinutes > 0
        ? `فاصله‌های زمانی طولانیِ بیش از ${WORK_SESSION_GAP_LIMIT_MINUTES} دقیقه محاسبه نشدند و حداقل زمان استاندارد برای فعالیت‌ها لحاظ شد.`
        : "به دلیل نزدیک بودن زمانِ کامیت‌ها به یکدیگر، حداقل زمان استاندارد اعمال شد تا پیشنهاد گزارش کار واقعی‌تر باشد.",
    firstEvidenceAt: firstCommitAt,
    lastEvidenceAt: lastCommitAt,
  };
}

module.exports = {
  WORK_SESSION_GAP_LIMIT_MINUTES,
  MIN_WORKLOG_DURATION_MINUTES,
  MIN_MINUTES_PER_COMMIT,
  calculateEvidenceTimeSuggestion,
};
