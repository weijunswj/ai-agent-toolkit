<!--
Generated from toolkit project source. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/_main/_partials/gemini-shim.md
Update the project source and run sync.
-->
# GEMINI.template.md AI coding agent rules

Use this generated template for Gemini CLI or Antigravity.

This file is inert while it keeps the `.template.md` filename. It is safe to keep inside a skill folder because it is not named `GEMINI.md`.

Copy or merge the fenced payload into the target repo root as `GEMINI.md` only when the user explicitly wants generic Gemini CLI/Antigravity rules installed.

If the target repo already has `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## Gemini CLI and Antigravity global rules example

Copy or merge the fenced payload into:

```text
C:\Users\<your-user>\.gemini\GEMINI.md
```

Or create it with PowerShell:

```text
mkdir $HOME\.gemini -Force
notepad $HOME\.gemini\GEMINI.md
```

---

````````md
# Gemini Instructions

@./AGENTS.md

Root `AGENTS.md` is canonical.
````````
