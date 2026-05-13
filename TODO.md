## 🔄 Branch 013: `feature/013-smart-worklog-mvp-integration`

**Goal:** Build a safe Smart Worklog MVP that fills the WTT task form from Jira-like tasks and GitLab commit evidence, without real WTT mutation.

### Safety Rule

No real WTT create/update/delete in this branch.
This branch only prepares a draft inside the task modal.

### Proxy / Backend

- [ ] Initialize `wtt-proxy` as a private/local git repository.
- [ ] Add `.gitignore` for `.env`, `node_modules`, and GitLab volume data.
- [ ] Add `.env.example` without real secrets.
- [ ] Keep real `GITLAB_TOKEN` and `GEMINI_API_KEY` only in local `.env`.
- [ ] Keep current GitLab + Gemini sync working.
- [ ] Rename routes conceptually:
  - [ ] `/api/jira/mock-tasks` → mock version of future Jira open issues endpoint
  - [ ] `/api/sync-gitlab` → current MVP version of future GitLab evidence endpoint
- [ ] Add comments in proxy code explaining what must change when real Jira access is available.

### Jira Mock Integration

- [ ] Rename frontend model from `JiraTask` to a more real shape if needed.
- [ ] Keep mock Jira response close to real Jira concept:
  - [ ] `key`
  - [ ] `title`
  - [ ] `project_id`
  - [ ] `service_id`
  - [ ] `contract_id`
  - [ ] optional `branch_name`
- [ ] Make sure mock `project_id`, `service_id`, and `contract_id` match real WTT dropdown data.
- [ ] Add comments showing which fields will come from real Jira later.

### Frontend Smart Form

- [ ] Keep `TasksService` only for WTT APIs.
- [ ] Do not put GitLab/Jira logic inside `TasksService`.
- [ ] Replace hardcoded proxy URL with an environment value later.
- [ ] Fix Jira task selection:
  - [ ] Set task title from selected Jira task.
  - [ ] Set WTT project.
  - [ ] Load project details.
  - [ ] Set service/contract only after project details response returns.
  - [ ] Remove `setTimeout`.
  - [ ] Do not call filter methods from form selection.
- [ ] Add selected Jira task state.
- [ ] Hide Jira dropdown after selection.
- [ ] Show user-friendly error if Jira mapping does not match WTT project/service/contract.

### GitLab / AI Draft

- [ ] Keep current GitLab → Gemini → Persian description flow working.
- [ ] Add selected Jira task context to GitLab sync later:
  - [ ] task key
  - [ ] branch name
  - [ ] optional date range
- [ ] Fill description from AI response.
- [ ] Fill start/end time from calculated duration.
- [ ] Fill date if empty.
- [ ] Keep user as final reviewer before submit.

### Build / Cleanup

- [ ] Remove noisy console logs or mark temporary debug logs clearly.
- [ ] Run `npm run build`.
- [ ] Write Branch 013 report:
  - [ ] What works now
  - [ ] What is still mock
  - [ ] What changes when real Jira is available
  - [ ] Why WTT mutation stayed disabled
