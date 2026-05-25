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

Use [scripts/install-n8n-agent-adapter.cjs](scripts/install-n8n-agent-adapter.cjs) only after reviewing its dry-run output. The script must be run with `--write` before it mutates files, and agents must ask for explicit current-turn approval before using `--write`.

Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the extra context cost. Prefer installing this skill or a generated cross-skill reference.
