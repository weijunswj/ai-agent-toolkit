# For AI Agents

This repo is organized for AI-agent reuse. Prefer local repo truth over assumptions.

## Taxonomy

| Term | Meaning |
| --- | --- |
| Skill | Portable instruction pack under `for_ai/skills/`. |
| Guide | Setup or workflow documentation under `for_ai/playbooks/` or `repo/docs/`. |
| Template | Copy-safe source material under `for_ai/templates/`. |
| Pack | Approval-gated bundle manifest under `for_ai/packs/`. |
| Registry | JSON discovery metadata under `for_ai/registry/`. |
| MCP | Future server design under `for_ai/mcp/`. |

## Task Routing

- Use `ui-ux-secure-frontend-design` for frontend design systems, landing pages, dashboards, forms, accessibility, responsive polish, privacy-safe UX, and implementation review.
- Use `windows-localhost-workflows` for starting, relaunching, verifying, or debugging local Windows dev servers.
- Use `n8n-workflow-sync` for safe n8n workflow import/export hygiene, template sanitation, credential safety, and repo/live sync planning.
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

- [Agent-rule generator](../scripts/build-agent-rule-templates.ps1) may regenerate only [AGENTS.md](../../for_ai/templates/agent-rules/AGENTS.md), [CLAUDE.md](../../for_ai/templates/agent-rules/CLAUDE.md), and [GEMINI.md](../../for_ai/templates/agent-rules/GEMINI.md).
- n8n sanitizer templates may write ignored `.to-sanitise/**` and `.sanitised/**` staging folders.
- n8n sync helper templates may write `n8n-workflows/*.json`, ignored `.tmp/**`, and ignored `.n8n-local/**` in a consumer repo after review.

## n8n Template Safety

Treat n8n workflow JSON as high risk. Prefer policy docs, sanitizer scripts, and helper templates. If a workflow JSON file is ever added, it must be generic, inactive, credential-free, and validated.

Do not run live n8n actions from this toolkit repo. In consumer repos, live n8n import/export requires explicit confirmation and must never run in CI.

## Product-Code Exclusion

Product repos own product code, product workflows, product config, and customer data. This toolkit owns reusable materials only.

## Handling Uncertainty

If a migration source is inaccessible during a temporary audit, document it in [Migration Sources](MIGRATION-SOURCES.md). Do not claim migration from a source that was not inspected.

## Final Report Style

Report:

- Files changed.
- What changed.
- Source-by-source migration status.
- Validation commands and pass/fail results.
- Remaining risks or warnings.
- Confirmation that no commits, pushes, PRs, live n8n actions, credentials, product code, or generated package artifacts were added.
