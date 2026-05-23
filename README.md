# AI Agent Toolkit

A practical toolkit of reusable AI-agent skills, preserved source projects, and MCP-ready registry/design/spec metadata.

## What this repo is

This repo keeps reusable AI-agent material in a source-first layout. Full source stays under `_projects/`, copyable agent skills publish under `skills/`, MCP-ready registry, design/spec docs, and metadata live under `mcp/`, and repo maintenance lives under `repo/`.

## Pick What You Need

- If you want the full original guide or source context, open `_projects/<category>/<project>/_main/`.
- If you want something an AI agent can copy and use, open [`skills/<skill-name>/`](skills/).
- If you want MCP-ready registry/design/spec information for future MCP usage, open [`mcp/`](mcp/).
- If you are maintaining this repo, open [`repo/`](repo/) for docs, scripts, tests, and validation.

## Quick Start

| What you want| How to get it |
|---|---|
| Full guide | Open `_projects/<category>/<project>/_main/`. |
| Install a skill | Copy the whole `skills/<skill-name>/` folder into your agent's skills directory. |
| MCP-ready registry material | Open [`mcp/`](mcp/) for current status, design/spec docs, registries, and notes. |
| Maintenance work | Start with [`repo/docs/`](repo/docs/) and the validation commands below. |

## Terms

| Term | What it means |
|---|---|
| Project | The source/provenance area where the real material is maintained.
| Skill | A copyable AI-agent folder with instructions, references, templates, metadata, and helper files.
| MCP | MCP-ready registry, design/spec docs, and metadata for future MCP usage. No runnable server is shipped today.
| Generated surface | A published file under [`skills/`](skills/) or [`mcp/`](mcp/) that is rebuilt from project source by a deterministic sync script.

## Project Categories

- **[`cicd/`](_projects/cicd/):** CI/CD and GitHub Actions safety material.
- **[`design/`](_projects/design/):** UI/UX and frontend design material.
- **[`development/`](_projects/development/):** General development workflow helpers.
- **[`knowledge/`](_projects/knowledge/):** Knowledge-base and index-maintenance skills.
- **[`n8n/`](_projects/n8n/) =** n8n setup, workflow helper scripts, and workflow templates.
- **[`repo-methodology/`](_projects/repo-methodology/) =** How this toolkit preserves source truth, generates skills/MCP surfaces, and prevents context drift.

## Projects

Open a project when you need the maintained source behind a skill or MCP note.

| Project | What it is for | What it contains | Skills & MCP |
|---|---|---|---|
| [Local n8n Setup](_projects/n8n/local-setup/) | Helps an agent or human set up local n8n safely. | Full setup, upgrade, tunneling, platform, agent-rule, and MCP config source guides. | [`skills/n8n-local-setup/`](skills/n8n-local-setup/) and [`mcp/projects/n8n-local-setup.md`](mcp/projects/n8n-local-setup.md) |
| [n8n Workflow Toolkit](_projects/n8n/workflow-toolkit/) | Owns reusable n8n workflow helper material. | Safe helper scripts for sanitising, validating, exporting, importing, comparing, and preparing workflow JSON, plus public inactive workflow templates. | [`skills/n8n-workflow-helper-scripts/`](skills/n8n-workflow-helper-scripts/), [`skills/n8n-workflow-templates/`](skills/n8n-workflow-templates/), and [`mcp/projects/n8n-workflow-toolkit.md`](mcp/projects/n8n-workflow-toolkit.md) |
| [Secure CI/CD Installer](_projects/cicd/secure-installer/) | Helps plan CI/CD changes with approval gates and safety status tracking. | The full installer prompt, CI/CD status templates, GitHub Actions notes, and safety policy source. | [`skills/secure-cicd-installer/`](skills/secure-cicd-installer/) and [`mcp/projects/secure-cicd-installer.md`](mcp/projects/secure-cicd-installer.md) |
| [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/) | Provides frontend design guidance and a local design-system generator. | Third-party-attributed design source, local CSV data, generator scripts, and attribution notes. | [`skills/ui-ux-secure-frontend-design/`](skills/ui-ux-secure-frontend-design/) and [`mcp/projects/ui-ux-pro-max.md`](mcp/projects/ui-ux-pro-max.md) |
| [Context-Preserving AI Publisher](_projects/repo-methodology/context-preserving-ai-publisher/) | Helps maintain source-traceable skills, MCP notes, templates, manifests, and audit baselines. | Generic publishing methodology, source-to-surface decision rules, validation guidance, and starter templates. | [`skills/context-preserving-ai-publisher/`](skills/context-preserving-ai-publisher/) |
| [MCP-Ready Registry](_projects/repo-methodology/mcp-ready-registry/) | Owns the repo-level MCP-ready registry and future design/spec surface. | MCP-ready registry metadata, operator references, and future registry/installer MCP design docs. | [`mcp/`](mcp/) |
| [AI Coding Agent Rules](_projects/development/ai-coding-agent-rules/) | Provides generic execution-first AI coding agent rules. | Generic agent execution, toolkit skill-routing partials, and inert AGENTS/CLAUDE/GEMINI templates. | [`skills/ai-coding-agent-rules/`](skills/ai-coding-agent-rules/) |
| [Windows Localhost Workflows](_projects/development/windows-localhost-workflows/) | Helps an agent start and prove Windows localhost dev services are reachable. | The full standalone skill source for launch discovery, port checks, logs, background start, and HTTP verification. | [`skills/windows-localhost-workflows/`](skills/windows-localhost-workflows/) |
| [Knowledge Index Updater](_projects/knowledge/knowledge-index-updater/) | Helps maintain a Notion/GitHub knowledge index without duplicate rows. | The full standalone skill source for schema setup, source matching, duplicate handling, and daily updater behavior. | [`skills/knowledge-index-updater/`](skills/knowledge-index-updater/) |

## Skills

Skills are copyable folder packages for AI agents. To install one, copy the whole folder under [`skills/`](skills/); do not cherry-pick only `SKILL.md`.

Required runtime context should live inside the skill folder in local files such as `references/`, `examples/`, `templates/`, `tools/`, or `packs/`. External links are for provenance or further reading, not required runtime context.

| Skill | Use this when you want to... | Folder |
|---|---|---|
| AI Coding Agent Rules | Install generic execution-first agent rules for Codex/OpenCode, Claude Code, Gemini CLI, or Antigravity. | [`skills/ai-coding-agent-rules/`](skills/ai-coding-agent-rules/) |
| n8n Local Setup | Set up local n8n, choose MCP config, handle tunnels, or install platform-specific agent rules. | [`skills/n8n-local-setup/`](skills/n8n-local-setup/) |
| n8n Workflow Helper Scripts | Sanitise, validate, export, import, compare, prepare, or sync n8n workflow JSON safely. | [`skills/n8n-workflow-helper-scripts/`](skills/n8n-workflow-helper-scripts/) |
| n8n Workflow Templates | Start from a ready-to-review public inactive n8n workflow JSON template, such as the global error handler. | [`skills/n8n-workflow-templates/`](skills/n8n-workflow-templates/) |
| Secure CI/CD Installer | Plan CI/CD setup with approval gates, safe GitHub Actions notes, and status templates. | [`skills/secure-cicd-installer/`](skills/secure-cicd-installer/) |
| Context-Preserving AI Publisher | Turn source docs into skills, MCP notes, templates, or manifests without losing detail or creating drift. | [`skills/context-preserving-ai-publisher/`](skills/context-preserving-ai-publisher/) |
| Secure UI/UX Frontend Design | Design or review frontend work for accessibility, responsive polish, privacy, and security guardrails. | [`skills/ui-ux-secure-frontend-design/`](skills/ui-ux-secure-frontend-design/) |
| Windows Localhost Workflows | Start and verify a Windows localhost dev server instead of guessing commands or retrying failures. | [`skills/windows-localhost-workflows/`](skills/windows-localhost-workflows/) |
| Knowledge Index Updater | Maintain a Notion/GitHub knowledge index with stable keys, clickable source links, and no duplicate rows. | [`skills/knowledge-index-updater/`](skills/knowledge-index-updater/) |

## MCP

The MCP area is currently MCP-ready registry, design/spec docs, and metadata. It does not ship a runnable MCP server, package, CLI, or executable MCP tools today.

| MCP area | Status | What it is for |
|---|---|---|
| [`mcp/registry-mcp/`](mcp/registry-mcp/) | Design/spec-only | Future read-only discovery and query design over JSON registries. |
| [`mcp/installer-mcp/`](mcp/installer-mcp/) | Design/spec-only | Future approval-gated installation design for skill-local pack manifests. |
| [`mcp/projects/`](mcp/projects/) | Project notes | Short project-specific MCP specs, safety notes, and boundaries. |
| [`mcp/registry/`](mcp/registry/) | MCP-ready registry metadata | JSON project, skill, pack, template, and source metadata for future discovery. |
| [`mcp/references/`](mcp/references/) | Supporting docs | Registry, installer, MCP setup, and security reference material. |

No MCP commands are runnable from this repo today. The specs describe future tools only:

| Command/tool | What it does | Inputs | Output |
|---|---|---|---|
| `list_skills` | Future registry lookup for available skills. | None or small JSON filter | Skill IDs, titles, paths, and summaries. |
| `search_skills` | Future skill search. | Query string | Matching skills and routing notes. |
| `list_templates` | Future listing of skill-local templates. | Optional category | Template IDs, titles, and paths. |
| `list_packs` | Future listing of skill-local pack manifests. | Optional category | Pack IDs, titles, and risk notes. |
| `route_task` | Future task-to-surface routing. | Task description | Suggested skill/MCP/project surfaces. |
| `get_skill_context` | Future local skill context retrieval. | Skill ID | Local skill file paths and context notes. |
| `get_install_plan` | Future pack preview. | Pack ID | Write preview requiring approval before any mutation. |

## Folder Map

| Path | Use it when |
|---|---|
| [`_projects/`](_projects/) | You want full preserved project guides/source material. |
| [`skills/`](skills/) | You want copyable agent skills. |
| [`mcp/`](mcp/) | You want MCP-ready registry, design/spec docs, and metadata. |
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

Use targeted checks while iterating, then run full final validation before a PR-ready summary. See [`repo/docs/VALIDATION-STRATEGY.md`](repo/docs/VALIDATION-STRATEGY.md).

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
- `_projects/**/toolkit.project.json` is the routing and toolkit project-version contract. It declares which `_main/` or `curated_output_for_ai/` files publish to `skills/` and `mcp/` outputs.
- Toolkit project `version` is the toolkit adaptation/module version, uses `version_policy: "semver"`, and must not be replaced by Git tags, package tags, GitHub release tags, upstream versions, or per-file versions.
- `_projects/**/SOURCE-LOCK.json` records upstream/source provenance, exact source pins, blob pins, lifecycle, role, attribution requirement, and update policy.
- For third-party projects, `toolkit.project.json` version is the toolkit adaptation version only; scheduled source-watch tracking must read upstream repo, source ref, locked commit, `source_update_policy`, attribution requirement, allowlisted files, and exact blob pins from `SOURCE-LOCK.json`.
- Scheduled source-watch is PR-notification-only. It may compare active third-party SOURCE-LOCK pins with upstream GitHub commits and open or update a stable review PR. It must not copy upstream files, update SOURCE-LOCK pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat the notification PR as approval to change source. Real source updates require a separate human-approved PR after review.
- `skills/` contains copyable AI-agent skill folders. The whole skill folder is the install unit.
- `mcp/` contains MCP-ready registry, design/spec docs, metadata, and status documentation for future MCP usage.
- Generated `skills/` and `mcp/` files must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved generated/synced outputs in `README.md`, `AGENTS.md`, `skills/**`, `mcp/**`, and the declared source-side agent-rule templates generated from `_projects/**/_main/_partials/**`. It must not update other source files, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync must not run full repo validation against raw PR heads; this avoids blocking otherwise valid behind-main PR branches.
- Auto-sync static checks are limited to generated-surface freshness checks and git diff checks before committing generated output.
- Auto-sync may run only deterministic generation, sync, check, or validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- Auto-sync is optional convenience writeback, not the merge gate. `npm run validate:all` is the required full validation gate for PRs and `main`.
- If a PR includes `_projects/**/_main/**` source/provenance changes other than declared agent-rule partial inputs and generated source-side agent-rule templates, auto-sync must skip successfully without checkout, writeback, commit, or push. The author or Codex must commit required generated outputs, source-lock/provenance updates, and audit baseline updates, then pass `npm run validate:all`.
- If a writeback-eligible PR mixes eligible source/routing/contract edits with forbidden workflow, maintenance-script, test, docs, package, lockfile, or other unsafe paths, auto-sync must fail instead of pushing.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
- A generated/public surface must not replace a full working document with a lossy summary. Summaries are allowed only for catalogues, descriptions, navigation tables, or clearly marked overview files.
- Required runtime context for a skill or MCP surface must be local, complete enough to use, and traceable to the project source. External links may support provenance or further reading, but must not be required for normal execution.
<!-- END SOURCE-OF-TRUTH-CONTRACT -->
