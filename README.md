# AI Agent Toolkit

AI Agent Toolkit is a canonical repo for reusable AI-agent assets: skills, guides, templates, installer packs, registries, and MCP design documents.

It is not a product repo. Product repos stay separate and consume generated packs, templates, and skills from this toolkit.

## What Belongs Here

- Reusable AI skills in `skills/`.
- Agent setup guides in `guides/`.
- Copy-safe templates in `templates/`.
- Approval-gated install pack manifests in `packs/`.
- JSON discovery registries in `registry/`.
- Future MCP design specs in `mcp/`.
- Safety, migration, and source-of-truth docs in `docs/`.

## What Does Not Belong Here

- Product app code.
- Customer workflow JSON.
- Live n8n exports or imports.
- Credentials, credential bindings, private keys, `.env`, `.n8n-local/`, or `.tmp/`.
- Generated ZIP/TGZ/package outputs.
- Trading app code or business-specific configs.
- Automation that auto-commits, auto-merges, or silently applies upstream updates.

## How The Repo Is Organized

| Area | Purpose |
| --- | --- |
| `skills/` | Portable instruction packs for AI agents. |
| `guides/` | Human-readable setup and workflow guides. |
| `templates/` | Copy-paste or installable template sources. |
| `packs/` | Manifest-based install bundles. |
| `registry/` | JSON source of truth for discovery. |
| `mcp/` | Future read-only registry MCP and approval-gated installer MCP specs. |
| `docs/` | Operating policy and migration documentation. |

## Skills

Current reusable skills include:

- `skills/design/ui-ux-secure-frontend-design/`
- `skills/development/windows-localhost-workflows/`
- `skills/automation/n8n-workflow-sync/`
- `skills/portfolio/knowledge-index-updater/`

Each skill has a `SKILL.md` entrypoint and a `README.md`. Optional `agents/openai.yaml`, `references/`, and `examples/` folders may be present.

## Guides, Templates, And Packs

- Use `guides/` when a human or AI agent needs setup instructions.
- Use `templates/` when a consumer repo needs reusable text, config, or helper-template sources.
- Use `packs/` when a future installer should preview an approval-gated bundle before writing anything.

## MCP Registry Direction

The registry MCP is future-facing and read-only. It will expose trusted registry metadata for discovery and routing. It will not run shell commands or write files.

The installer MCP is future-facing and approval-gated. It will install pack-defined files only after previewing changes. It will not auto-apply upstream updates or mutate product repos destructively.

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
