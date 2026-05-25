<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Codex n8n Local Pack

Collects the generic Codex rules template from `skills/ai-coding-agent-rules`, the full `n8n-agent-rules` skill, the optional Codex n8n adapter, Codex MCP config guidance, and local n8n setup guides.

Review `pack.json` before use.

Copy or merge the generic `AGENTS.template.md` into the target repo root as `AGENTS.md`, install or load `skills/n8n-agent-rules`, and optionally merge `AGENTS.n8n-brief.template.md` into the same file. If the target repo already has `AGENTS.md`, do not overwrite it; produce a merge/diff plan. Run the adapter installer with `--dry-run` first and only use `--write` after explicit current-turn approval.
