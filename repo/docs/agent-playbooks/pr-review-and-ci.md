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

For already-authorised GitHub reads and writes, use only authenticated task-scoped escalated `gh` in a supported shell execution mode permitted by the actual host. Verify the intended authenticated account, repository and exact operation scope before execution. Before creating or updating PRs, verify the active account with:

```powershell
gh auth status
gh api user --jq .login
```

If the active account is not the intended user, stop and report it. If that route is unavailable or not permitted, hold the affected operation. Authentication and escalation do not grant task authority or automatic approval; preserve current permissions, explicit denials and mandatory confirmations.

## CI Check-Up

When a change touches CI or adds a package, language or test folder, run the `secure-ci-cd` CI check-up (`skills/secure-ci-cd/scripts/ci-checkup.cjs --base <ref>`) and fix the real gaps it lists in the same PR.

## CI Honesty

Do not claim CI passed unless checked. If checks are pending, failed, or inaccessible, say so and provide the exact command or user action needed.