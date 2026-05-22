# Source Manifest: AI Coding Agent Rules

## Preserved In `_main/`

- `_partials/ai-coding-agent-execution.md`
- `_partials/toolkit-skill-routing.md`
- `AGENTS.template.md`
- `CLAUDE.template.md`
- `GEMINI.template.md`
- `TOOLKIT-SKILL-ROUTING.template.md`
- `README.md`

`_partials/ai-coding-agent-execution.md` was moved exactly from the former n8n local setup project source path. Do not rewrite or shorten it during this source-ownership split.

`_partials/toolkit-skill-routing.md` was moved exactly from the former n8n skill-routing partial surface and renamed to make the generic ownership clear.

The source-side generic inert templates under `_main/` are generated from `_partials/ai-coding-agent-execution.md` by `npm run build:agent-rules`.

`TOOLKIT-SKILL-ROUTING.template.md` is generated from `_partials/toolkit-skill-routing.md` as an optional add-on. It is not part of the default generic `AGENTS.template.md`, `CLAUDE.template.md`, or `GEMINI.template.md` baseline.

## AI-Facing Surfaces

- `skills/ai-coding-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/ai-coding-agent-rules/AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md` are generated from `_main/*.template.md`.
- `skills/ai-coding-agent-rules/AGENTS.with-toolkit-skills.template.md`, `CLAUDE.with-toolkit-skills.template.md`, and `GEMINI.with-toolkit-skills.template.md` are published-only convenience templates generated directly from the generic baseline and toolkit skill-routing partial specs.
- `skills/ai-coding-agent-rules/TOOLKIT-SKILL-ROUTING.template.md` is generated from `_main/TOOLKIT-SKILL-ROUTING.template.md`.

The published templates intentionally use inert `.template.md` filenames so the skill folder does not ship active nested `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` instruction files.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- n8n-specific workflow, MCP routing, live-instance, and manual-configuration rules. Those remain owned by `n8n.local-setup`.
- Credentials, `.env*`, private keys, credential exports, local runtime state, package artifacts, and product repo files.
- MCP output. This module publishes only the standalone skill surface plus the generated project registry update.
