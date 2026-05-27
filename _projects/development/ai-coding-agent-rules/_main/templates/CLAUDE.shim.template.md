<!--
Generated from toolkit project source. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/_main/_partials/claude-shim.md
Update the project source and run sync.
-->
# CLAUDE.template.md AI coding agent rules

Use this generated template for Claude Code.

This file is inert while it keeps the `.template.md` filename. It is safe to keep inside a skill folder because it is not named `CLAUDE.md`.

Copy or merge the fenced payload into the target repo root as `CLAUDE.md` only when the user explicitly wants generic Claude Code rules installed.

If the target repo already has `CLAUDE.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## Claude Code global rules example

Copy or merge the fenced payload into:

```text
C:\Users\<your-user>\.claude\CLAUDE.md
```

Or create it with PowerShell:

```text
mkdir $HOME\.claude -Force
notepad $HOME\.claude\CLAUDE.md
```

---

````````md
# Claude Code Instructions

@AGENTS.md

Root `AGENTS.md` is canonical.
````````
