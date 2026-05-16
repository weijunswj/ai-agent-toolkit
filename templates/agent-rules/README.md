# Agent Rule Templates

This folder contains generated copy-paste rules for AI coding agents.

Generated files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

Source partials live in the local n8n setup project exports:

- [projects/n8n/local-setup/exports/templates/agent-rules/partials/ai-coding-agent-execution.md](../../projects/n8n/local-setup/exports/templates/agent-rules/partials/ai-coding-agent-execution.md)
- [projects/n8n/local-setup/exports/templates/agent-rules/partials/n8n-mcp-rules.md](../../projects/n8n/local-setup/exports/templates/agent-rules/partials/n8n-mcp-rules.md)
- [projects/n8n/local-setup/exports/templates/agent-rules/partials/skill-routing-rules.md](../../projects/n8n/local-setup/exports/templates/agent-rules/partials/skill-routing-rules.md)

The preserved original project templates remain under [projects/n8n/local-setup/main/templates/](../../projects/n8n/local-setup/main/templates/). They are archival source, not the root template generation source.

Regenerate with:

```powershell
pwsh -NoProfile -File scripts/build-agent-rule-templates.ps1
```

On Windows you can also run:

```cmd
scripts\- build-agent-rule-templates.cmd
```

Generated outputs must stay deterministic. Do not edit them directly.

Generated outputs are normal Markdown files. They are not wrapped in a single giant code fence, because the n8n rules contain their own fenced examples.

The generated-template CI workflow may auto-commit only these three generated files back to a same-repo pull request branch. It must not auto-commit on `main` or touch unrelated files.
