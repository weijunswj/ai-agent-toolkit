# Source Manifest: AI Coding Agent Rules

## Preserved In `_main/`

- `_partials/ai-coding-agent-execution.md`
- `_partials/agent-toolkit-managed-block.md`
- `_partials/agent-toolkit-n8n-adapter-block.md`
- `_partials/claude-shim.md`
- `_partials/gemini-shim.md`
- `_partials/antigravity-bootstrap.md`
- `_partials/toolkit-skill-routing.md`
- `_partials/n8n-agent-rules.md`
- `scripts/install-n8n-agent-adapter.cjs`
- `AGENTS.template.md`
- `CLAUDE.template.md`
- `GEMINI.template.md`
- `README.md`

`_partials/ai-coding-agent-execution.md` was moved from the former n8n local setup project source path and kept as retired provenance. It is not the current template source; only stale publication-approval wording may be adapted to avoid contradicting the managed marker blocks.

`_partials/toolkit-skill-routing.md` was moved exactly from the former n8n skill-routing partial surface and renamed to make the generic ownership clear.

`_partials/n8n-agent-rules.md` is the canonical editable full n8n operating ruleset. It moved from the former `n8n.local-setup` partial because it is an agent instruction block, not local setup material.

The source-side generic inert templates under `_main/` are generated from declared `_partials/` entries by `npm run build:agent-rules`. They intentionally stay slim and do not include the full n8n operating ruleset or full skill-routing table.

The managed instruction shim partials are repo-authored toolkit source. `agent-toolkit-managed-block.md` and `agent-toolkit-n8n-adapter-block.md` publish into the canonical `AGENTS.template.md` payload and root `AGENTS.md`. `claude-shim.md`, `gemini-shim.md`, and `antigravity-bootstrap.md` provide import/bootstrap compatibility without duplicating the full `AGENTS.md` body.

## AI-Facing Surfaces

- `skills/ai-coding-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/ai-coding-agent-rules/AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md` are generated from `_main/*.template.md`.
- `skills/ai-coding-agent-rules/ANTIGRAVITY.bootstrap.template.md` is copied from `_main/_partials/antigravity-bootstrap.md` for portable `.agents/rules/00-agent-toolkit-bootstrap.md` setup.
- Root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md` are checked by `repo/scripts/sync-agent-instruction-shims.cjs`; the script updates marker-owned blocks and preserves unmarked user/repo content.
- `skills/n8n-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/n8n-agent-rules/n8n-agent-rules.md` is copied exactly from `_main/_partials/n8n-agent-rules.md`.
- `skills/n8n-agent-rules/adapters/*.n8n-brief.template.md` are optional brief adapter snippets generated from curated source. They are not appended to generic templates automatically.
- `skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs` is copied from `_main/scripts/` and is dry-run/write gated.
- `skills/n8n-local-setup/references/n8n-agent-rules.md`, `skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md`, and `skills/n8n-workflow-templates/references/n8n-agent-rules.md` are generated cross-skill references. They are labelled as generated cross-skill content and source-owned by this project while published into dependent n8n skill folders for copy-paste portability.

The published templates intentionally use inert `.template.md` filenames so the skill folder does not ship active nested `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` instruction files.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- Credentials, `.env*`, private keys, credential exports, local runtime state, package artifacts, and product repo files.
- MCP output. This module publishes instruction-only skill surfaces plus the generated project registry update.
