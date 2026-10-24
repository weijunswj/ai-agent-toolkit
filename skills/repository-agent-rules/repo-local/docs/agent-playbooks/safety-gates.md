# Safety Gates Playbook

Use this when a task may affect live systems, credentials, secrets, customer/private data, destructive state, deployments, runtime state, external services, Docker, SSH, auth, or security settings.

## Approval Rule

Before a risky action, verify that explicit approval is bound to the exact action and remains valid; request fresh approval when the scope does not cover the action or is revoked, expired, or unresolved.

The evidence-store line in the managed `AGENTS.md` is the standing approval for that store: writes, deletions and merges there need no further approval.

Bind each approval to the exact owner, action, target, resources, effects, recipient, conditions, expiry, revocation state, and recorded outcome. An unchanged, unexpired, unrevoked approval remains valid for the same still-pending action when only the turn, worker, chat, or transport changes. Assignment, custody, capability, and native permission remain separate; an approval, receipt, or prose cannot supply missing native permission. A changed or new action, revoked or expired approval, or recorded outcome that leaves further work unapproved requires fresh approval or host confirmation before that additional effect. Words like `continue`, `next`, `apply`, or `do it` stay within the approved scope.

## Never Do By Default

- Do not modify credentials, secrets, tokens, private keys, `.env` values, or private values.
- Do not run destructive commands, rewrite git history, deploy, restart services, change firewall/security settings, or mutate production config without approval.
- Do not touch customer/private data or live databases without approval.
- Do not remove tests, validation, guardrails, or approval gates to make a check pass.

## Personal Data Pushed By Mistake

- Pushed to a public repository means public. Clones, forks, cached views and pull request references can keep it; squashing, rebasing, force-pushing or deleting the branch does not remove it from GitHub.
- Agents never rewrite history or force-push to "fix" it. Remove the value in a new commit, record the affected commit SHAs and where the value appeared (place and class, never the value), and tell the owner at once. Rotate anything credential-like first.
- Offer the owner the GitHub removal route: GitHub's sensitive-data procedure, then a GitHub Support request to purge cached views and pull request references. That route is the owner's decision and action, and it never reaches forks or other people's clones.

## History Rewrites

- In a Toolkit-governed or personal-data-guarded repository, and when pushing to an evidence store (a `TRANSPORT-*` repository), the Toolkit agent hooks refuse force pushes: `--force`, `-f`, `--force-with-lease`, `--mirror` and `+refspec`. Push a new commit or a merge commit instead. Branch rules on GitHub stay the real protection.
- Before concluding that history was rewritten, run `git rev-parse --is-shallow-repository`. A shallow clone shows its oldest fetched commit as a root and `git fetch` can print `(forced update)` for a plain fast-forward. Fetch full history first (`git fetch --unshallow`), or ask GitHub to compare the two commits, and only then check ancestry.

## Reporting

If approval is required, state the action, target, risk, and exact confirmation needed. If approval is not available, stop before the risky action and report the safe work completed.
