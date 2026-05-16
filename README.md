# AI Agent Toolkit

AI Agent Toolkit is a canonical repo for reusable AI-agent assets: skills, guides, templates, installer packs, registries, and MCP design documents.

It is not a product repo. Product repos stay separate and consume generated packs, templates, and skills from this toolkit.

## What Belongs Here

- Reusable AI skills in `skills/`.
- Agent setup guides in `guides/`.
- Copy-safe templates in `templates/`.
- Approval-gated install pack manifests in `packs/`.
- Optional local-only tools in `tools/`.
- JSON discovery registries in `registry/`.
- Future MCP design specs in `mcp/`.
- Safety, migration, and source-of-truth docs in `docs/`.

## What Does Not Belong Here

- Product app code.
- Customer workflow JSON.
- Live n8n exports or imports.
- Credentials, private keys, `.env`, committed `.n8n-local/`, committed `.tmp/`, or committed local staging folders.
- Generated ZIP/TGZ/package outputs.
- Trading app code or business-specific configs.
- Automation that auto-merges, silently applies upstream updates, or commits outside tightly scoped generated-template outputs.

## How The Repo Is Organized

| Area | Purpose |
| --- | --- |
| [skills/](skills/) | Portable instruction packs for AI agents. |
| [guides/](guides/) | Human-readable setup and workflow guides. |
| [templates/](templates/) | Copy-paste or installable template sources. |
| [packs/](packs/) | Manifest-based install bundles. |
| [tools/](tools/) | Optional local-only tooling. |
| [registry/](registry/) | JSON source of truth for discovery. |
| [mcp/](mcp/) | Future read-only registry MCP and approval-gated installer MCP specs. |
| [docs/](docs/) | Operating policy and migration documentation. |

## Skills

Current reusable skills include:

- [Secure UI/UX Frontend Design](skills/design/ui-ux-secure-frontend-design/)
- [Windows Localhost Workflows](skills/development/windows-localhost-workflows/)
- [n8n Workflow Sync](skills/automation/n8n-workflow-sync/)
- [Knowledge Index Updater](skills/portfolio/knowledge-index-updater/)

Each skill has a `SKILL.md` entrypoint and a `README.md`. Optional `agents/openai.yaml`, `references/`, and `examples/` folders may be present.

## Guides, Templates, And Packs

- Use `guides/` when a human or AI agent needs setup instructions.
- Use `templates/` when a consumer repo needs reusable text, config, or helper-template sources.
- Use `packs/` when a future installer should preview an approval-gated bundle before writing anything.

Some template assets intentionally write scoped outputs when run in a reviewed context. The agent-rule generator writes only [AGENTS.md](templates/agent-rules/AGENTS.md), [CLAUDE.md](templates/agent-rules/CLAUDE.md), and [GEMINI.md](templates/agent-rules/GEMINI.md). n8n helper templates may write `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, and sanitizer staging folders when copied into a consumer repo and run manually.

## Optional Tools

- [Design System Generator](tools/design-system-generator/) searches local CSV data only and stays outside instruction-only skills.

## MCP Registry Direction

The registry MCP is future-facing and read-only. It will expose trusted registry metadata for discovery and routing. It will not run shell commands or write files.

The installer MCP is future-facing and approval-gated. It is design-only until an actual MCP server is implemented. It will install pack-defined files only after previewing changes. It will not auto-apply upstream updates or mutate product repos destructively.

## Safe Source Updates

Source repos are migration and update inputs, not runtime dependencies. Safe source updates start with deterministic detection and quarantine comparison, then classify changes as safe, manual, or blocked. AI review is advisory only, and ChatGPT web review is manual paste-in review only.

## Start Here

- [How To Use](docs/HOW-TO-USE.md)
- [For AI Agents](docs/FOR_AI_AGENTS.md)
- [Safe Updates](docs/SAFE-UPDATES.md)
- [Source Of Truth](docs/SOURCE-OF-TRUTH.md)
- [Migration Sources](docs/MIGRATION-SOURCES.md)
- [Cleanup Policy](docs/CLEANUP-POLICY.md)

## Validation

Run:

```powershell
node scripts/validate-toolkit.cjs
node --test tests/*.test.cjs
node scripts/package-skills.cjs --check
node scripts/package-packs.cjs --check
```
