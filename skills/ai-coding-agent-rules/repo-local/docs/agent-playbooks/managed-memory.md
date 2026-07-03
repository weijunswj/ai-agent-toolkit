# Managed Memory

Use this when reading, creating, updating, or reviewing root `MEMORY.md`.

## Contract

- `MEMORY.md` is optional, rare, managed, and non-authoritative. Most repos should not have one.
- Do not create `MEMORY.md` merely because a repo does not have one.
- Store only compact durable repo-specific context future agents would otherwise rediscover repeatedly.
- Good candidates: maintainer preferences, durable decisions, local workflow notes, repeated context, or known pitfalls that do not belong better elsewhere.
- Create or update memory only when the context does not belong better in `AGENTS.md`, canonical docs, source files, validation, local instruction files, repo maps, ADRs/decision logs, changelogs/release notes, architecture docs, source-of-truth docs, or current-state docs.
- Prefer `AGENTS.md`, `docs/REPO-MAP.md`, `docs/PROJECT-STATE.md`, `docs/ARCHITECTURE.md`, ADRs/decision logs, changelogs/release notes, and existing canonical docs for most durable context.
- Do not store git history, changelog entries, PR logs, task logs, TODOs, status reports, audit dumps, completion reports, implementation plans, handoff logs, temporary blockers, or transient progress.
- If no `MEMORY.md` exists and useful context fits cleanly in existing canonical docs or a repo map, do not create `MEMORY.md`.
- Never store secrets, credentials, tokens, private keys, `.env` values, private values, customer/private data, live-system state, sensitive operational details, or security-sensitive infrastructure details.
- If memory conflicts with authoritative sources, ignore the memory entry and fix or remove it when appropriate.

Final reports must say `MEMORY.md changed: Yes/No`; `MEMORY.md changed: No; no memory file needed` is the normal outcome. If yes, explain why the entry is durable, compact, repeatedly useful, and not better placed in canonical docs, source files, validation, local instruction files, repo maps, ADRs, changelogs, release notes, architecture docs, source-of-truth docs, or current-state docs.
