# AI Coding Agent Rule Templates

This source folder owns the repo/folder-local managed shared agent instruction contract, compatibility shims, and the canonical n8n agent rules source.

## Templates

- [AGENTS.template.md](AGENTS.template.md) is the canonical full reusable toolkit prompt template generated from the managed instruction partials.
- [templates/CLAUDE.shim.template.md](templates/CLAUDE.shim.template.md), [templates/GEMINI.shim.template.md](templates/GEMINI.shim.template.md), and [templates/antigravity-bootstrap.template.md](templates/antigravity-bootstrap.template.md) are tiny compatibility shim templates.
- Default generic templates keep `AGENTS.md` as the canonical shared contract and avoid duplicating full rules across agent-specific shims.
- Optional n8n adapters publish under [skills/n8n-agent-rules/adapters/](../../../../skills/n8n-agent-rules/adapters/) after sync. They point to the n8n skill instead of duplicating the full ruleset.
- Do not overwrite existing active instruction files.

## Source Partials

- [_partials/agent-toolkit-managed-block.md](_partials/agent-toolkit-managed-block.md) and [_partials/agent-toolkit-n8n-adapter-block.md](_partials/agent-toolkit-n8n-adapter-block.md) generate the shared `AGENTS.md` payload.
- [_partials/claude-shim.md](_partials/claude-shim.md), [_partials/gemini-shim.md](_partials/gemini-shim.md), and [_partials/antigravity-bootstrap.md](_partials/antigravity-bootstrap.md) generate the compatibility shim/bootstrap payloads.
- [_partials/ai-coding-agent-execution.md](_partials/ai-coding-agent-execution.md) is preserved retired-source provenance for the reusable execution prompt.
- [_partials/toolkit-skill-routing.md](_partials/toolkit-skill-routing.md) is the toolkit skill-routing source partial.
- [_partials/n8n-agent-rules.md](_partials/n8n-agent-rules.md) is the canonical full n8n operating ruleset source.

## n8n Agent Rules

For n8n work, install or load:

[skills/n8n-agent-rules/](../../../../skills/n8n-agent-rules/)

Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
