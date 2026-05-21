# Source Manifest: AI Coding Agent Rules

## Preserved In `_main/`

- `templates/partials/ai-coding-agent-execution.md`
- `templates/partials/toolkit-skill-routing.md`
- `templates/agent-rules/AGENTS.template.md`
- `templates/agent-rules/CLAUDE.template.md`
- `templates/agent-rules/GEMINI.template.md`

`templates/partials/ai-coding-agent-execution.md` was moved exactly from the former n8n local setup project source path. Do not rewrite or shorten it during this source-ownership split.

`templates/partials/toolkit-skill-routing.md` was moved exactly from the former linked root surface `skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md` and renamed to make the generic ownership clear.

The source-side inert templates under `_main/templates/agent-rules/` are generated from those partials by `npm run build:agent-rules`.

## AI-Facing Surfaces

- `skills/ai-coding-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/ai-coding-agent-rules/templates/agent-rules/AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md` are generated from `_main/templates/agent-rules/*.template.md`.

The published templates intentionally use inert `.template.md` filenames so the skill folder does not ship active nested `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` instruction files.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- n8n-specific workflow, MCP routing, live-instance, and manual-configuration rules. Those remain owned by `n8n.local-setup`.
- Credentials, `.env*`, private keys, credential exports, local runtime state, package artifacts, and product repo files.
- MCP output. This module publishes only the standalone skill surface plus the generated project registry update.
