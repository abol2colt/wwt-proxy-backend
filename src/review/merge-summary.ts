export function buildMergeSummary(branchName: string, reviewedFiles: number) {
  return `Branch ${branchName} reviewed with ${reviewedFiles} changed files.`;
}
