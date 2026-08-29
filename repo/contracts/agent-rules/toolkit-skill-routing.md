# Skill Routing Rules

Use installed skills only when they clearly match the task and improve correctness.

Use the skill name, description, and local files to decide whether a skill applies. Load the full skill only when the task matches its scope.

## Current Toolkit Skill Routing

| Skill | Use when the task involves |
|---|---|
| `repository-agent-rules` | Bootstrapping, checking, or repairing repo-local AI coding agent instruction files and platform shims for Codex, Claude Code, OpenCode, or Antigravity. |
| `toolkit-setup` | AI Agent Toolkit plugin setup, Toolkit Local Bridge setup or troubleshooting, repo-backed Toolkit auto-update, OpenCode bridge support, AG2 adapter support, bridge audit, enabled-target sync, disable, stale bridge state, native Codex or Claude Code plugin update behavior, Windows hook repair, or narrow installed `n8n-skills@n8n-io` repair intents such as n8n `.sh` hooks opening in an editor. Repo-local n8n helpers and live n8n/Docker/server work are excluded from this repair route. |
| `n8n-safety-router` | Any n8n task, including official n8n Skills, workflow JSON, MCP, `n8n_live`, helper scripts, import/export, validation, credentials, activation, execution, repo/live sync, or n8n safety. Load before narrower n8n products. |
| `n8n-environment-setup` | Safe n8n environment setup with localhost/ngrok development, separate Cloudflare Tunnel production self-hosting, hosted Hostinger Coolify notes, stack templates, backups, launchers, MCP config selection, or platform-specific setup. |
| `n8n-workflow-transport` | Safe n8n workflow sanitizer, validation, comparison, export, import-preparation, and repository/live hygiene helpers. This product does not publish reusable workflow JSON or authorise live transport. |
| `secure-ci-cd` | Reviewing, planning, or applying security-first CI/CD materials with approval-gated writes, deployment-off defaults, required checks, and safe status tracking. |
| `skill-product-review` | Reviewing third-party agent products before import or adaptation, then maintaining approved source-traceable skills, contracts, provenance, templates, audits, or anti-drift surfaces under direct canonical ownership. |
| `local-ai-safety` | Reviewing local AI setup risk for model runners, model servers, model downloads, GPU/runtime changes, local AI web UIs, or endpoint exposure. |
| `managed-app-foundation-review` | Revisiting implementation plans to compare low-cost, free, managed, or owner-hosted foundations before custom-building auth, backend APIs, user accounts, databases, workflow automation, CRM/contact pipelines, forms, email, storage, analytics, ops, traffic/security monitoring, or account-security foundations. |
| `github-program-reconciler` | Mandatory implicit inspection/preflight for managed GitHub programme lifecycle intent; deterministic preview-bound Parent/Child/PR reconciliation, native sub-issues/dependencies, truthful exact-head review evidence, and Deferred Findings. Implicit discovery never grants mutation, review mutation, Ready, merge, or Web finality. |
| `release-readiness-audit` | Guarded final, completion, production-readiness, release-candidate, launch-readiness, QA, security-readiness, or `/goal` audit. Only lightweight preflight is allowed before explicit confirmation. |
| `codex-ssh-hostinger-coolify-setup-maintainer` | Codex SSH Hostinger VPS plus Coolify deployment setup, SSH preflight, daily security checks, intrusion-signal review, optional Telegram/email maintenance alerts, evidence-based maintenance, and incident response with owner approval gates. Use when the user asks Codex to help set up Hostinger for deployment, configure daily maintenance alerts, or review Hostinger/Coolify security signals. |
| `self-hosted-service-safety` | Reviewing non-n8n self-hosted service setup risk for Docker/VPS plans, reverse proxies, public ports, DNS/TLS, tunnels, credentials, backups, public admin/backup paths, honeypot/canary paths, traffic logs, SSH access, firewall exposure, or first-run hardening. |
| `windows-local-dev-services` | Starting, relaunching, verifying, or troubleshooting local development services on Windows, including process, port, shell, runtime, and readiness failures. |
| `frontend-art-direction` | Establishing frontend art direction, design systems, landing pages, dashboards, forms, components, accessibility, responsive quality, privacy-safe UX, or approved-design implementation review. It does not infer a new theme or redesign for narrow fixes. |

## Routing Maintenance

- When adding, removing, renaming, or materially changing a skill under `skills/**`, update this routing table.
- When changing skill names, `SKILL.md` frontmatter, or skill descriptions, update README skill tables when applicable, this routing table, and the portable rule templates.
- When a new skill should not be auto-routed, document why it is intentionally omitted.
- Do not let this routing table become stale relative to current `skills/*/SKILL.md`.

## Safety

Do not use a skill as permission to mutate live systems, write secrets, run live n8n actions, install templates without review, or skip explicit approval gates.
