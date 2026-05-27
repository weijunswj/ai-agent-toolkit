# For AI Agents

This repo is organized for AI-agent reuse. Prefer local repo truth over assumptions.

## Taxonomy

| Term | Meaning |
| --- | --- |
| Skill | Portable instruction pack under `skills/`. |
| Guide | Setup or workflow documentation under `_projects/**/_main/`, skill `references/`, or `repo/docs/`. |
| Template | Copy-safe source material inside the relevant skill folder. |
| Pack | Approval-gated bundle manifest inside the relevant skill folder under `packs/`. |
| MCP registry data | JSON discovery metadata under `mcp/registry/`. |
| MCP | MCP-ready registry, design/spec docs, and metadata under `mcp/`; no runnable server is shipped today. |
| Toolkit project version | The `version` in `_projects/**/toolkit.project.json`; it versions the toolkit module/adaptation, not upstream source. |
| Source lock | `_projects/**/SOURCE-LOCK.json`; it records source provenance, source pins, blob pins, lifecycle, attribution, and source-watch policy. |

`version_policy` currently supports only `semver`. `version_notes` explains what the toolkit project version represents. Do not use Git tags, package tags, GitHub release tags, upstream versions, or per-file versions as substitutes for project module versions.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

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
| `n8n-agent-rules` | Any n8n task, including workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, workflow creation or updates, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, or n8n safety. |
| `n8n-local-setup` | Safe local n8n Docker Compose setup, Postgres/ngrok stack templates, MCP config selection, or platform-specific n8n agent-rule setup. |
| `n8n-workflow-helper-scripts` | Safe n8n workflow import/export hygiene, template sanitation, credential safety, validation, comparison, and repo/live sync planning. |
| `n8n-workflow-templates` | Public generic inactive n8n workflow JSON templates. |
| `secure-cicd-installer` | Secure CI/CD installer planning, GitHub Actions setup, CI security gates, approval-gated writes, or safe status tracking. |
| `context-preserving-ai-publisher` | Source-traceable AI-facing repo surfaces, generated skills, MCP notes, templates, manifests, source locks, audits, or anti-drift docs. |
| `windows-localhost-workflows` | Starting, relaunching, verifying, or debugging local Windows dev servers. |
| `knowledge-index-updater` | Maintaining a Notion/GitHub knowledge index with stable source keys, de-duplication, categorisation, and stale/missing item checks. |
| `ui-ux-secure-frontend-design` | Frontend design systems, landing pages, dashboards, forms, accessibility, responsive polish, privacy-safe UX, and implementation review. |

## Skill Routing Maintenance

- When adding, removing, renaming, or materially changing a skill under `skills/**`, update `_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md`.
- When adding, removing, renaming, or materially changing a project module that publishes a skill, update the routing table if that skill should be invokable by supported agents.
- When changing skill names, `SKILL.md` frontmatter, or descriptions, update the registry source that publishes `mcp/registry/skills.registry.json`, README skill tables when applicable, the routing partial, and generated AGENTS/CLAUDE/GEMINI equivalents.
- When a new skill should not be auto-routed, document why it is intentionally omitted from routing.
- Do not let the routing table become stale relative to current `skills/*/SKILL.md`.

## Install Safety

Do not install anything silently. Preview target writes, explain the source files, and preserve product repo ownership.

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

Do not run live n8n actions from this toolkit repo. In consumer repos, live n8n import/export requires explicit confirmation and must never run in CI.

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
