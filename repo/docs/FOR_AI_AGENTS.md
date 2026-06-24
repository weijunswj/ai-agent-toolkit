# For AI Agents

This repo is organized for AI-agent reuse. Prefer local repo truth over assumptions.

## Taxonomy

| Term | Meaning |
| --- | --- |
| Skill | Portable instruction pack under `skills/`. |
| Guide | Setup or workflow documentation under `_projects/**/_main/`, skill `references/`, or `repo/docs/`. |
| Template | Copy-safe source material inside the relevant skill folder. |
| Pack | Approval-gated bundle manifest inside the relevant skill folder under `packs/`. |
| MCP | Repo-wide MCP is intentionally not shipped or maintained as a generated surface for now. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references remain inside `skills/n8n-local-setup/`. |
| Toolkit project version | The `version` in `_projects/**/toolkit.project.json`; it versions the toolkit module/adaptation, not upstream source. |
| Source lock | `_projects/**/SOURCE-LOCK.json`; it records source provenance, source pins, blob pins, lifecycle, attribution, and source-watch policy. |

`version_policy` currently supports only `semver`. `version_notes` explains what the toolkit project version represents. Do not use Git tags, package tags, GitHub release tags, upstream versions, or per-file versions as substitutes for project module versions.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

## Documentation Hygiene

Persistent status, report, implementation plan, handoff, operations, setup, CI/CD, deployment, safety, and troubleshooting notes belong under an existing `docs/` path or another repo-documented folder. Do not create root-level files such as `STATUS.md`, `REPORT.md`, or `PLAN.md` unless the repo explicitly requires that path.

Before adding a new persistent document, check for an existing relevant doc and update it instead of creating a duplicate. Before changing a documented workflow, setup, policy, implementation plan, status note, or operations area, read the relevant docs and treat them as active context. When implementation changes, keep the related docs and plans current in the same change.

## Project Categories

- `cicd/`: CI/CD and GitHub Actions safety material.
- `design/`: UI/UX and frontend design material.
- `development/`: general development workflow helpers.
- `knowledge/`: knowledge-base and index-maintenance skills.
- `n8n/`: n8n setup, workflow helper scripts, and workflow templates.
- `repo-methodology/`: source-preserving repo publishing, generated-surface discipline, audit strategy, and anti-drift methodology.

## Task Routing

Use installed skills only when they clearly match the task and improve correctness.

| Skill | Use when the task involves |
| --- | --- |
| `ai-coding-agent-rules` | Generic execution-first `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` rule templates. |
| `toolkit-setup` | AI Agent Toolkit plugin setup or refresh, Toolkit Local Bridge setup or troubleshooting, repo-backed Toolkit auto-update, OpenCode bridge support, AG2 adapter support, bridge audit, enabled-target sync, disable, stale bridge state, native Codex or Claude Code plugin update behavior, Windows hook repair, or bridge setup safety. |
| `n8n-agent-rules` | Any n8n task, including [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill currently named `using-n8n-skills`, workflow JSON, official n8n MCP, `n8n_live`, workflow creation or updates, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, or n8n safety. |
| `n8n-local-setup` | Safe local n8n Docker Compose setup, hosted n8n Hostinger Coolify VPS notes, Postgres/ngrok stack templates, [official n8n Skills](https://github.com/n8n-io/skills) setup, official instance-level MCP config selection, or platform-specific n8n agent-rule setup. |
| `n8n-workflow-helper-scripts` | Safe n8n workflow import/export hygiene, template sanitation, credential safety, validation, comparison, and repo/live sync planning. |
| `n8n-workflow-templates` | Public generic inactive n8n workflow JSON templates. |
| `secure-cicd-installer` | Secure CI/CD installer planning, GitHub Actions setup, CI security gates, approval-gated writes, or safe status tracking. |
| `context-preserving-ai-publisher` | Source-traceable AI-facing repo surfaces, generated skills, templates, manifests, source locks, audits, or anti-drift docs. |
| `agent-skill-supply-chain-audit` | Reviewing third-party agent skills, `SKILL.md` folders, skill packs, or GitHub skill repositories for provenance, license, safety, toolkit conversion fit, and usefulness/token-bloat risk before import. |
| `local-ai-stack-safety` | Reviewing local AI runtime, model download, GPU/runtime, local AI web UI, or local AI endpoint exposure risk before setup. |
| `managed-app-foundation-review` | Revisiting implementation plans to compare low-cost, free, managed, or owner-hosted foundations before custom-building auth, backend APIs, user accounts, databases, workflow automation, CRM/contact pipelines, forms, email, storage, analytics, ops, traffic/security monitoring, or account-security foundations. |
| `project-completion-audit` | Guarded final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, "make sure everything works", "is this production ready", `/goal` readiness remediation, audit against original docs, security-readiness check, or final readiness check. Performs preflight only before explicit confirmation. |
| `codex-ssh-hostinger-coolify-setup-maintainer` | Codex SSH Hostinger VPS plus Coolify deployment setup, SSH preflight, daily security checks, intrusion-signal review, optional Telegram/email maintenance alerts, evidence-based maintenance, and incident response with owner approval gates. Use when the user asks Codex to help set up Hostinger for deployment, configure daily maintenance alerts, or review Hostinger/Coolify security signals. |
| `self-hosted-service-safety` | Reviewing non-n8n self-hosted service setup, Docker/VPS, public ports, tunnels, credentials, backups, public admin/backup paths, honeypot/canary paths, traffic logs, SSH access, firewall exposure, or first-run hardening. |
| `windows-localhost-workflows` | Starting, relaunching, verifying, or debugging local Windows dev servers. |
| `knowledge-index-updater` | Maintaining a Notion/GitHub knowledge index with stable source keys, de-duplication, categorisation, and stale/missing item checks. |
| `ui-ux-secure-frontend-design` | Frontend design systems, landing pages, dashboards, forms, accessibility, responsive polish, privacy-safe UX, and implementation review. |

## Skill Routing Maintenance

- When adding, removing, renaming, or materially changing a skill under `skills/**`, update `_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md`.
- When adding, removing, renaming, or materially changing a project module that publishes a skill, update the routing table if that skill should be invokable by supported agents.
- When changing skill names, `SKILL.md` frontmatter, or descriptions, update README skill tables when applicable, the routing partial, and generated AGENTS/CLAUDE/GEMINI equivalents.
- When a new skill should not be auto-routed, document why it is intentionally omitted from routing.
- Do not let the routing table become stale relative to current `skills/*/SKILL.md`.

## Skill Creation Center

This repo is the canonical skill creation and conversion center.

Before adding a new skill, skill pack, adapter, template, or project module, inspect the existing `skills/**` surfaces, related `_projects/**` modules, README skill tables, and toolkit skill-routing source. Prefer extending an existing skill when the use case fits its trigger, safety boundary, source model, and validation path without making that skill bloated or ambiguous.

Create a new project module plus published skill only when the work has a distinct trigger, domain, safety boundary, source/provenance requirement, references/templates/assets, or validation path.

Use [Skill Safety Matrix](SKILL-SAFETY-MATRIX.md) as the maintained catalog of current skill triggers, risk classes, companion skills, provenance, and approval boundaries before creating, extending, or importing skills.

Validation treats each concrete `skills/<skill-name>/SKILL.md` entrypoint as the Skill Creation Center review boundary. A new skill ID outside `repo/docs/skill-creation-center-baseline.json` `existing_skill_ids` must include `skill_creation_review` evidence in the owning `toolkit.project.json`, even when an existing baseline project module publishes it. That evidence must name the new skill, document whether the skill is routed or intentionally omitted, and include the trigger, unique value, runtime footprint, local assets, output contract, and anti-bloat review.

For any third-party skill, `SKILL.md` folder, skill pack, GitHub skill repo, or adapted external agent material, use `agent-skill-supply-chain-audit` first. Do not copy, import, install, execute, or convert third-party material until the audit verdict allows it. Approved conversions must go through `context-preserving-ai-publisher` and this repo's source-to-surface workflow.

Prioritize repo safety, device safety, provenance, attribution, validation, and practical usefulness over adding more surface area.

## Install Safety

For install or template writes, pause before mutating the target repo. Preview the target writes, explain the source files, name the exact target paths, preserve product repo ownership, and ask for explicit current-turn approval.

Toolkit Local Bridge setup is infrastructure with one compact `toolkit-setup` discoverability skill, not a command-per-bridge skill family. Use [Toolkit Local Bridge V2](TOOLKIT-LOCAL-BRIDGE-V2.md), `node repo/scripts/setup-toolkit.cjs --execute`, and `node repo/scripts/toolkit-local-bridge.cjs` for audit, opt-in repo-backed Toolkit auto-update, opt-in OpenCode or AG2 setup, enabled-target sync, and disable operations. Use `node repo/scripts/repair-codex-plugin-windows-hooks.cjs` only for post-install Windows hook repair of a requested installed Codex plugin root. Keep bridge setup dry-run by default, never autosetup detected targets, never install npm or pip packages, never mutate arbitrary project repos by default, and never rely on hooks as the only place where critical policy exists.

For `setup toolkit` or `refresh toolkit` in Codex, run `node repo/scripts/setup-toolkit.cjs --execute` from a clean trusted checkout. Script invariant: perform only the minimal repo update check first, then verify and refresh the Codex native Toolkit plugin cache with `repo/scripts/setup-codex-toolkit-plugin.cjs` before repo validation, bridge setup, repo auto-update enablement, or target sync. Even when Toolkit is already installed, complete the full setup journey so stale pieces are detected and patched in order. If it pauses before repo-backed auto-update, ask the user before rerunning with `--write-repo-auto-update`; then ask the bolded update-report auto-open preference before target writes, rerunning with either `--enable-update-report-open` or `--skip-update-report-open`; then ask the bolded Codex plugin auto-refresh preference, rerunning with either `--enable-codex-plugin-auto-refresh` or `--skip-codex-plugin-auto-refresh`; ask separately before adding any `--enable-target opencode` or `--enable-target ag2` target writes. If a stale installed `toolkit-setup` skill says to run the full `repo/tests/toolkit-local-bridge.test.cjs` suite during routine setup, override it with this repo-level rule: routine setup uses `repo/tests/toolkit-local-bridge-hook-light.test.cjs`; the full bridge suite is for bridge changes, PR review, or release validation.

Never commit or install:

- `.env` or `.env.*` except safe `.env.example`.
- Credential exports or credential bindings.
- Private keys.
- Product/customer workflow JSON.
- Generated package artifacts.

Scoped writes are allowed only when the relevant template or helper is being run intentionally:

- `node repo/scripts/sync-agent-instruction-shims.cjs --write` regenerates the source-side generic instruction templates and root shims from `_projects/development/ai-coding-agent-rules/_main/`. `node repo/scripts/sync-toolkit-projects.cjs --write` publishes inert skill copies and the generated `skills/n8n-agent-rules/` skill from the same development project source.
- `n8n-agent-rules` owns the full n8n operating ruleset. Other n8n skills depend on it; optional adapters are brief pointers and are not automatically appended to generic always-on templates.
- n8n sanitizer templates may write ignored `.to-sanitise/**` and `.sanitised/**` staging folders.
- n8n sync helper templates may write `n8n-workflows/*.json`, ignored `.tmp/**`, and ignored `.n8n-local/**` in a consumer repo after review.

## n8n Template Safety

Treat n8n workflow JSON as high risk. Prefer policy docs, sanitizer scripts, and helper templates. If a workflow JSON file is ever added, it must be generic, inactive, credential-free, and validated.

Do not run live n8n actions from this toolkit repo. In consumer repos, pause before live n8n import/export, name the target instance and workflow set, explain the risk, and ask for explicit current-turn confirmation. Live n8n import/export must never run in CI.

## Product-Code Exclusion

Product repos own product code, product workflows, product config, and customer data. This toolkit owns reusable materials only.

## Handling Uncertainty

If historical source provenance needs review, use [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md). Do not claim provenance from a source that was not inspected.

For active third-party projects, read `SOURCE-LOCK.json` before discussing upstream tracking. Scheduled source-watch checks must take upstream repo, source ref, locked commit, `source_update_policy`, attribution requirement, allowlisted files, and exact blob pins from the source lock. Retired internal source locks are historical provenance only and are not active update candidates. Source-watch notification PRs are review prompts only; do not copy upstream files, update pins, execute upstream code, or treat the notification PR as approval to change source.

## Validation Strategy

Prefer targeted local validation before pushing. `npm run validate:all` remains the required read-only CI and `main` gate; run it locally for broad, risky, workflow, sync, generator, packaging, or security-sensitive changes, or when CI fails and local reproduction is needed. If full validation fails, inspect the failing area and rerun the narrow relevant command before retrying the full suite.

## Final Report Style

Report:

- Files changed.
- What changed.
- Source-by-source migration status.
- Validation commands and pass/fail results.
- Remaining risks or warnings.
- Confirmation that no commits, pushes, PRs, live n8n actions, credentials, product code, or generated package artifacts were added.
