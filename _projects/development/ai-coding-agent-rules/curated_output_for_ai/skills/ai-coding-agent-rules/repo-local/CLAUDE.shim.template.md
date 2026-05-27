<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# CLAUDE.shim.template.md repo-local Claude Code shim

Use this repo-local shim template for Claude Code.

This file is inert while it keeps the `.template.md` filename. It is safe to keep inside a skill folder because it is not named `CLAUDE.md`.

Copy or merge the fenced payload into the target repo root as `CLAUDE.md` only when the user explicitly wants repo-local Claude Code instructions installed.

If the target repo already has `CLAUDE.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## Repo-local shim example

Copy or merge the fenced payload into:

```text
<repo>\CLAUDE.md
```

Or create it with PowerShell:

```text
notepad CLAUDE.md
```

---

````````md
# Claude Code Instructions

@AGENTS.md

Root `AGENTS.md` is canonical.
````````
