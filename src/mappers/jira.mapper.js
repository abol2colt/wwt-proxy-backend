const { jiraFieldToPlainText } = require("../utils/text");

function parseWttMetadataBlock(text) {
  const source = String(text ?? "");
  const match = source.match(/WTT:?\s*([\s\S]*?)(?:\n\s*\n|$)/i);

  if (!match) {
    return null;
  }

  const lines = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const data = {};

  for (const line of lines) {
    const [rawKey, ...rawValueParts] = line.split("=");
    const key = rawKey?.trim();
    const value = rawValueParts.join("=").trim();

    if (key && value) {
      data[key] = value;
    }
  }

  return {
    project_id: data.project_id ? Number(data.project_id) : null,
    service_id: data.service_id ? Number(data.service_id) : null,
    contract_id: data.contract_id ? Number(data.contract_id) : null,
    location: data.location || null,
    gitlab_project: data.gitlab_project || null,
    branch_name: data.branch_name || null,
    branch_pattern: data.branch_pattern || null,
    mapping_source: "jira-description",
  };
}

function readCustomField(issue, envName) {
  const fieldId = process.env[envName];

  if (!fieldId) {
    return null;
  }

  return jiraFieldToPlainText(issue.fields?.[fieldId]).trim() || null;
}

function extractWttMetadataFromCustomFields(issue) {
  const projectId = readCustomField(issue, "JIRA_WTT_PROJECT_FIELD");
  const serviceId = readCustomField(issue, "JIRA_WTT_SERVICE_FIELD");
  const contractId = readCustomField(issue, "JIRA_WTT_CONTRACT_FIELD");
  const location = readCustomField(issue, "JIRA_WTT_LOCATION_FIELD");
  const gitlabProject = readCustomField(issue, "JIRA_GITLAB_PROJECT_FIELD");
  const branchPattern = readCustomField(issue, "JIRA_BRANCH_PATTERN_FIELD");

  if (
    !projectId &&
    !serviceId &&
    !contractId &&
    !location &&
    !gitlabProject &&
    !branchPattern
  ) {
    return null;
  }

  return {
    project_id: projectId ? Number(projectId) : null,
    service_id: serviceId ? Number(serviceId) : null,
    contract_id: contractId ? Number(contractId) : null,
    location: location || null,
    gitlab_project: gitlabProject || null,
    branch_pattern: branchPattern || null,
    mapping_source: "jira-custom-fields",
  };
}

function extractWttMetadataFromJiraIssue(issue) {
  const descriptionText = jiraFieldToPlainText(issue.fields?.description);
  const fromDescription = parseWttMetadataBlock(descriptionText);

  if (fromDescription) {
    return fromDescription;
  }

  return extractWttMetadataFromCustomFields(issue);
}

function getConfiguredJiraSearchFields() {
  const baseFields = [
    "summary",
    "status",
    "issuetype",
    "updated",
    "description",
    "project",
    "assignee",
    "labels",
    "components",
  ];

  const customFields = [
    process.env.JIRA_WTT_PROJECT_FIELD,
    process.env.JIRA_WTT_SERVICE_FIELD,
    process.env.JIRA_WTT_CONTRACT_FIELD,
    process.env.JIRA_WTT_LOCATION_FIELD,
    process.env.JIRA_GITLAB_PROJECT_FIELD,
    process.env.JIRA_BRANCH_PATTERN_FIELD,
  ].filter(Boolean);

  return [...new Set([...baseFields, ...customFields])].join(",");
}

function buildBranchNameFromPattern(pattern, key) {
  if (!pattern) return null;

  const issueNumber = String(key ?? "").split("-")[1] || "";

  return String(pattern)
    .replaceAll("{TASK_KEY}", key)
    .replaceAll("{ISSUE_NUMBER}", issueNumber);
}

function mapJiraIssueToExternalTask(issue, runtimeMapping) {
  const key = issue.key;
  const summary = issue.fields?.summary ?? key;
  const wttMetadata = extractWttMetadataFromJiraIssue(issue);

  const mapping = runtimeMapping
    ? {
        project_id: runtimeMapping.project_id,
        service_id: runtimeMapping.service_id,
        contract_id: runtimeMapping.contract_id,
        mapping_source: "runtime",
      }
    : wttMetadata;

  const branchPattern = wttMetadata?.branch_pattern ?? null;
  const branchName =
    wttMetadata?.branch_name ||
    (wttMetadata?.branch_pattern
      ? buildBranchNameFromPattern(wttMetadata.branch_pattern, key)
      : null);

  return {
    id: key,
    key,
    title: summary,

    project_id: mapping?.project_id ?? null,
    service_id: mapping?.service_id ?? null,
    contract_id: mapping?.contract_id ?? null,
    location: wttMetadata?.location ?? null,

    gitlab_project_id: wttMetadata?.gitlab_project ?? null,
    branch_pattern: branchPattern,
    branch_name: branchName,
    mapping_source: mapping?.mapping_source ?? null,

    status: issue.fields?.status?.name,
    source: "jira",
    raw: {
      updated: issue.fields?.updated,
      issueType: issue.fields?.issuetype?.name,
      jiraProjectKey: issue.fields?.project?.key,
      jiraProjectName: issue.fields?.project?.name,
      assignee: issue.fields?.assignee?.displayName,
      labels: issue.fields?.labels ?? [],
      components: issue.fields?.components ?? [],
      descriptionText: jiraFieldToPlainText(issue.fields?.description),
      wttMetadata,
    },
  };
}

module.exports = {
  mapJiraIssueToExternalTask,
  getConfiguredJiraSearchFields,
};
