# Skill Routing Rules

Use installed skills only when they clearly match the task and improve correctness.

Use the skill name, description, and local files to decide whether a skill applies. Load the full skill only when the task matches its scope.

## Current Toolkit Skill Routing

| Skill | Use when the task involves |
|---|---|
| `ai-coding-agent-rules` | Bootstrapping, checking, or repairing repo-local AI coding agent instruction files and platform shims for Codex, Claude Code, or Antigravity. |
| `toolkit-setup` | AI Agent Toolkit plugin setup, Toolkit Local Bridge setup or troubleshooting, repo-backed Toolkit auto-update, OpenCode bridge support, AG2 adapter support, bridge audit, enabled-target sync, disable, stale bridge state, native Codex or Claude Code plugin update behavior, Windows hook repair, or narrow installed `n8n-skills@n8n-io` compatibility intents such as repair, hook fixes, inspection, reconciliation, or n8n `.sh` hooks opening in an editor. Workflow import/export, workflow design, credentials/OAuth, repo-local n8n helpers or consumer-helper refresh, MCP/API configuration, and live n8n/Docker/server work are excluded from this route. |
| `n8n-agent-rules` | Any n8n task, including [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill currently named `using-n8n-skills`, workflow JSON, official n8n MCP, `n8n_live`, workflow creation or updates, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, or n8n safety. |
| `n8n-local-setup` | Safe n8n environment setup with the localhost/ngrok dev stack, the separate production Cloudflare Tunnel self-hosting stack for local/CGNAT machines, hosted n8n Hostinger Coolify VPS notes, stack templates, MCP config selection, or platform-specific n8n agent-rule setup. |
| `n8n-workflow-helper-scripts` | Safe n8n workflow helper scripts, sanitizer helpers, import/export sync helpers, validation, comparison, live-import preparation, or repo/live workflow hygiene. |
| `n8n-workflow-templates` | Selecting, reviewing, or copying public reusable n8n workflow JSON templates that are generic, inactive, credential-free, and safe for publication. |
| `secure-cicd-installer` | Reviewing, planning, or applying secure CI/CD installer materials with approval-gated writes, safe status tracking, and no default command execution. |
| `context-preserving-ai-publisher` | Creating or maintaining source-traceable AI-facing repo surfaces, generated skills, MCP notes, templates, pack metadata, manifests, source locks, audit baselines, or anti-drift docs. |
| `agent-skill-supply-chain-audit` | Auditing third-party agent skills, `SKILL.md` folders, skill packs, or GitHub skill repositories for provenance, license, safety, toolkit conversion fit, and usefulness/token-bloat review before import. |
| `local-ai-stack-safety` | Reviewing local AI stack setup risk for local model runners, model servers, model downloads, GPU/runtime changes, local AI web UIs, or local AI endpoint exposure. |
| `managed-app-foundation-review` | Revisiting implementation plans to compare low-cost, free, managed, or owner-hosted foundations before custom-building auth, backend APIs, user accounts, databases, workflow automation, CRM/contact pipelines, forms, email, storage, analytics, ops, traffic/security monitoring, or account-security foundations. |
| `project-completion-audit` | Guarded final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, "make sure everything works", "is this production ready", `/goal` readiness remediation, audit against original docs, security-readiness check, or final readiness check. Only lightweight preflight is allowed before explicit confirmation. |
| `codex-ssh-hostinger-coolify-setup-maintainer` | Codex SSH Hostinger VPS plus Coolify deployment setup, SSH preflight, daily security checks, intrusion-signal review, optional Telegram/email maintenance alerts, evidence-based maintenance, and incident response with owner approval gates. Use when the user asks Codex to help set up Hostinger for deployment, configure daily maintenance alerts, or review Hostinger/Coolify security signals. |
| `self-hosted-service-safety` | Reviewing non-n8n self-hosted service setup risk for Docker/VPS plans, reverse proxies, public ports, DNS/TLS, tunnels, credentials, backups, public admin/backup paths, honeypot/canary paths, traffic logs, SSH access, firewall exposure, or first-run hardening. |
| `windows-localhost-workflows` | Starting, relaunching, verifying, or troubleshooting localhost development workflows on Windows. |
| `knowledge-index-updater` | Creating or updating a Notion/GitHub knowledge index, merging duplicates, categorising entries, maintaining stable source keys, or scheduling index checks. |
| `ui-ux-secure-frontend-design` | Creating, reviewing, or improving frontend interfaces, design systems, landing pages, SaaS dashboards, forms, components, accessibility, responsive polish, privacy-safe UX, or implementation quality. |

## Intentionally Omitted Skills

None currently. If a skill should not be auto-routed, list it here as `skill-name`: reason.

## Routing Maintenance

- When adding, removing, renaming, or materially changing a skill under `skills/**`, update this routing table.
- When adding, removing, renaming, or materially changing a project module that publishes a skill, update this routing table if that skill should be invokable by supported agents.
- When changing skill names, `SKILL.md` frontmatter, or skill descriptions, update README skill tables when applicable, this routing partial, and generated `AGENTS`/`CLAUDE`/`GEMINI` equivalents.
- When a new skill should not be auto-routed, document why it is intentionally omitted.
- Do not let this routing table become stale relative to current `skills/*/SKILL.md`.

## Safety

Do not use a skill as permission to mutate live systems, write secrets, run live n8n actions, install templates without review, or skip explicit approval gates.
