# AI Agent Toolkit

AI Agent Toolkit is a canonical repo for reusable AI-agent assets: source project modules, skills, guides, templates, installer packs, registries, optional tools, and MCP design documents.

It is not a product repo. Product repos stay separate and consume generated packs, templates, and skills from this toolkit.

## What Belongs Here

- Reusable AI skills in `skills/`.
- Source-of-truth project modules in `_projects/`.
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
| [_projects/](_projects/) | Source-of-truth project modules with preserved `_main/` files. |
| [skills/](skills/) | Portable instruction packs for AI agents. |
| [guides/](guides/) | Human-readable setup and workflow guides. |
| [templates/](templates/) | Copy-paste or installable template sources. |
| [packs/](packs/) | Manifest-based install bundles. |
| [tools/](tools/) | Optional local-only tooling. |
| [registry/](registry/) | JSON source of truth for discovery. |
| [mcp/](mcp/) | Future read-only registry MCP and approval-gated installer MCP specs. |
| [docs/](docs/) | Operating policy, project-module standards, safety, and migration documentation. |

## Project Modules

Project modules use this shape:

```text
_projects/<category>/<project-name>/
  README.md
  toolkit.project.json
  SOURCE-MANIFEST.md
  SOURCE-LOCK.json
  _main/
  curated_output_for_ai/  # optional
  _generated/            # optional
```

- `_main/` preserves actual project/source files and is the project source of truth.
- `curated_output_for_ai/` is optional and only for reviewed AI/toolkit-facing transformations.
- `_generated/` is optional preview output only and is not source of truth.
- Root `skills/`, `mcp/`, `templates/`, `packs/`, `tools/`, `registry/`, and `guides/` stay separate so consumers can find them quickly.

See [Project Module Standard](docs/PROJECT-MODULE-STANDARD.md) and [Write Safety Model](docs/WRITE-SAFETY-MODEL.md).

Current modules:

- [Local n8n Setup](_projects/n8n/local-setup/)
- [n8n Workflow Templates](_projects/n8n/workflow-templates/)
- [Secure CI/CD Installer](_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/)

## Skills

Current reusable skills include:

- [Secure UI/UX Frontend Design](skills/design/ui-ux-secure-frontend-design/)
- [Windows Localhost Workflows](skills/development/windows-localhost-workflows/)
- [n8n Workflow Sync](skills/automation/n8n-workflow-sync/)
- [n8n Local Setup](skills/automation/n8n-local-setup/)
- [Secure CI/CD Installer](skills/cicd/secure-cicd-installer/)
- [Knowledge Index Updater](skills/portfolio/knowledge-index-updater/)

Each skill has a `SKILL.md` entrypoint and a `README.md`. Root skills are published toolkit surfaces. Some are directly maintained and declared as `linked` outputs in the related `toolkit.project.json`; deterministic scripts only publish generated outputs declared in project manifests.

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

Project modules are source-of-truth inputs. Current source-watch automation is advisory and read-only: it renders active update candidates and archived migration sources from SOURCE-LOCK metadata, but it does not fetch upstream commits, copy files, update locks, create branches, or create PRs.

Future safe source updates should start in `_projects/**/_main/`, then declared recipes or linked root surfaces are reviewed through the sync/check workflow. Retired internal migration repos are provenance-only and are not active watch targets. AI may draft root skills, MCP docs, or curated output, but deterministic scripts publish and check declared outputs. ChatGPT scheduled review is advisory only.

## Start Here

- [How To Use](docs/HOW-TO-USE.md)
- [Project Module Standard](docs/PROJECT-MODULE-STANDARD.md)
- [Write Safety Model](docs/WRITE-SAFETY-MODEL.md)
- [Project Rehaul Checklist](docs/PROJECT-REHAUL-CHECKLIST.md)
- [For AI Agents](docs/FOR_AI_AGENTS.md)
- [Safe Updates](docs/SAFE-UPDATES.md)
- [Source Of Truth](docs/SOURCE-OF-TRUTH.md)
- [Migration Sources](docs/MIGRATION-SOURCES.md)
- [Cleanup Policy](docs/CLEANUP-POLICY.md)

## Validation

Run:

```powershell
node scripts/validate-toolkit.cjs
node scripts/sync-toolkit-projects.cjs --check
node scripts/audit-project-source-locks.cjs
node --test tests/*.test.cjs
node scripts/package-skills.cjs --check
node scripts/package-packs.cjs --check
python -m unittest discover -s tools/design-system-generator/tests
git diff --check
```
