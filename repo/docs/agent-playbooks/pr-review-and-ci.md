# PR Review And CI Playbook

Use this for PR review, CI status, merge readiness, diff analysis, test failure verification, PR feedback, check runs, workflow logs, or release readiness.

## Review Standard

Do not review from metadata alone. Inspect the relevant diff, files, tests, and CI/check status when available.

Lead review responses with findings ordered by severity. If no issues are found, say so and mention residual risk or test gaps.

## GitHub CLI

Use local `gh` from the shell for PR and issue actions. Before creating or updating PRs, run:

```powershell
gh auth status
gh api user --jq .login
```

If the active account is not the intended user, stop and report it.

## CI Honesty

Do not claim CI passed unless checked. If checks are pending, failed, or inaccessible, say so and provide the exact command or user action needed.
