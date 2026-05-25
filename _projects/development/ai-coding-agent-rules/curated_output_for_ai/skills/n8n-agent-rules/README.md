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

Adapters under [adapters/](adapters/) are optional brief snippets for active `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` files. They are not automatically appended to the generic templates and do not duplicate the full ruleset.

When this skill is used for an n8n task, agents should automatically check whether the current target repo has the managed adapter block in active instruction files. If an active file exists and the block is missing, run [scripts/install-n8n-agent-adapter.cjs](scripts/install-n8n-agent-adapter.cjs) with `--dry-run`, show the preview, and ask for explicit current-turn approval before `--write`.

If no `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` exists, `--target auto` is discovery only. Stop and ask which adapter target to create or propose before continuing the n8n task, unless the user already answered that target question in the current turn. Ask even during read-only or no-modify tasks. Read-only/no-modify blocks file writes and `--write`; it does not block the adapter-target question. Agents must present all five options neutrally: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `all`, or `none`. Do not suggest or default to `none` merely because the current task is read-only or no-modify. `none` is allowed and must be respected.

Do not silently auto-install adapters. The script must be run with `--write` before it mutates files. `--target auto` only patches existing active instruction files. `--target all` can preview or, after approval with `--write`, create or update `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`.

Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the extra context cost. Prefer installing this skill or a generated cross-skill reference.
