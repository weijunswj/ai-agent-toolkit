# Safety Gates Playbook

Use this when a task may affect live systems, credentials, secrets, customer/private data, destructive state, deployments, runtime state, external services, Docker, SSH, auth, or security settings.

## Approval Rule

Before a risky action, stop and ask for explicit current-turn approval naming the target and operation.

Previous approval does not carry forward to a new risky action. Words like `continue`, `next`, `apply`, or `do it` apply only to the already-scoped action.

## Never Do By Default

- Do not modify credentials, secrets, tokens, private keys, `.env` values, or private values.
- Do not run destructive commands, rewrite git history, deploy, restart services, change firewall/security settings, or mutate production config without approval.
- Do not touch customer/private data or live databases without approval.
- Do not remove tests, validation, guardrails, or approval gates to make a check pass.

## Reporting

If approval is required, state the action, target, risk, and exact confirmation needed. If approval is not available, stop before the risky action and report the safe work completed.
