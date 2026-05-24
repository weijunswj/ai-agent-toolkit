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

- [_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md](AGENTS.template.md)
- [_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md](CLAUDE.template.md)
- [_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md](GEMINI.template.md)

Then merge the fenced payload from this file under the generic baseline in the same active instruction file.

Do not overwrite existing active instruction files. Merge manually or produce a diff/merge plan.

---

````````md
# Skill Routing Rules

Use installed skills only when they clearly match the task and improve correctness.

Use the skill name, description, and local files to decide whether a skill applies. Load the full skill only when the task matches its scope.

## Current Toolkit Skill Routing

| Skill | Use when the task involves |
|---|---|
| `ai-coding-agent-rules` | Installing or explaining generic execution-first agent rules, optional toolkit skill-routing, or safe merge plans for `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. |
| `n8n-local-setup` | Safe local n8n setup, MCP config selection, tunneling choices, or platform-specific n8n agent-rule setup. |
| `n8n-workflow-helper-scripts` | Safe n8n workflow helper scripts, sanitizer helpers, import/export sync helpers, validation, comparison, live-import preparation, or repo/live workflow hygiene. |
| `n8n-workflow-templates` | Selecting, reviewing, or copying public reusable n8n workflow JSON templates that are generic, inactive, credential-free, and safe for publication. |
| `secure-cicd-installer` | Reviewing, planning, or applying secure CI/CD installer materials with approval-gated writes, safe status tracking, and no default command execution. |
| `context-preserving-ai-publisher` | Creating or maintaining source-traceable AI-facing repo surfaces, generated skills, MCP notes, templates, pack metadata, manifests, source locks, audit baselines, or anti-drift docs. |
| `windows-localhost-workflows` | Starting, relaunching, verifying, or troubleshooting localhost development workflows on Windows. |
| `knowledge-index-updater` | Creating or updating a Notion/GitHub knowledge index, merging duplicates, categorising entries, maintaining stable source keys, or scheduling index checks. |
| `ui-ux-secure-frontend-design` | Creating, reviewing, or improving frontend interfaces, design systems, landing pages, SaaS dashboards, forms, components, accessibility, responsive polish, privacy-safe UX, or implementation quality. |

## Intentionally Omitted Skills

None currently. If a skill should not be auto-routed, list it here as `skill-name`: reason.

## Routing Maintenance

- When adding, removing, renaming, or materially changing a skill under `skills/**`, update this routing table.
- When adding, removing, renaming, or materially changing a project module that publishes a skill, update this routing table if that skill should be invokable by supported agents.
- When changing skill names, `SKILL.md` frontmatter, or skill descriptions, update the registry source that publishes `mcp/registry/skills.registry.json`, README skill tables when applicable, this routing partial, and generated `AGENTS`/`CLAUDE`/`GEMINI` equivalents.
- When a new skill should not be auto-routed, document why it is intentionally omitted.
- Do not let this routing table become stale relative to current `skills/*/SKILL.md`.

## Safety

Do not use a skill as permission to mutate live systems, write secrets, run live n8n actions, install templates without review, or skip explicit approval gates.
````````
