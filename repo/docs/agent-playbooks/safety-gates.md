# Safety Gates Playbook

Use this when a task may affect live systems, credentials, secrets, customer/private data, destructive state, deployments, runtime state, external services, Docker, SSH, auth, or security settings.

## Approval Rule

Before a risky action, verify that explicit approval is bound to the exact action and remains valid; request fresh approval when the scope does not cover the action or is revoked, expired, or unresolved.

Bind each approval to the exact owner, action, target, resources, effects, recipient, conditions, expiry, revocation state, and recorded outcome. An unchanged, unexpired, unrevoked approval remains valid for the same still-pending action when only the turn, worker, chat, or transport changes. Assignment, custody, capability, and native permission remain separate; an approval, receipt, or prose cannot supply missing native permission. A changed or new action, revoked or expired approval, or recorded outcome that leaves further work unapproved requires fresh approval or host confirmation before that additional effect. Words like `continue`, `next`, `apply`, or `do it` stay within the approved scope.

## Never Do By Default

- Do not modify credentials, secrets, tokens, private keys, `.env` values, or private values.
- Do not run destructive commands, rewrite git history, deploy, restart services, change firewall/security settings, or mutate production config without approval.
- Do not touch customer/private data or live databases without approval.
- Do not remove tests, validation, guardrails, or approval gates to make a check pass.

## Reporting

If approval is required, state the action, target, risk, and exact confirmation needed. If approval is not available, stop before the risky action and report the safe work completed.
