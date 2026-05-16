# Agent Rule Templates

This folder contains generated copy-paste rules for AI coding agents.

Generated files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

Source partials:

- `partials/ai-coding-agent-execution.md`
- `partials/n8n-mcp-rules.md`
- `partials/skill-routing-rules.md`

Regenerate with:

```powershell
pwsh -NoProfile -File scripts/build-agent-rule-templates.ps1
```

Generated outputs must stay deterministic. Do not edit them directly.
