# AI Agent Toolkit

A practical skills-first toolkit of reusable AI-agent skills and preserved source projects.

## What this repo is

This repo keeps reusable AI-agent material in a source-first layout:

- [_projects/](_projects/) preserves project source, provenance, and reviewed AI-facing source.
- [skills/](skills/) contains copyable AI-agent skill folders.
- [repo/](repo/) contains repo maintenance docs, scripts, tests, and validation policy.
- [.codex-plugin/](.codex-plugin/) and [.claude-plugin/](.claude-plugin/) contain generated native plugin metadata.

Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references remain inside [skills/n8n-local-setup/](skills/n8n-local-setup/) as secondary n8n setup material.

## Quick Start

| What you want | Start here |
|---|---|
| Full guide or source context | Open a project under [_projects/](_projects/), then its `_main/` folder. |
| Install a skill | Copy the whole skill folder using [Install Skills By Platform](#install-skills-by-platform). |
| Review skill safety | Use the [Skill Safety Matrix](repo/docs/SKILL-SAFETY-MATRIX.md) before creating, extending, or importing skills. |
| Maintenance work | Start with [repo/docs/](repo/docs/) and the validation commands below. |

## Terms

| Term | What it means |
|---|---|
| Project | The source/provenance area where the real material is maintained. |
| Skill | A copyable AI-agent folder with instructions, references, templates, metadata, and helper files. |
| MCP | Not a repo-wide shipped/generated surface in this repo right now. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references live inside the n8n local setup skill as secondary material. |
| Generated surface | A published file under [skills/](skills/) that is rebuilt from project source by a deterministic sync script. |
| Native plugin metadata | Generated `.codex-plugin/**` or `.claude-plugin/**` metadata that lets Codex and Claude Code update Toolkit through their own plugin systems. |

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
| [Local n8n Setup](_projects/n8n/local-setup/) | Local n8n setup, Hostinger Coolify VPS guidance for hosted n8n, launcher/menu cleanup, local stack templates, skills-first agent routing, and [official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references. | [_main/](_projects/n8n/local-setup/_main/) |
| [n8n Workflow Toolkit](_projects/n8n/workflow-toolkit/) | n8n helper-script sources and inactive workflow templates. | [_main/](_projects/n8n/workflow-toolkit/_main/) |
| [Secure CI/CD Installer](_projects/cicd/secure-installer/) | CI/CD planning prompt, status templates, and safety policy source. | [_main/](_projects/cicd/secure-installer/_main/) |
| [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/) | Frontend design guidance, local generator source, and attribution notes. | [_main/](_projects/design/ui-ux-pro-max/_main/) |
| [Context-Preserving AI Publisher](_projects/repo-methodology/context-preserving-ai-publisher/) | Source-to-surface publishing method and starter templates. | [_main/](_projects/repo-methodology/context-preserving-ai-publisher/_main/) |
| [Agent Skill Supply-Chain Audit](_projects/repo-methodology/agent-skill-supply-chain-audit/) | Third-party skill provenance, safety, license, and conversion audit source. | [_main/](_projects/repo-methodology/agent-skill-supply-chain-audit/_main/) |
| [AI Coding Agent Rules](_projects/development/ai-coding-agent-rules/) | Generic agent-rule templates, skill routing source, and n8n rules source. | [_main/](_projects/development/ai-coding-agent-rules/_main/) |
| [Local AI Stack Safety](_projects/development/local-ai-stack-safety/) | Lightweight local AI runtime, model download, local AI web UI, and endpoint exposure safety-review skill source. | [_main/](_projects/development/local-ai-stack-safety/_main/) |
| [Managed App Foundation Review](_projects/development/managed-app-foundation-review/) | Build-vs-buy planning for low-cost managed or owner-hosted auth, backend, database, workflow automation, CRM, forms, email, storage, analytics, ops, and account-security foundations. | [_main/](_projects/development/managed-app-foundation-review/_main/) |
| [Project Completion Audit](_projects/development/project-completion-audit/) | Guarded final completion, production-readiness, release-candidate, QA, security-readiness, and remediation audit workflow. | [_main/](_projects/development/project-completion-audit/_main/) |
| [Toolkit Local Bridge](_projects/development/toolkit-local-bridge/) | Native Codex and Claude Code plugin metadata plus opt-in local bridge command skills for OpenCode and AG2 adapter targets. | [_main/](_projects/development/toolkit-local-bridge/_main/) |
| [Codex SSH Hostinger Coolify Setup Maintainer](_projects/development/hostinger-coolify-production-guide/) | Codex SSH Hostinger VPS plus Coolify setup, deployment, daily security checks, intrusion-signal review, optional maintenance alerts, and incident response workflow. | [_main/](_projects/development/hostinger-coolify-production-guide/_main/) |
| [Self-Hosted Service Safety](_projects/development/self-hosted-service-safety/) | Lightweight non-n8n Docker/VPS, public exposure, credential, backup, SSH, traffic-log, and first-run safety-review skill source. | [_main/](_projects/development/self-hosted-service-safety/_main/) |
| [Windows Localhost Workflows](_projects/development/windows-localhost-workflows/) | Windows localhost dev-server verification skill source. | [_main/](_projects/development/windows-localhost-workflows/_main/) |
| [Knowledge Index Updater](_projects/knowledge/knowledge-index-updater/) | Notion/GitHub knowledge-index skill source. | [_main/](_projects/knowledge/knowledge-index-updater/_main/) |

## Skills

Skills are copyable folder packages. The portable package unit is `skills/<skill-name>/`. Copy whole skill folders, not just `SKILL.md`.

| Skill | Use |
|---|---|
| [AI Coding Agent Rules](skills/ai-coding-agent-rules/) | Install generic execution-first agent rules for supported coding agents. |
| [n8n Agent Rules](skills/n8n-agent-rules/) | Apply the full n8n operating contract before n8n workflow, MCP, import/export, credential, execution, or live-instance work. |
| [n8n Local Setup](skills/n8n-local-setup/) | Set up local n8n with Docker Compose, Postgres, Compose ngrok, Hostinger Coolify VPS guidance for hosted n8n, launcher/menu use, skills-first agent routing, and [official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references. |
| [n8n Workflow Helper Scripts](skills/n8n-workflow-helper-scripts/) | Sanitise, validate, export, import, compare, prepare, or sync n8n workflow JSON safely. |
| [n8n Workflow Templates](skills/n8n-workflow-templates/) | Review reusable public inactive n8n workflow JSON templates. |
| [Secure CI/CD Installer](skills/secure-cicd-installer/) | Plan CI/CD setup with approval gates, GitHub Actions notes, and status templates. |
| [Context-Preserving AI Publisher](skills/context-preserving-ai-publisher/) | Maintain source-traceable skills, templates, manifests, and audits. |
| [Setup Local Toolkit Bridge](skills/setup-local-toolkit-bridge/) | Set up or trust the user-local Toolkit bridge hub and optional auto-sync after dry-run audit and approval. |
| [Setup OpenCode Bridge](skills/setup-opencode-bridge/) | Enable the opt-in OpenCode bridge target after showing planned global skill writes. |
| [Setup AG2 Bridge](skills/setup-ag2-bridge/) | Enable the opt-in AG2 bridge target without installing Python packages. |
| [Setup All Non-Native Bridges](skills/setup-all-non-native-bridges/) | Preview OpenCode and AG2 setup together, then enable only approved targets. |
| [Sync Enabled Bridges](skills/sync-enabled-bridges/) | Sync only already-enabled Toolkit bridge targets with lock handling and downgrade refusal. |
| [Audit Local Toolkit Bridge](skills/audit-local-toolkit-bridge/) | Inspect bridge state, paths, checksums, target detection, and skip reasons without writing by default. |
| [Disable Local Toolkit Bridge](skills/disable-local-toolkit-bridge/) | Disable bridge auto-sync or targets without deleting user files by default. |
| [Agent Skill Supply-Chain Audit](skills/agent-skill-supply-chain-audit/) | Audit third-party agent skills for provenance, license, safety, conversion fit, and token-bloat risk. |
| [Local AI Stack Safety](skills/local-ai-stack-safety/) | Review local AI runtimes, model downloads, local AI web UIs, and endpoint exposure before setup. |
| [Managed App Foundation Review](skills/managed-app-foundation-review/) | Compare low-cost managed or owner-hosted foundations before custom-building auth, backend, database, workflow automation, CRM, forms, email, analytics, ops, and account-security surfaces. |
| [Project Completion Audit](skills/project-completion-audit/) | Run guarded final readiness preflight, audit reporting, security-readiness review, and remediation batches before calling a repo release-ready. |
| [Codex SSH Hostinger Coolify Setup Maintainer](skills/codex-ssh-hostinger-coolify-setup-maintainer/) | Guide Codex through Hostinger VPS plus Coolify deployment setup, SSH preflight, daily security checks, intrusion-signal review, optional Telegram/email maintenance alerts, and incident response with owner approval gates. |
| [Self-Hosted Service Safety](skills/self-hosted-service-safety/) | Review non-n8n Docker/VPS, tunnel, public-port, credential, backup, SSH, traffic-log, and first-run safety. |
| [Secure UI/UX Frontend Design](skills/ui-ux-secure-frontend-design/) | Design or review frontend work with accessibility, responsive, privacy, and security guardrails. |
| [Windows Localhost Workflows](skills/windows-localhost-workflows/) | Start and verify Windows localhost dev services. |
| [Knowledge Index Updater](skills/knowledge-index-updater/) | Maintain a Notion/GitHub knowledge index with stable source keys and no duplicate rows. |

## Install Skills By Platform

For deeper setup notes, use [How To Use: Install Toolkit Skills](repo/docs/HOW-TO-USE.md#install-toolkit-skills).

> [!IMPORTANT]
> Repo-local agent instruction installs require a selected/open target repo or an explicit target path. Standalone chats without a workspace cannot safely infer where to install `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`.

Preferred v2 route:

- Codex updates Toolkit through the Codex native plugin system using [.codex-plugin/plugin.json](.codex-plugin/plugin.json).
- Claude Code updates Toolkit through the Claude Code native plugin system using [.claude-plugin/plugin.json](.claude-plugin/plugin.json).
- Codex does not install or update Claude Code.
- Claude Code does not install or update Codex.
- The shared bridge manages only opt-in non-native targets: OpenCode global skills and AG2 adapter metadata.

Manual fallback: copy the whole `skills/<skill-name>/` folder into **ANY ONE** supported location for the target platform. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

[Official n8n Skills](https://github.com/n8n-io/skills) are upstream-owned and must not be copied, forked, mirrored, vendored, or recreated inside this toolkit. For n8n work, install the official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin where the platform supports plugin hooks:

```powershell
codex plugin marketplace add n8n-io/skills
codex plugin add n8n-skills@n8n-io
```

```text
/plugin marketplace add n8n-io/skills
/plugin install n8n-skills@n8n-io
```

Restart the agent and approve or trust plugin hooks when prompted so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.

For OpenCode, Antigravity, and other platforms without proven official plugin parity, follow the upstream "Other platforms" route from the [official n8n Skills](https://github.com/n8n-io/skills) README. From the target project folder, run:

```powershell
npx skills add n8n-io/skills
```

Compatibility varies by agent; check `skills.sh` support for the specific platform. Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks, so add the current official entry-point cue to the target repo's `AGENTS.md`:

```text
This project uses n8n. When working with workflows, nodes, expressions, or
the n8n MCP tools, always start by loading the `using-n8n-skills` meta-skill
and follow its routing into the matching capability skill before acting.
```

The cue names the current [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`. If the upstream entry point changes, update this cue from the official README instead of inventing a local alias.

`AGENTS.md` is the shared managed instruction file inside the target repo. For portable installs, create or merge it from [repo-local/AGENTS.managed.template.md](skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md), not from this toolkit repo's root [AGENTS.md](AGENTS.md). Claude Code and Antigravity use tiny shims that point back to the target repo's `AGENTS.md`; do not install a shim by itself. Antigravity also uses `.agents/rules/00-agent-toolkit-bootstrap.md` as a tiny bootstrap, but the target repo's `AGENTS.md` remains canonical.

| Platform | Toolkit-owned skill install | Active instruction files | References |
|---|---|---|---|
| Codex | Native plugin package via `.codex-plugin/plugin.json`; direct whole-skill-folder install remains a manual fallback. | `AGENTS.md` | [Codex reference](skills/n8n-local-setup/references/ai-agent-platforms/codex.md). |
| Claude Code | Native plugin package via `.claude-plugin/plugin.json`; direct whole-skill-folder install remains a manual fallback. | `AGENTS.md`, `CLAUDE.md` shim | [Claude Code reference](skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md). |
| OpenCode | Opt-in bridge target only after approval.<br>Default global output: `$HOME/.config/opencode/skills/ai-agent-toolkit/`. | `AGENTS.md` | [OpenCode reference](skills/n8n-local-setup/references/ai-agent-platforms/opencode.md). |
| AG2 | Opt-in bridge target only after approval.<br>Adapter output stays under `$HOME/.ai-agent-toolkit/current/adapters/ag2/`. | Portable metadata | [Toolkit Local Bridge V2](repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md). |
| Antigravity | Plugin-scoped skill-folder install.<br>`C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\`. | `AGENTS.md`, `GEMINI.md`, Antigravity bootstrap | [Antigravity reference](skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md). |

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are secondary and not the beginner local setup path.

Default generic templates stay slim and do not include full n8n rules or full skill-routing tables. For n8n work, install or load [skills/n8n-agent-rules/](skills/n8n-agent-rules/). Optional adapters in [skills/n8n-agent-rules/adapters/](skills/n8n-agent-rules/adapters/) are brief fallback snippets and are not automatically appended. The adapter installer can detect n8n repos and preview changes, but agents must ask before running it with `--write`.

For bridge status:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

See [Toolkit Local Bridge V2](repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md) for autocheck, autosetup, auto-sync, rollback, Windows/POSIX paths, hook policy, and portable policy-first layering.

## MCP Status

Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now.

The supported path is skills-first: humans use `_projects/**`; agents use `skills/**`.

[Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references remain under [skills/n8n-local-setup/](skills/n8n-local-setup/) as secondary n8n setup material. They are not a repo-wide MCP surface.

## Folder Map

| Path | Use it when |
|---|---|
| [_projects/](_projects/) | You want full preserved project guides/source material. |
| [skills/](skills/) | You want copyable agent skills. |
| [.codex-plugin/](.codex-plugin/) | You want generated Codex native plugin metadata. |
| [.claude-plugin/](.claude-plugin/) | You want generated Claude Code native plugin metadata. |
| [repo/](repo/) | You are maintaining this toolkit. |

## For Maintainers

Edit source first, then publish:

1. Update `_projects/**/_main/` only when preserved source must change.
2. Update `_projects/**/curated_output_for_ai/` for reviewed AI-facing source.
3. Update `_projects/**/toolkit.project.json` when routing or surface metadata changes.
4. Run [`repo/scripts/sync-toolkit-projects.cjs`](repo/scripts/sync-toolkit-projects.cjs) with `--write`.

Do not edit generated [skills/](skills/) outputs directly unless the output is explicitly declared as `linked`.

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
- `_projects/**/toolkit.project.json` is the routing and toolkit project-version contract. It declares which `_main/` or `curated_output_for_ai/` files publish to `skills/` outputs.
- Toolkit project `version` is the toolkit adaptation/module version, uses `version_policy: "semver"`, and must not be replaced by Git tags, package tags, GitHub release tags, upstream versions, or per-file versions.
- `_projects/**/SOURCE-LOCK.json` records upstream/source provenance, exact source pins, blob pins, lifecycle, role, attribution requirement, and update policy.
- For third-party projects, `toolkit.project.json` version is the toolkit adaptation version only; scheduled source-watch tracking must read upstream repo, source ref, locked commit, `source_update_policy`, attribution requirement, allowlisted files, and exact blob pins from `SOURCE-LOCK.json`.
- Scheduled source-watch is PR-notification-only. It may compare active third-party SOURCE-LOCK pins with upstream GitHub commits and open or update a stable review PR. It must not copy upstream files, update SOURCE-LOCK pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat the notification PR as approval to change source. Real source updates require a separate human-approved PR after review.
- `skills/` contains copyable AI-agent skill folders. The whole skill folder is the install unit.
- `.codex-plugin/` and `.claude-plugin/` contain generated native plugin metadata for the current Toolkit package. They are not source of truth and must not be used to cross-update the other native platform.
- Toolkit skill-routing source lives in `_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md`; keep it aligned with current `skills/*/SKILL.md` when skills or skill-publishing project modules change, and document any intentionally omitted skill.
- This repo intentionally does not ship or maintain a repo-wide MCP generated surface for now. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references remain under `skills/n8n-local-setup/` as secondary n8n setup material.
- Generated published surfaces under `skills/`, `.codex-plugin/`, and `.claude-plugin/` must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved passive generated/synced outputs in `README.md`, `skills/**`, and the declared source-side agent-rule templates generated from `_projects/**/_main/_partials/**`. It must not write active root AI instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`), update other source files, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs. If source changes require active root instruction outputs to change, the PR author must commit those files manually on the PR branch.
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
- Required runtime context for a skill surface must be local, complete enough to use, and traceable to the project source. External links may support provenance or further reading, but must not be required for normal execution.
<!-- AI-AGENT-TOOLKIT:_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md:END SOURCE-OF-TRUTH-CONTRACT -->
