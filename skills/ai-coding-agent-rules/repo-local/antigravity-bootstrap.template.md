<!--
Generated from toolkit project source. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/_main/repo-local/antigravity-bootstrap.template.md
Update the project source and run sync.
-->
# antigravity-bootstrap.template.md repo-local Antigravity bootstrap

Use this repo-local bootstrap template for Antigravity.

This file is inert while it keeps the `.template.md` filename. It is safe to keep inside a skill folder because it is not named `.agents/rules/00-agent-toolkit-bootstrap.md`.

Copy or merge the fenced payload into the target repo root as `.agents/rules/00-agent-toolkit-bootstrap.md` only when the user explicitly wants repo-local Antigravity bootstrap instructions installed.

If the target repo already has `.agents/rules/00-agent-toolkit-bootstrap.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## Repo-local bootstrap example

Copy or merge the fenced payload into:

```text
<repo>\.agents\rules\00-agent-toolkit-bootstrap.md
```

Or create it with PowerShell:

```text
mkdir .agents\rules -Force
notepad .agents\rules\00-agent-toolkit-bootstrap.md
```

---

````````md
# Agent Toolkit Antigravity Bootstrap

Root `AGENTS.md` is the canonical repo instruction file.

**If root `AGENTS.md` is already loaded, do not duplicate or re-import it.**

**If root `AGENTS.md` is not loaded, read root `AGENTS.md` before repo edits.**

Preserve existing `.agents/rules` files.
````````
