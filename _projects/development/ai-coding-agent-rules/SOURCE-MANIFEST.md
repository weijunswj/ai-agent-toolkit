# Source Manifest: AI Coding Agent Rules

## Preserved In `_main/`

- `_partials/ai-coding-agent-execution.md`
- `_partials/toolkit-skill-routing.md`
- `_partials/n8n-agent-rules.md`
- `scripts/install-n8n-agent-adapter.cjs`
- `AGENTS.template.md`
- `CLAUDE.template.md`
- `GEMINI.template.md`
- `repo-local/AGENTS.managed.template.md`
- `repo-local/CLAUDE.shim.template.md`
- `repo-local/GEMINI.shim.template.md`
- `repo-local/antigravity-bootstrap.template.md`
- `README.md`

`_partials/ai-coding-agent-execution.md` is the one canonical reusable execution-first toolkit prompt source. It is used to generate manual global templates, the repo-local managed `AGENTS.md` template, and the root `AGENTS.md` managed toolkit block. GitHub/PR/VCS publication approval workflow wording is intentionally omitted from the default toolkit prompt.

`_partials/toolkit-skill-routing.md` was moved exactly from the former n8n skill-routing partial surface and renamed to make the generic ownership clear.

`_partials/n8n-agent-rules.md` is the canonical editable full n8n operating ruleset. It moved from the former `n8n.local-setup` partial because it is an agent instruction block, not local setup material.

The manual global templates `_main/AGENTS.template.md`, `_main/CLAUDE.template.md`, and `_main/GEMINI.template.md` are human-facing reference docs generated from `_partials/ai-coding-agent-execution.md`.

The repo-local templates under `_main/repo-local/` are for automatic folder-local bootstrap. `AGENTS.managed.template.md` is generated from `_partials/ai-coding-agent-execution.md`; the Claude, Gemini, and Antigravity shims are direct tiny template sources and are not assembled from separate five-line partials.

## AI-Facing Surfaces

- `skills/ai-coding-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md` is generated from `_main/repo-local/AGENTS.managed.template.md`.
- `skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md`, `GEMINI.shim.template.md`, and `antigravity-bootstrap.template.md` are generated from `_main/repo-local/*.template.md`.
- `skills/ai-coding-agent-rules/AGENTS.template.md`, `CLAUDE.template.md`, `GEMINI.template.md`, and `antigravity-bootstrap.template.md` are repo-local compatibility aliases generated from the same `_main/repo-local/` templates. New docs should prefer the `repo-local/` paths.
- Root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md` are checked by `repo/scripts/sync-agent-instruction-shims.cjs`; run `node repo/scripts/sync-agent-instruction-shims.cjs --write` after changing the source templates. The script updates marker-owned blocks and preserves unmarked user/repo content.
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
