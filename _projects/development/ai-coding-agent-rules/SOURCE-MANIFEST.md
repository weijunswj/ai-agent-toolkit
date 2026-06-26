# Source Manifest: AI Coding Agent Rules

## Preserved In `_main/`

- `_partials/ai-coding-agent-execution.md`
- `_partials/n8n-agent-rules-adapter.md`
- `_partials/toolkit-skill-routing.md`
- `_partials/n8n-agent-rules.md`
- `repo-local/docs/agent-playbooks/*.md`
- `scripts/install-n8n-agent-adapter.cjs`
- `AGENTS.template.md`
- `CLAUDE.template.md`
- `GEMINI.template.md`
- `README.md`

`_partials/ai-coding-agent-execution.md` is the canonical reusable execution-first portable prompt source. It owns the compact always-loaded execution kernel, portable repo-local docs/playbook routing, optional managed `MEMORY.md` behavior, validation/reporting expectations, and the general Git completion contract. It is used to generate the manual global templates and to validate the portable repo-local managed `AGENTS.md` template. It intentionally stays self-contained and must not depend on toolkit-repo-only paths such as `repo/docs/agent-playbooks/`, `_projects/`, `repo/scripts/`, `toolkit.project.json`, or `SOURCE-LOCK.json`.

`repo-local/docs/agent-playbooks/*.md` are portable repo-local playbook docs referenced by the portable execution kernel. They contain expanded optional detail and are published beside `AGENTS.managed.template.md` so consumer repos can install live links at `docs/agent-playbooks/`. Treat this as a folder-level install unit: every Markdown file referenced by `INDEX.md` must be copied or refreshed together.

`_partials/n8n-agent-rules-adapter.md` is the compact fail-closed n8n adapter source appended beside the portable managed toolkit prompt in repo-local managed `AGENTS.md` templates and the toolkit root `AGENTS.md`. Toolkit-specific root routing and playbook rules live directly in root `AGENTS.md` after the managed execution blocks; they are not sourced from this project module.

`_partials/toolkit-skill-routing.md` was moved exactly from the former n8n skill-routing partial surface and renamed to make the generic ownership clear.

`_partials/n8n-agent-rules.md` is the canonical editable full n8n operating ruleset. It moved from the former `n8n.local-setup` partial because it is an agent instruction block, not local setup material.

The manual global templates `_main/AGENTS.template.md`, `_main/CLAUDE.template.md`, and `_main/GEMINI.template.md` are human-facing reference docs generated from `_partials/ai-coding-agent-execution.md`. They may explain manual global setup.

## Reviewed Skill-Facing Source

- `curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`
- `curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md`
- `curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md`
- `curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md`
- `curated_output_for_ai/skills/ai-coding-agent-rules/agents/openai.yaml`
- `curated_output_for_ai/skills/n8n-agent-rules/agents/openai.yaml`

The repo-local templates under `curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/` are skill-facing automatic folder-local bootstrap payloads. They intentionally contain only the exact curated-source safety comment plus destination-file content so agents can copy them wholesale into target repos. Every required repo-local template includes complete `AI-AGENT-TOOLKIT` managed marker pairs so later sessions can verify structural currency without reading or comparing template bodies. `AGENTS.managed.template.md` carries the execution prompt payload from `_partials/ai-coding-agent-execution.md`, including its top-level document title, compact portable playbook routing, optional managed memory behavior, and final-report requirements, plus `_partials/n8n-agent-rules-adapter.md`; the Claude, Gemini, and Antigravity shims are direct tiny template sources and are not assembled from separate five-line partials.

## AI-Facing Surfaces

- `skills/ai-coding-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md` is generated from curated repo-local source without a generated notice because it is copied wholesale into target repo `AGENTS.md`.
- `skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md`, `GEMINI.shim.template.md`, and `antigravity-bootstrap.template.md` are generated from curated repo-local source without generated notices because they are copied wholesale into target repo instruction files.
- `skills/ai-coding-agent-rules/repo-local/docs/agent-playbooks/*.md` is copied exactly from `_main/repo-local/docs/agent-playbooks/` without generated notices because these files are copied into target repo `docs/agent-playbooks/`.
- Root `AGENTS.md` keeps managed execution and n8n adapter blocks generated from this project, then appends toolkit-specific root rules maintained directly in `AGENTS.md`. Root `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md` are checked by `repo/scripts/sync-agent-instruction-shims.cjs`; run `node repo/scripts/sync-agent-instruction-shims.cjs --write` after changing the portable execution partial, manual templates, curated repo-local templates, or active root shims.
- `skills/n8n-agent-rules/SKILL.md` and `README.md` are generated from reviewed curated skill entrypoint source.
- `skills/ai-coding-agent-rules/agents/openai.yaml` and `skills/n8n-agent-rules/agents/openai.yaml` are generated from reviewed curated OpenAI invocation-policy metadata.
- `skills/n8n-agent-rules/n8n-agent-rules.md` is copied exactly from `_main/_partials/n8n-agent-rules.md`.
- `skills/n8n-agent-rules/adapters/*.n8n-brief.template.md` are optional brief adapter snippets generated from curated source. They are not appended to generic templates automatically.
- `skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs` is copied from `_main/scripts/` and is dry-run/write gated.
- `skills/n8n-local-setup/references/n8n-agent-rules.md`, `skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md`, and `skills/n8n-workflow-templates/references/n8n-agent-rules.md` are generated cross-skill references. They are labelled as generated cross-skill content and source-owned by this project while published into dependent n8n skill folders for copy-paste portability.

The published templates intentionally use inert `.template.md` filenames so the skill folder does not ship active nested `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` instruction files.

## Link Surfaces

No reference-link shims are used in this module.

## Excluded

- Credentials, `.env*`, private keys, credential exports, local runtime state, package artifacts, and product repo files.
- MCP output. This module publishes instruction-only skill surfaces plus the generated project registry update.
