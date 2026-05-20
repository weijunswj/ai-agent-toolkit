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
| MCP | Future server design under `mcp/`. |

## Project Categories

- `cicd/`: CI/CD and GitHub Actions safety material.
- `design/`: UI/UX and frontend design material.
- `development/`: general development workflow helpers.
- `knowledge/`: knowledge-base and index-maintenance skills.
- `n8n/`: n8n setup, workflow helper scripts, and workflow templates.
- `repo-methodology/`: source-preserving repo publishing, generated-surface discipline, audit strategy, and anti-drift methodology.

## Task Routing

- Use `ui-ux-secure-frontend-design` for frontend design systems, landing pages, dashboards, forms, accessibility, responsive polish, privacy-safe UX, and implementation review.
- Use `windows-localhost-workflows` for starting, relaunching, verifying, or debugging local Windows dev servers.
- Use `n8n-workflow-helper-scripts` for safe n8n workflow import/export hygiene, template sanitation, credential safety, and repo/live sync planning.
- Use `n8n-workflow-templates` when the task is specifically about public generic inactive n8n workflow JSON templates.
- Use secure CI/CD materials when asked to plan or template GitHub Actions, CI security gates, or CI/CD installer prompts.

## Install Safety

Do not install anything silently. Preview target writes, explain the source files, and preserve product repo ownership.

Never commit or install:

- `.env` or `.env.*` except safe `.env.example`.
- Credential exports or credential bindings.
- Private keys.
- Product/customer workflow JSON.
- Generated package artifacts.

Scoped writes are allowed only when the relevant template or helper is being run intentionally:

- [Agent-rule generator](../scripts/build-agent-rule-templates.ps1) may regenerate only the source-side assembled templates under `_projects/n8n/local-setup/_main/templates/agent-rules/*.template.md`. Toolkit sync may then publish inert skill copies under `skills/n8n-local-setup/templates/agent-rules/*.template.md`.
- n8n sanitizer templates may write ignored `.to-sanitise/**` and `.sanitised/**` staging folders.
- n8n sync helper templates may write `n8n-workflows/*.json`, ignored `.tmp/**`, and ignored `.n8n-local/**` in a consumer repo after review.

## n8n Template Safety

Treat n8n workflow JSON as high risk. Prefer policy docs, sanitizer scripts, and helper templates. If a workflow JSON file is ever added, it must be generic, inactive, credential-free, and validated.

Do not run live n8n actions from this toolkit repo. In consumer repos, live n8n import/export requires explicit confirmation and must never run in CI.

## Product-Code Exclusion

Product repos own product code, product workflows, product config, and customer data. This toolkit owns reusable materials only.

## Handling Uncertainty

If historical source provenance needs review, use [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md). Do not claim provenance from a source that was not inspected.

## Validation Strategy

Prefer targeted validation while iterating. Before final reporting, run the required full validation suite. If full validation fails, inspect the failing area and rerun the narrow relevant command before retrying the full suite.

## Final Report Style

Report:

- Files changed.
- What changed.
- Source-by-source migration status.
- Validation commands and pass/fail results.
- Remaining risks or warnings.
- Confirmation that no commits, pushes, PRs, live n8n actions, credentials, product code, or generated package artifacts were added.
