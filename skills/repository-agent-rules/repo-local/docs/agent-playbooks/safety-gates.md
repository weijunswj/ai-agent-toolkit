# Safety Gates

Use this before risky actions.

## Approval Rule

Stop and ask for explicit current-turn user approval naming the target and operation before actions that may mutate live/external systems, touch secrets or private data, deploy, publish, activate, deactivate, import, export, sync, restart, expose services, run Docker outside a safe local/test context, delete, overwrite, archive, rewrite git history, or remove guardrails.

Previous approval does not carry forward. Words like `continue`, `next`, `apply`, or `do it` apply only to the already-scoped safe task unless the risky target and operation are explicitly named.

## Reporting

If approval is required, state the action, target, risk, and exact confirmation needed. If approval is unavailable, stop before the risky action and report safe work completed.
