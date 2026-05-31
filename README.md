# AI Agent Toolkit

A practical skills-first toolkit of reusable AI-agent skills, preserved source projects, and design/spec-only MCP metadata.

## What this repo is

This repo keeps reusable AI-agent material in a source-first layout:

- [_projects/](_projects/) preserves project source, provenance, and reviewed AI-facing source.
- [skills/](skills/) contains copyable AI-agent skill folders.
- [mcp/](mcp/) contains design/spec-only registry docs and metadata. No runnable MCP server is shipped today.
- [repo/](repo/) contains repo maintenance docs, scripts, tests, and validation policy.

## Quick Start

| What you want | Start here |
|---|---|
| Full guide or source context | Open a project under [_projects/](_projects/), then its `_main/` folder. |
| Install a skill | Copy the whole skill folder using [Install Skills By Platform](#install-skills-by-platform). |
| MCP design/spec material | Open [mcp/](mcp/) for current status, design/spec docs, registries, and notes. |
| Maintenance work | Start with [repo/docs/](repo/docs/) and the validation commands below. |

## Terms

| Term | What it means |
|---|---|
| Project | The source/provenance area where the real material is maintained. |
| Skill | A copyable AI-agent folder with instructions, references, templates, metadata, and helper files. |
| MCP | Design/spec docs and metadata for future MCP usage. No runnable server is shipped today. Optional n8n AI-coding-agent MCP feature references live inside the n8n local setup skill as secondary material. |
| Generated surface | A published file under [skills/](skills/) or [mcp/](mcp/) that is rebuilt from project source by a deterministic sync script. |

## Project Categories

| Category | What it contains |
|---|---|
| [`cicd/`](_projects/cicd/) | CI/CD and GitHub Actions safety material. |
| [`design/`](_projects/design/) | UI/UX and frontend design material. |
| [`development/`](_projects/development/) | General development workflow helpers. |
| [`knowledge/`](_projects/knowledge/) | Knowledge-base and index-maintenance skills. |
| [`n8n/`](_projects/n8n/) | n8n setup, workflow helper scripts, and workflow templates. |
| [`repo-methodology/`](_projects/repo-methodology/) | How this toolkit preserves source truth, generates published surfaces, and prevents context drift. |

## Projects

Open a project when you need maintained source, provenance, or the owner behind a generated surface.

| Project | Purpose | Source |
|---|---|---|
| [Local n8n Setup](_projects/n8n/local-setup/) | Local n8n setup, Hostinger VPS guidance, launcher/menu cleanup, local stack templates, skills-first agent routing, and optional AI-coding-agent MCP feature references. | [_main/](_projects/n8n/local-setup/_main/) |
| [n8n Workflow Toolkit](_projects/n8n/workflow-toolkit/) | n8n helper-script sources and inactive workflow templates. | [_main/](_projects/n8n/workflow-toolkit/_main/) |
| [Secure CI/CD Installer](_projects/cicd/secure-installer/) | CI/CD planning prompt, status templates, and safety policy source. | [_main/](_projects/cicd/secure-installer/_main/) |
| [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/) | Frontend design guidance, local generator source, and attribution notes. | [_main/](_projects/design/ui-ux-pro-max/_main/) |
| [Context-Preserving AI Publisher](_projects/repo-methodology/context-preserving-ai-publisher/) | Source-to-surface publishing method and starter templates. | [_main/](_projects/repo-methodology/context-preserving-ai-publisher/_main/) |
| [AI Coding Agent Rules](_projects/development/ai-coding-agent-rules/) | Generic agent-rule templates, skill routing source, and n8n rules source. | [_main/](_projects/development/ai-coding-agent-rules/_main/) |
| [Windows Localhost Workflows](_projects/development/windows-localhost-workflows/) | Windows localhost dev-server verification skill source. | [_main/](_projects/development/windows-localhost-workflows/_main/) |
| [Knowledge Index Updater](_projects/knowledge/knowledge-index-updater/) | Notion/GitHub knowledge-index skill source. | [_main/](_projects/knowledge/knowledge-index-updater/_main/) |

## Skills

Skills are copyable folder packages. The portable package unit is `skills/<skill-name>/`. Copy whole skill folders, not just `SKILL.md`.

| Skill | Use |
|---|---|
| [AI Coding Agent Rules](skills/ai-coding-agent-rules/) | Install generic execution-first agent rules for supported coding agents. |
| [n8n Agent Rules](skills/n8n-agent-rules/) | Apply the full n8n operating contract before n8n workflow, MCP, import/export, credential, execution, or live-instance work. |
| [n8n Local Setup](skills/n8n-local-setup/) | Set up local n8n with Docker Compose, Postgres, Compose ngrok, Hostinger VPS guidance, launcher/menu use, skills-first agent routing, and optional AI-coding-agent MCP feature references. |
| [n8n Workflow Helper Scripts](skills/n8n-workflow-helper-scripts/) | Sanitise, validate, export, import, compare, prepare, or sync n8n workflow JSON safely. |
| [n8n Workflow Templates](skills/n8n-workflow-templates/) | Review reusable public inactive n8n workflow JSON templates. |
| [Secure CI/CD Installer](skills/secure-cicd-installer/) | Plan CI/CD setup with approval gates, GitHub Actions notes, and status templates. |
| [Context-Preserving AI Publisher](skills/context-preserving-ai-publisher/) | Maintain source-traceable skills, MCP notes, templates, manifests, and audits. |
| [Secure UI/UX Frontend Design](skills/ui-ux-secure-frontend-design/) | Design or review frontend work with accessibility, responsive, privacy, and security guardrails. |
| [Windows Localhost Workflows](skills/windows-localhost-workflows/) | Start and verify Windows localhost dev services. |
| [Knowledge Index Updater](skills/knowledge-index-updater/) | Maintain a Notion/GitHub knowledge index with stable source keys and no duplicate rows. |

## Install Skills By Platform

For deeper setup notes, use [How To Use: Install Toolkit Skills](repo/docs/HOW-TO-USE.md#install-toolkit-skills).

> [!IMPORTANT]
> Repo-local agent instruction installs require a selected/open target repo or an explicit target path. Standalone chats without a workspace cannot safely infer where to install `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`.

Copy the whole `skills/<skill-name>/` folder into **ANY ONE** supported location for the target platform. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

Codex and Claude Code plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex/Claude plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex and Claude Code should use direct whole-skill-folder installs.

`AGENTS.md` is the shared managed instruction file inside the target repo. For portable installs, create or merge it from [repo-local/AGENTS.managed.template.md](skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md), not from this toolkit repo's root [AGENTS.md](AGENTS.md). Claude Code and Antigravity use tiny shims that point back to the target repo's `AGENTS.md`; do not install a shim by itself. Antigravity also uses `.agents/rules/00-agent-toolkit-bootstrap.md` as a tiny bootstrap, but the target repo's `AGENTS.md` remains canonical.

| Platform | Preferred install | Active instruction files | References |
|---|---|---|---|
| Codex | Direct whole-skill-folder install.<br>**Choose any one supported Codex skill-folder location:**<br>- `<repo>/.agents/skills/<skill-name>/`.<br>- `$HOME/.agents/skills/<skill-name>/`.<br>- `/etc/codex/skills/<skill-name>/`. | `AGENTS.md` | [Codex reference](skills/n8n-local-setup/references/ai-agent-platforms/codex.md). |
| Claude Code | Direct whole-skill-folder install.<br>**Choose any one supported Claude Code skill-folder location:**<br>- `<repo>/.claude/skills/<skill-name>/`.<br>- `$HOME/.claude/skills/<skill-name>/`. | `AGENTS.md`, `CLAUDE.md` shim | [Claude Code reference](skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md). |
| OpenCode | Short manual whole-skill-folder install only.<br>**Choose any one supported OpenCode skill-folder location:**<br>- `<repo>/.opencode/skills/<skill-name>/`.<br>- `$HOME/.config/opencode/skills/<skill-name>/`.<br>- A compatible `.agents/skills/` or `.claude/skills/` location if that is how the target OpenCode runtime is configured. | `AGENTS.md` | [OpenCode reference](skills/n8n-local-setup/references/ai-agent-platforms/opencode.md). |
| Antigravity | Plugin-scoped skill-folder install.<br>`C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\`. | `AGENTS.md`, `GEMINI.md`, Antigravity bootstrap | [Antigravity reference](skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md). |

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional n8n AI-coding-agent MCP feature references are secondary and not the beginner local setup path.

Default generic templates stay slim and do not include full n8n rules or full skill-routing tables. For n8n work, install or load [skills/n8n-agent-rules/](skills/n8n-agent-rules/). Optional adapters in [skills/n8n-agent-rules/adapters/](skills/n8n-agent-rules/adapters/) are brief fallback snippets and are not automatically appended. The adapter installer can detect n8n repos and preview changes, but agents must ask before running it with `--write`.

## MCP

MCP material lives in [mcp/](mcp/) as design/spec-only metadata. This repo does not ship a runnable MCP server, package, CLI, or executable MCP tools today. Optional n8n AI-coding-agent MCP feature references are packaged under [skills/n8n-local-setup/](skills/n8n-local-setup/) as secondary setup material.

| MCP area | Status | Use |
|---|---|---|
| [mcp/](mcp/) | Overview | Current design/spec-only MCP status. |
| [mcp/registry/](mcp/registry/) | MCP-ready registry metadata | JSON registry data for future discovery. |
| [mcp/registry-mcp/](mcp/registry-mcp/) | Design/spec-only | Future read-only registry query design. |
| [mcp/installer-mcp/](mcp/installer-mcp/) | Design/spec-only | Future approval-gated installer design. |
| [mcp/projects/](mcp/projects/) | Project notes | Project-specific MCP specs, safety notes, and boundaries. |
| [mcp/references/](mcp/references/) | Supporting docs | Security, registry, and installer notes. |

## Folder Map

| Path | Use it when |
|---|---|
| [_projects/](_projects/) | You want full preserved project guides/source material. |
| [skills/](skills/) | You want copyable agent skills. |
| [mcp/](mcp/) | You want MCP-ready registry, design/spec docs, and metadata. |
| [repo/](repo/) | You are maintaining this toolkit. |

## For Maintainers

Edit source first, then publish:

1. Update `_projects/**/_main/` only when preserved source must change.
2. Update `_projects/**/curated_output_for_ai/` for reviewed AI-facing source.
3. Update `_projects/**/toolkit.project.json` when routing or surface metadata changes.
4. Run [`repo/scripts/sync-toolkit-projects.cjs`](repo/scripts/sync-toolkit-projects.cjs) with `--write`.

Do not edit generated [skills/](skills/) or [mcp/](mcp/) outputs directly unless the output is explicitly declared as `linked`.

For project module rules, follow [repo/docs/PROJECT-MODULE-STANDARD.md](repo/docs/PROJECT-MODULE-STANDARD.md).

## Validation

Use targeted local checks before pushing. CI runs the full `npm run validate:all` merge gate; run it locally for broad or risky changes, workflow/sync/generator/package/security changes, or CI reproduction. See [repo/docs/VALIDATION-STRATEGY.md](repo/docs/VALIDATION-STRATEGY.md).

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/audit-skill-portability.cjs
git diff --check
```

## Appendix: Source-of-Truth Contract

<!-- AI-AGENT-TOOLKIT:_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md:BEGIN SOURCE-OF-TRUTH-CONTRACT v1 -->
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
- Toolkit skill-routing source lives in `_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md`; keep it aligned with current `skills/*/SKILL.md` when skills or skill-publishing project modules change, and document any intentionally omitted skill.
- `mcp/` contains MCP-ready registry, design/spec docs, metadata, and status documentation for future MCP usage.
- Generated `skills/` and `mcp/` files must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved passive generated/synced outputs in `README.md`, `skills/**`, `mcp/**`, and the declared source-side agent-rule templates generated from `_projects/**/_main/_partials/**`. It must not write active root AI instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`), update other source files, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs. If source changes require active root instruction outputs to change, the PR author must commit those files manually on the PR branch.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync must not run full repo validation against raw PR heads; this avoids blocking otherwise valid behind-main PR branches.
- Auto-sync static checks are limited to generated-surface freshness checks and git diff checks before committing generated output.
- Auto-sync may run only deterministic generation, sync, check, or validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- Auto-sync is optional convenience writeback, not the merge gate. `npm run validate:all` is the required read-only CI and `main` validation gate.
- If a PR includes `_projects/**/_main/**` source/provenance changes other than declared agent-rule partial inputs and generated source-side agent-rule templates, auto-sync must skip successfully without checkout, writeback, commit, or push. The author or AI Coding Agent (i.e. Codex, Claude Code, Antigravity, OpenCode, etc.) must commit required generated outputs, source-lock/provenance updates, and audit baseline updates, then rely on the normal read-only validation gate.
- If a writeback-eligible PR mixes eligible source/routing/contract edits with workflow, maintenance-script, test, docs, package, lockfile, or other source/maintenance paths, auto-sync must skip successfully instead of pushing. The author or AI Coding Agent (i.e. Codex, Claude Code, Antigravity, OpenCode, etc.) must commit generated outputs manually and rely on normal read-only validation.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
- A generated/public surface must not replace a full working document with a lossy summary. Summaries are allowed only for catalogues, descriptions, navigation tables, or clearly marked overview files.
- Required runtime context for a skill or MCP surface must be local, complete enough to use, and traceable to the project source. External links may support provenance or further reading, but must not be required for normal execution.
<!-- AI-AGENT-TOOLKIT:_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md:END SOURCE-OF-TRUTH-CONTRACT -->
