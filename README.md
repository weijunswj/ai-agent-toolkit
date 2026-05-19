# AI Agent Toolkit

A practical toolkit of AI-agent skills, MCP specs/tools, and preserved project guides.

## What this repo is

This repo keeps reusable AI-agent material in a layout that is easy to navigate:

- Need the full guide? Go to `_projects/**/_main/`.
- Need to install a skill? Copy the whole folder under [`skills/`](skills/) as `skills/<skill-name>/`.
- Need MCP? Go to [`mcp/`](mcp/) for status, specs, registries, and command/tool notes.
- Need to maintain the toolkit? Use [`repo/`](repo/).

## Quick Start

### I need the full guide

Open `_projects/<category>/<project>/_main/`.

### I want to install a Skill

Open `skills/<skill-name>/` and copy the whole folder into your agent's skills directory.

Keep the folder intact so `SKILL.md`, references, templates, examples, helper files, and metadata stay together. Do not copy only `SKILL.md`.

### I want MCP

Open [`mcp/`](mcp/) to see available MCP areas, commands/tools, status, and usage notes.

### I want to maintain this toolkit

Use [`repo/`](repo/) for scripts, tests, docs, validation, and CI support.

## Projects

| Project | What it does | Full guide | Surface | Skill | MCP |
|---|---|---|---|---|---|
| Local n8n Setup | Local n8n setup, MCP config, tunneling, and agent-rule templates. | [`_projects/n8n/local-setup/_main/`](_projects/n8n/local-setup/_main/) | both | [`skills/n8n-local-setup/`](skills/n8n-local-setup/) | [`mcp/projects/n8n-local-setup.md`](mcp/projects/n8n-local-setup.md) |
| n8n Workflow Toolkit | Credential-safe helper scripts and public generic workflow templates with separate skill boundaries. | [`_projects/n8n/workflow-toolkit/_main/`](_projects/n8n/workflow-toolkit/_main/) | both | [`skills/n8n-workflow-helper-scripts/`](skills/n8n-workflow-helper-scripts/) | [`mcp/projects/n8n-workflow-toolkit.md`](mcp/projects/n8n-workflow-toolkit.md) |
| Secure CI/CD Installer | Approval-gated CI/CD setup, GitHub Actions safety, and status templates. | [`_projects/cicd/secure-installer/_main/`](_projects/cicd/secure-installer/_main/) | both | [`skills/secure-cicd-installer/`](skills/secure-cicd-installer/) | [`mcp/projects/secure-cicd-installer.md`](mcp/projects/secure-cicd-installer.md) |
| UI/UX Pro Max Design | Third-party-attributed UI/UX design source, local generator data, and frontend design guidance. | [`_projects/design/ui-ux-pro-max/_main/`](_projects/design/ui-ux-pro-max/_main/) | both | [`skills/ui-ux-secure-frontend-design/`](skills/ui-ux-secure-frontend-design/) | [`mcp/projects/ui-ux-pro-max.md`](mcp/projects/ui-ux-pro-max.md) |

## Skills

Skills are copyable folder packages for AI agents. To install one, copy the whole folder under [`skills/`](skills/); do not cherry-pick only `SKILL.md`.

Required runtime context should live inside the skill folder in local files such as `references/`, `examples/`, `templates/`, `tools/`, or `packs/`. External links are for provenance or further reading, not required runtime context.

| Skill | What it helps with | Folder |
|---|---|---|
| n8n Local Setup | Safe local n8n setup, MCP config selection, tunnels, and platform agent rules. | [`skills/n8n-local-setup/`](skills/n8n-local-setup/) |
| n8n Workflow Helper Scripts | Safe workflow import/export planning, sanitation, credential safety, validation, compare, prepare, and sync helpers. | [`skills/n8n-workflow-helper-scripts/`](skills/n8n-workflow-helper-scripts/) |
| n8n Workflow Templates | Public generic inactive n8n workflow JSON templates. | [`skills/n8n-workflow-templates/`](skills/n8n-workflow-templates/) |
| Secure CI/CD Installer | Secure CI/CD planning, approval-gated templates, and status tracking. | [`skills/secure-cicd-installer/`](skills/secure-cicd-installer/) |
| Context-Preserving AI Publisher | Bootstrap or maintain manifest-driven AI-facing repo surfaces without context drift. | [`skills/context-preserving-ai-publisher/`](skills/context-preserving-ai-publisher/) |
| Secure UI/UX Frontend Design | Frontend design, review, accessibility, responsiveness, privacy, and security guardrails. | [`skills/ui-ux-secure-frontend-design/`](skills/ui-ux-secure-frontend-design/) |
| Windows Localhost Workflows | Start, verify, and troubleshoot localhost development services on Windows. | [`skills/windows-localhost-workflows/`](skills/windows-localhost-workflows/) |
| Knowledge Index Updater | Maintain a Notion/GitHub knowledge index without duplicate rows. | [`skills/knowledge-index-updater/`](skills/knowledge-index-updater/) |

## MCP

The MCP surface is design/spec-only today. No runnable MCP server is shipped in this repo yet.

| MCP area | Status | Provides |
|---|---|---|
| [`mcp/registry-mcp/`](mcp/registry-mcp/) | Design/spec-only | Future read-only discovery and routing over JSON registries. |
| [`mcp/installer-mcp/`](mcp/installer-mcp/) | Design/spec-only | Future approval-gated installer flow for skill-local pack manifests. |
| [`mcp/projects/`](mcp/projects/) | Published specs | Project-specific MCP notes and safety boundaries. |
| [`mcp/registry/`](mcp/registry/) | Data only | JSON discovery metadata for future MCP/installer use. |
| [`mcp/references/`](mcp/references/) | Reference docs | MCP setup, registry, installer, and security notes. |

No MCP commands are runnable from this repo today. The specs describe future tools only:

| Command/tool | What it does | Inputs | Output |
|---|---|---|---|
| `list_skills` | Future registry lookup for available skills. | none or small JSON filter | Skill IDs, titles, paths, and summaries. |
| `search_skills` | Future skill search. | query string | Matching skills and routing notes. |
| `list_templates` | Future listing of skill-local templates. | optional category | Template IDs, titles, and paths. |
| `list_packs` | Future listing of skill-local pack manifests. | optional category | Pack IDs, titles, and risk notes. |
| `route_task` | Future task-to-surface routing. | task description | Suggested skill/MCP/project surfaces. |
| `get_skill_context` | Future local skill context retrieval. | skill ID | Local skill file paths and context notes. |
| `get_install_plan` | Future pack preview. | pack ID | Write preview requiring approval before any mutation. |

## Folder Map

| Path | Use it when |
|---|---|
| [`_projects/`](_projects/) | You want full preserved project guides/source material. |
| [`skills/`](skills/) | You want copyable agent skills. |
| [`mcp/`](mcp/) | You want MCP specs/tools/commands. |
| [`repo/`](repo/) | You are maintaining this toolkit. |

## For Maintainers

Edit source first, then publish:

1. Update `_projects/**/_main/` only when preserved source must change.
2. Update `_projects/**/curated_output_for_ai/` for reviewed AI-facing source.
3. Update `_projects/**/toolkit.project.json` when routing or surface metadata changes.
4. Run [`repo/scripts/sync-toolkit-projects.cjs`](repo/scripts/sync-toolkit-projects.cjs) with `--write`.

Do not edit generated [`skills/`](skills/) or [`mcp/`](mcp/) outputs directly unless the output is explicitly declared as `linked`.

For project module rules, follow [`repo/docs/PROJECT-MODULE-STANDARD.md`](repo/docs/PROJECT-MODULE-STANDARD.md).

## Validation

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/audit-skill-portability.cjs
npm run validate:all
git diff --check
```

## Appendix: Source-of-Truth Contract

<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->
## Source-of-Truth Contract

This repo has a source layer and a published layer.

- `_projects/**/_main/` preserves full source material and original docs. Do not casually rewrite preserved source.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source material. Curated files may be AI-assisted, but they are source files and must be reviewed before publishing.
- `_projects/**/toolkit.project.json` is the routing contract. It declares which `_main/` or `curated_output_for_ai/` files publish to `skills/` and `mcp/` outputs.
- `skills/` contains copyable AI-agent skill folders. The whole skill folder is the install unit.
- `mcp/` contains MCP specs, command/tool notes, registries, and status documentation.
- Generated `skills/` and `mcp/` files must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved generated/synced outputs in `README.md`, `AGENTS.md`, `skills/**`, and `mcp/**`. It must not update source files, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync must not run full repo validation against raw PR heads; this avoids blocking otherwise valid behind-main PR branches.
- Auto-sync static checks are limited to generated-surface freshness checks and git diff checks before committing generated output.
- Auto-sync may run only deterministic sync/check/validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- If a PR mixes eligible source/routing/contract edits with forbidden workflow, maintenance-script, test, docs, package, lockfile, or preserved-source paths, auto-sync must fail instead of pushing.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
- A generated/public surface must not replace a full working document with a lossy summary. Summaries are allowed only for catalogues, descriptions, navigation tables, or clearly marked overview files.
- Required runtime context for a skill or MCP surface must be local, complete enough to use, and traceable to the project source. External links may support provenance or further reading, but must not be required for normal execution.
<!-- END SOURCE-OF-TRUTH-CONTRACT -->
