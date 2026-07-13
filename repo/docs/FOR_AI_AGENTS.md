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
| `n8n-local-setup` | Safe n8n environment setup with the localhost/ngrok dev stack, the separate production Cloudflare Tunnel self-hosting stack for local/CGNAT machines, hosted n8n Hostinger Coolify VPS notes, stack templates, [official n8n Skills](https://github.com/n8n-io/skills) setup, official instance-level MCP config selection, or platform-specific n8n agent-rule setup. |
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
- For OpenAI/Codex packaged metadata, keep implicit invocation sparse. The intentional implicit skills are `toolkit-setup`, `n8n-agent-rules`, and `agent-skill-supply-chain-audit`; broad, heavy, production-sensitive, or companion skills should be explicit-only unless a future safety-router review documents otherwise. Native plugin `interface.defaultPrompt` should stay at three or fewer strong starter prompts.

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

Routine `setup toolkit` and refresh operations are handled by the root agent alone. Do not spawn subagents to inspect instructions, docs, repository or host state, setup choices, or validation output.

Toolkit Local Bridge setup is infrastructure with one compact `toolkit-setup` discoverability skill, not a command-per-bridge skill family. Use [Toolkit Local Bridge](TOOLKIT-LOCAL-BRIDGE.md), the managed-checkout setup command below, and `node repo/scripts/toolkit-local-bridge.cjs` for audit, managed-main repo-backed Toolkit auto-update, opt-in OpenCode or AG2 setup, enabled-target sync, and disable operations. Use `node repo/scripts/repair-codex-plugin-windows-hooks.cjs` only for post-install Windows hook repair of a requested installed Codex plugin root. Keep bridge setup dry-run by default except for the explicit setup orchestrator, never autosetup detected targets, never install npm or pip packages, never mutate arbitrary project repos by default, and never rely on hooks as the only place where critical policy exists.

For `setup toolkit`, `refresh toolkit`, or plain `refresh` when the current task is clearly about Toolkit setup/update state, run the host-aware orchestrator from the managed checkout when that checkout exists. Windows Codex uses `node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main`; POSIX Codex uses `node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main`; Claude Code appends `--host claude-code` to the managed checkout command. Use `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main` from the active repo only as bootstrap/fallback when the managed checkout script is missing, and hand off to the managed checkout script after the managed checkout exists. If the managed script exists but exits with code `23` or reports that the setup question bank requires answers, this is an intentional pause for user input, not a setup failure; stop, present the question bank choices in chat when needed, and do not rerun with `--yes-recommended` unless the user explicitly requested recommended/default choices in the current turn. If the managed script exists but hits a real safety blocker, report that blocker instead of falling back to the active repo command. Script invariant: **Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.** The default managed checkout is `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit` on Windows and `~/.ai-agent-toolkit/source/ai-agent-toolkit` on POSIX. Setup discovers current state first, then shows one consolidated upfront question bank for the managed checkout path, repo-backed auto-update, host-native cache behavior, update report writes, report auto-open, report/log retention, and optional OpenCode or AG2 target sync. It must pause until every question is answered by interactive input, explicit flags, or explicitly user-requested `--yes-recommended`, then run without later preference pauses. Verification after managed setup must use the managed checkout verifier, not an active stale verifier. Codex verifies and refreshes only the Codex native Toolkit plugin cache with the managed checkout's `repo/scripts/setup-codex-toolkit-plugin.cjs`; Claude Code verifies `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json` while using Claude Code's own native plugin install/trust flow. Even when Toolkit is already installed, complete the full setup journey so stale pieces are detected and patched in order. Final setup reports should state the active worktree path/commit if inspected, managed checkout path/commit, exact setup script path executed, and whether the question bank appeared. If a stale installed `toolkit-setup` skill says to run the full `repo/tests/toolkit-local-bridge.test.cjs` suite during routine setup, override it with this repo-level rule: routine setup uses `repo/tests/toolkit-local-bridge-hook-light.test.cjs`; the full bridge suite is for bridge changes, PR review, or release validation.

On Codex, helper capacity remains explicit opt-in. One canonical question asks "How many helper agents may Codex use at the same time?" and drives displayed rows, prompts, piped input, flags, recommendations, plans, execution, and summaries. `keep`, empty input, and `--yes-recommended` never write or migrate; exact PR #237 legacy migration is a separate explicit choice with a full preview. Runtime detection uses Codex app-server `experimentalFeature/list`, accepts V1-only and V2-only hosts, and fails closed on malformed, duplicate, contradictory, or unusable responses. MultiAgentV2 independently tracks Toolkit ownership of feature enablement, helper capacity, root guidance, and helper guidance. Existing table enablement stays byte-preserved and user-owned; boolean enablement may migrate structurally while remaining user-owned; Toolkit-introduced enablement is removed with Toolkit capacity. RAM-safe V2 mode allows one helper with two total session threads because the root counts. Custom counts above one require separate RAM-risk approval. Removal requires an explicit warned choice because host defaults may restore higher capacity. Codex app-server `config/batchWrite`, Python `tomllib`, exact proposal-delta checks, atomic replacement, final snapshot checks, and generation-local backup metadata prevent ambiguous or concurrent writes. Restore commands use the verified absolute setup script and safely quote both paths. Ordinary work remains root-only by default with at most one directly justified helper. A user-invoked defined multi-worker workflow may use its stated plan only after explicit higher-capacity approval; workers remain direct root children with non-overlapping scopes, cannot spawn helpers, and the root retains final judgment. No native hard block for recursive helpers is claimed. No documented scan-scoped Codex Security capacity activation exists; Codex Security never raises normal capacity automatically, and setup never implies official Deep Scan can run under insufficient capacity. Claude Code and OpenCode receive portable single-agent policy only and report host-level enforcement as unsupported.

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

For active third-party projects, read `SOURCE-LOCK.json` before discussing upstream tracking. Scheduled source-watch checks must take upstream repo, source ref, locked commit, `source_update_policy`, attribution requirement, allowlisted files, and exact blob pins from the source lock. Retired internal source locks are historical provenance only and are not active update candidates. Advisory and host-harness capability drift lanes live in [repo/source-watch/](../source-watch/) and are review prompts only; do not copy upstream files, update pins, execute upstream code, update advisory status, delete toolkit components, or treat the notification PR as approval to change source.

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
