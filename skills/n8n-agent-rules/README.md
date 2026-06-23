<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/n8n-agent-rules/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Agent Rules Skill

Instruction-only skill for the full n8n operating ruleset.

Install or load this skill for every n8n task. Other n8n skills depend on it:

- `n8n-local-setup`
- `n8n-workflow-helper-scripts`
- `n8n-workflow-templates`

The full rules live at [n8n-agent-rules.md](n8n-agent-rules.md). Keep that file available locally when copying this skill folder.

Adapters under [adapters/](adapters/) are optional brief snippets. For repo-local installs, the canonical adapter target is root `AGENTS.md`; `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md` should stay tiny platform shims maintained by `ai-coding-agent-rules`.

When this skill is used for an n8n task, agents should automatically check whether the current target repo has the managed adapter block in `AGENTS.md`. If `AGENTS.md` exists and the block is missing or stale, run [scripts/install-n8n-agent-adapter.cjs](scripts/install-n8n-agent-adapter.cjs) with `--target auto --dry-run`, show the preview, and ask for explicit current-turn approval naming `AGENTS.md` before `--write`.

The installer writes the canonical managed block sourced from `_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md`. It must not append separate n8n adapter variants to `CLAUDE.md` or `GEMINI.md`.

If no `AGENTS.md` exists, `--target auto` is discovery only. Stop and ask whether to install or repair repo-local `AGENTS.md` with `ai-coding-agent-rules`, create or update only `AGENTS.md` with this adapter, or choose `none`, unless the user already answered that target question in the current turn. Ask even during read-only or no-modify tasks. Read-only/no-modify blocks file writes and `--write`; it does not block the adapter-target question. `none` is allowed and must be respected.

Do not silently auto-install adapters. The script must be run with `--write` before it mutates `AGENTS.md`. `--target auto` only previews or patches existing `AGENTS.md`. `--target agents` can preview or, after approval with `--write`, create or update only `AGENTS.md`.
Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the extra context cost. Prefer installing this skill or a generated cross-skill reference.
