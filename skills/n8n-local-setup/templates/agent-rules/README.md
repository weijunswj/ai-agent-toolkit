# Agent Rule Templates

This folder contains generated copy-paste rules for AI coding agents.

Generated files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

Source partials are declared in the local n8n setup project manifest:

- [_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md](../../../../_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md)
- [_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md](../../../../_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md)
- [skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md](partials/skill-routing-rules.md)

The preserved original project templates remain under [_projects/n8n/local-setup/_main/templates/](../../../../_projects/n8n/local-setup/_main/templates/). They are archival source, not the AI-facing template generation source.

Regenerate with:

```powershell
pwsh -NoProfile -File ../../../../repo/scripts/build-agent-rule-templates.ps1
```

On Windows you can also run:

```cmd
repo\scripts\- build-agent-rule-templates.cmd
```

Generated outputs must stay deterministic. Do not edit them directly.

Generated outputs are normal Markdown files. They are not wrapped in a single giant code fence, because the n8n rules contain their own fenced examples.

The generated-template CI workflow may auto-commit only these three generated files back to a same-repo pull request branch. It must not auto-commit on `main` or touch unrelated files.
