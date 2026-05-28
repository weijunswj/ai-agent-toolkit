<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/packs/claude-code-n8n-local/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Code n8n Local Pack

Collects [AI Coding Agent Rules](../../../ai-coding-agent-rules/), [n8n Agent Rules](../../../n8n-agent-rules/), the optional [Claude n8n adapter](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md), [local Docker Compose stack templates](../../templates/local-stack/), [Claude MCP config](../../templates/mcp-configs/claude-mcp-config.md), and local n8n setup guides.

Review [pack.json](pack.json) before use.

## Instruction files

<ol>
<li>Create or merge [repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) into the target repo root as `AGENTS.md`.</li>
<li>Add [repo-local/CLAUDE.shim.template.md](../../../ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md) as `CLAUDE.md`.</li>
<li>Install or load [n8n Agent Rules](../../../n8n-agent-rules/).</li>
<li>Optionally merge [CLAUDE.n8n-brief.template.md](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md) into the same file.</li>
</ol>

If the target repo already has instruction files, do not overwrite them; produce a merge/diff plan. Run the adapter installer with `--dry-run` first and only use `--write` after explicit current-turn approval.

## Local runtime

<ol>
<li>Copy the local stack templates outside this repo.</li>
<li>Copy [.env.example](../../templates/local-stack/.env.example) to `.env`.</li>
<li>Fill placeholders locally.</li>
<li>Start through [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd).</li>
</ol>

Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
