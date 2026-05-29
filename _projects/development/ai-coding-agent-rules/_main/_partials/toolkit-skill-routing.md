# Skill Routing Rules

Use installed skills only when they clearly match the task and improve correctness.

Use the skill name, description, and local files to decide whether a skill applies. Load the full skill only when the task matches its scope.

## Current Toolkit Skill Routing

| Skill | Use when the task involves |
|---|---|
| `ai-coding-agent-rules` | Bootstrapping, checking, or repairing repo-local AI coding agent instruction files and platform shims for Codex, Claude Code, or Antigravity. |
| `n8n-agent-rules` | Any n8n task, including workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, workflow creation or updates, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, or n8n safety. |
| `n8n-local-setup` | Safe local n8n Docker Compose setup, Postgres/ngrok stack templates, MCP config selection, or platform-specific n8n agent-rule setup. |
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
