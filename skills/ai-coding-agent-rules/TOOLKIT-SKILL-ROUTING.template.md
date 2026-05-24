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

These rules can live inside always-on instruction files such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. They are routing guidance for those agents; they are not themselves a Codex Skill.

## Always-On Rules Vs Codex Skills

- `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are always-on agent instruction files after they are installed in a supported repo or user location.
- Codex Skills are on-demand directories. Each skill directory contains `SKILL.md` with `name` and `description` frontmatter, plus optional local `references/`, `examples/`, `templates/`, `tools/`, `assets/`, or `packs/`.
- Codex initially sees each skill's name, description, and file path. It loads the full `SKILL.md` only when a skill is selected.
- Explicit Codex invocation uses `/skills` or `$skill-name`.
- Implicit Codex invocation depends on a clear match between the user request and the skill `description`.

## Codex Install And Discovery

- Repo-level Codex skill: `<repo>/.agents/skills/<skill-name>/SKILL.md`.
- User-level Codex skill: `$HOME/.agents/skills/<skill-name>/SKILL.md`.
- Admin-level Codex skill: `/etc/codex/skills/<skill-name>/SKILL.md`.
- Codex scans repo skills from `.agents/skills` from the current working directory up to the repo root.
- Symlinked skill folders are acceptable.
- `~/.codex/config.toml` is for Codex configuration, including disabling skills by `SKILL.md` path. It is not the main skill install surface.

When using this toolkit with Codex, copy or symlink the whole `skills/<skill-name>/` folder into one of the Codex skill locations above. Do not copy only `SKILL.md`.

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
- When adding, removing, renaming, or materially changing a project module that publishes a skill, update this routing table if that skill should be invokable by Codex or other agents.
- When changing skill names, `SKILL.md` frontmatter, or skill descriptions, update the registry source that publishes `mcp/registry/skills.registry.json`, README skill tables when applicable, this routing partial, and generated `AGENTS`/`CLAUDE`/`GEMINI` equivalents.
- When a new skill should not be auto-routed, document why it is intentionally omitted.
- Do not let this routing table become stale relative to current `skills/*/SKILL.md`.

## Safety

Do not use a skill as permission to mutate live systems, write secrets, run live n8n actions, install templates without review, or skip explicit approval gates.
````````
