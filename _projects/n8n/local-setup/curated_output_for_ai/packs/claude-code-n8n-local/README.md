<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Code n8n Local Pack

Collects the generic Claude Code rules template from `skills/ai-coding-agent-rules`, the full `n8n-agent-rules` skill, the optional Claude n8n adapter, Claude MCP config guidance, and local n8n setup guides.

Review `pack.json` before use.

Copy or merge the generic `CLAUDE.template.md` into the target repo root as `CLAUDE.md`, install or load `skills/n8n-agent-rules`, and optionally merge `CLAUDE.n8n-brief.template.md` into the same file. If the target repo already has `CLAUDE.md`, do not overwrite it; produce a merge/diff plan. Run the adapter installer with `--dry-run` first and only use `--write` after explicit current-turn approval.
