# Skill Routing Rules

Use installed skills only when they clearly match the task and improve correctness.

Use the skill name, description, and local files to decide whether a skill applies. Load the full skill only when the task matches its scope.

## Current Toolkit Skill Routing

| Skill | Use when the task involves |
|---|---|
| `repository-agent-rules` | Bootstrapping, checking, or repairing repo-local AI coding agent instruction files and platform shims for Codex, Claude Code, OpenCode, or Antigravity. |
| `toolkit-setup` | AI Agent Toolkit plugin setup, Toolkit Local Bridge setup or troubleshooting, repo-backed Toolkit auto-update, Antigravity portable skills-copy only, bridge audit, disable, stale bridge state, or native Codex or Claude Code plugin update behavior. Repo-local n8n helpers and live n8n/Docker/server work are excluded from this route. |
| `toolkit-env` | Seeing, adding, changing, rotating, removing, or connecting the user's own local API keys and tokens for Claude Code or Codex, including `toolkit env` commands and MCP entries that read those keys. Values stay in the computer's credential store. Server-side secrets and Toolkit installation are excluded. |
| `n8n-safety-router` | Any n8n task, including official n8n Skills, workflow JSON, MCP, `n8n_live`, helper scripts, import/export, validation, credentials, activation, execution, repo/live sync, or n8n safety. Load before narrower n8n products. |
| `n8n-environment-setup` | Safe n8n environment setup with localhost/ngrok development, separate Cloudflare Tunnel production self-hosting, hosted Hostinger Coolify notes, stack templates, backups, or launchers. |
| `n8n-workflow-transport` | Safe n8n workflow sanitizer, validation, comparison, export, import-preparation, and repository/live hygiene helpers. This product does not publish reusable workflow JSON or authorise live transport. |
| `secure-ci-cd` | Reviewing, planning, or applying security-first CI/CD materials with approval-gated writes, deployment-off defaults, required checks, and safe status tracking; installing or running the personal-data guard (email, phone and WhatsApp checks in hooks and CI). |
| `skill-product-review` | Reviewing third-party agent products before import or adaptation, then maintaining approved source-traceable skills, contracts, provenance, templates, audits, or anti-drift surfaces under direct canonical ownership. |
| `local-ai-safety` | Reviewing local AI setup risk for model runners, model servers, model downloads, GPU/runtime changes, local AI web UIs, or endpoint exposure. |
| `managed-app-foundation-review` | Revisiting implementation plans to compare low-cost, free, managed, or owner-hosted foundations before custom-building auth, backend APIs, user accounts, databases, workflow automation, CRM/contact pipelines, forms, email, storage, analytics, ops, traffic/security monitoring, or account-security foundations. |
| `github-program-reconciler` | Any session may dry-run reconcile and report at significant events where `.github/toolkit-programme.json` exists; only the appointed controller writes programme state (it holds the parent document); an executor it assigns writes only its own checkpoint journal, and helpers dry-run and report. The reconciler, its state documents, managed blocks and sub-issue links require the binding; every `programme.cjs` command refuses without it. Toolkit-governed rules and their issue records are not changed by the binding. Repositories without the `TOOLKIT-GOVERNED-RULES` block get no governed issue writes, only coding-governance gates, subagents and portable skills; global rules still apply, including PRs after requested edits and task issues when the user asks to add one. The separate decision-trace audit is read-only; never mutates reviews, marks Ready, closes, deletes or merges. |
| `controller-bootstrap` | Explicitly bootstrap or recover the already-assigned controller for one Toolkit-managed repository after context loss, handover, or an agreed bootstrap event; bind the independently accepted live Toolkit snapshot for `repo/CONTROLLER.md`, `repo/ARCHITECTURE.md`, and the version-bound registry (the current v3 registry, or the immutable v2 registry for historical admissions). Ordinary executor work, generic repository setup, and GitHub programme reconciliation are excluded. |
| `release-readiness-audit` | Guarded final, completion, production-readiness, release-candidate, launch-readiness, QA, security-readiness, or `/goal` audit. Only lightweight preflight is allowed before explicit confirmation. |
| `codex-ssh-hostinger-coolify-setup-maintainer` | Codex SSH Hostinger VPS plus Coolify deployment setup, SSH preflight, daily security checks, intrusion-signal review, optional Telegram/email maintenance alerts, evidence-based maintenance, and incident response with owner approval gates. Use when the user asks Codex to help set up Hostinger for deployment, configure daily maintenance alerts, or review Hostinger/Coolify security signals. |
| `external-operation-preflight` | Any live change on an outside system (hosting provider, deployment platform, database, bucket, DNS or SaaS service): binding exact targets to one environment, checking resource identity, authority and downstream effects such as a merge that auto-deploys, temporary or restore resources, route fallbacks, and the backup and restore evidence contract. Running the change itself, n8n live work and local-only work are excluded. |
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
