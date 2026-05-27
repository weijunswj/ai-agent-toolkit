# AI Coding Agent Rule Templates

This source folder owns the repo/folder-local managed shared agent instruction contract, compatibility shims, and the canonical n8n agent rules source.

## Templates

- [AGENTS.template.md](AGENTS.template.md), [CLAUDE.template.md](CLAUDE.template.md), and [GEMINI.template.md](GEMINI.template.md) are human/manual global setup reference templates generated from the reusable execution prompt partial.
- [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md), [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md), [repo-local/GEMINI.shim.template.md](repo-local/GEMINI.shim.template.md), and [repo-local/antigravity-bootstrap.template.md](repo-local/antigravity-bootstrap.template.md) are repo-local automatic bootstrap templates.
- Default repo-local templates keep `AGENTS.md` as the canonical shared contract and avoid duplicating full rules across agent-specific shims.
- Optional n8n adapters publish under [skills/n8n-agent-rules/adapters/](../../../../skills/n8n-agent-rules/adapters/) after sync. They point to the n8n skill instead of duplicating the full ruleset.
- Do not overwrite existing active instruction files.
- After changing root instruction template sources, run `node repo/scripts/sync-agent-instruction-shims.cjs --write` to refresh root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`, then run `node repo/scripts/sync-toolkit-projects.cjs --write` to publish skill copies.

## Source Partials

- [_partials/ai-coding-agent-execution.md](_partials/ai-coding-agent-execution.md) is the one canonical reusable toolkit prompt source.
- [_partials/toolkit-skill-routing.md](_partials/toolkit-skill-routing.md) is the toolkit skill-routing source partial.
- [_partials/n8n-agent-rules.md](_partials/n8n-agent-rules.md) is the canonical full n8n operating ruleset source.

## n8n Agent Rules

For n8n work, install or load:

[skills/n8n-agent-rules/](../../../../skills/n8n-agent-rules/)

Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
