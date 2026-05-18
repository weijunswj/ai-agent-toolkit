<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/claude-web.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Web

Claude web can use instruction-only skills when custom Skills are available in the account or workspace.

## Use This Toolkit

1. Choose a skill under `skills/`.
2. Upload the complete folder when Claude custom Skills are available.
3. Keep source material credential-free.
4. Test with a matching prompt.

## Limitations

Claude web may not have local shell, file, MCP, or connector access. If it cannot inspect or mutate local files, it should provide manual steps instead of claiming work was done.

Do not automate Claude web through cookies, browser sessions, or session hacks.
