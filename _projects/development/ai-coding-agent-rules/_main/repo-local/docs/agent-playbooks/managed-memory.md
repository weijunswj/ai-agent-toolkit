# Managed Memory

Use this when reading, creating, updating, or reviewing root `MEMORY.md`.

## Contract

- `MEMORY.md` is optional, managed, and non-authoritative.
- Store only compact durable repo-specific context future agents would otherwise rediscover.
- Good candidates: maintainer preferences, durable decisions, local workflow notes, repeated context, or known pitfalls.
- Do not store task logs, TODOs, status reports, PR summaries, implementation plans, temporary blockers, or transient progress.
- Prefer canonical docs, playbooks, source files, or validation for policy, workflow, safety, source-of-truth material, or public maintainer guidance.
- Never store secrets, credentials, tokens, private keys, `.env` values, private values, customer/private data, live-system state, sensitive operational details, or security-sensitive infrastructure details.
- If memory conflicts with authoritative sources, ignore the memory entry and fix or remove it when appropriate.

Final reports must say `MEMORY.md changed: Yes/No`; if yes, explain what changed and why it belongs in memory.
