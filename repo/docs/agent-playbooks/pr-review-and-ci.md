# PR Review And CI Playbook

Use this for PR review, CI status, merge readiness, diff analysis, test failure verification, PR feedback, check runs, workflow logs, or release readiness.

## Review Standard

Do not review from metadata alone. Inspect the relevant diff, files, tests, and CI/check status when available.

Lead review responses with findings ordered by severity. If no issues are found, say so and mention residual risk or test gaps.

## Managed PR Continuity

When a managed programme opens a prerequisite, replacement, superseding, or successor PR for an existing child, update the controlling child in the same transition window. The child must durably identify the new PR and its relationship to the previous PR or blocked work. A predecessor-PR comment may provide extra history, but it is never sufficient as the only cross-PR reference.

Keep PR presentation state separate from programme authority. `draft: false` does not by itself mean accepted, Ready-for-merge, complete, or Web-final. Preserve the programme's explicit role, `completes_child` value, gate/finality state, exact candidate identity, and merge authority independently of GitHub's Draft/Ready UI state.

If the available GitHub client or connector cannot reliably perform or verify Draft -> Ready, do not make that transition a required future control point. Unless a repository contract explicitly requires a Draft PR and a working transition capability is available, create the PR as non-draft from the outset and continue to enforce readiness/finality through the programme authority records and exact-head checks. Never weaken review, CI, Web finality, or merge authorization merely because the PR is non-draft.

## GitHub CLI

Use local `gh` from the shell for PR and issue actions. Before creating or updating PRs, run:

```powershell
gh auth status
gh api user --jq .login
```

If the active account is not the intended user, stop and report it.

## CI Honesty

Do not claim CI passed unless checked. If checks are pending, failed, or inaccessible, say so and provide the exact command or user action needed.