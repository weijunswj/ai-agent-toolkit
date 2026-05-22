<!--
Generated from toolkit project source. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/_main/TOOLKIT-SKILL-ROUTING.template.md
Update the project source and run sync.
-->
<!--
Generated from toolkit project source. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md
Update the project source and run sync.
-->
# TOOLKIT-SKILL-ROUTING.template.md optional toolkit skill-routing add-on

Use this generated template for Codex, OpenCode, Claude Code, Gemini CLI, or Antigravity when this toolkit's skills folders are installed or copied.

This file is inert while it keeps the `.template.md` filename. It is safe to keep inside a skill folder because it is not named `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

This optional add-on contains toolkit skill-routing rules only.

Use it only when the target environment has this toolkit's `skills/` folders installed or copied.

Do not use it as a standalone replacement for generic AGENTS/CLAUDE/GEMINI rules.

First install or copy the generic baseline rules from:

- [skills/ai-coding-agent-rules/AGENTS.template.md](AGENTS.template.md)
- [skills/ai-coding-agent-rules/CLAUDE.template.md](CLAUDE.template.md)
- [skills/ai-coding-agent-rules/GEMINI.template.md](GEMINI.template.md)

Then merge the fenced payload from this file under the generic baseline in the same active instruction file.

Do not overwrite existing active instruction files. Merge manually or produce a diff/merge plan.

---

````````md
# Skill Routing Rules

Use installed skills only when they clearly match the task and improve correctness.

## Frontend Design

Use `ui-ux-secure-frontend-design` for design systems, landing pages, SaaS dashboards, forms, accessibility, responsive polish, privacy-safe UX, and frontend implementation review.

## Localhost

Use `windows-localhost-workflows` for starting, relaunching, verifying, and troubleshooting local Windows dev servers.

## n8n Workflow Toolkit

Use `n8n-workflow-helper-scripts` for safe n8n workflow sanitation, repo/live sync planning, credential binding hygiene, and import/export review.

Use `n8n-workflow-templates` for selecting, reviewing, or copying public generic inactive n8n workflow JSON templates.

## Secure CI/CD

Use secure CI/CD materials for GitHub Actions setup, CI security gates, safe deployment planning, and `CURRENT_CICD_STATUS.md` style tracking.

## Safety

Do not use a skill as permission to mutate live systems, write secrets, run live n8n actions, or install templates without review.
````````
