# AI Agent Toolkit

A practical skills-first toolkit of reusable AI-agent skills, machine contracts, provenance records, and safe maintenance scripts.

## What this repo is

This repo keeps reusable AI-agent material in a direct canonical layout:

- [skills/](skills/) contains complete copyable AI-agent skill folders.
- [repo/contracts/](repo/contracts/) contains machine contracts, fixtures, templates, agent-rule inputs, and plugin source contracts.
- [repo/](repo/) contains maintenance docs, scripts, tests, provenance, and validation policy.
- [.codex-plugin/](.codex-plugin/) and [.claude-plugin/](.claude-plugin/) contain platform-specific native plugin metadata.

Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references remain inside [skills/n8n-local-setup/](skills/n8n-local-setup/) as secondary n8n setup material.

## Quick Start

| What you want | Start here |
|---|---|
| Full guide or source context | Open the relevant `skills/<skill-name>/` folder or `repo/contracts/` entry. |
| Set up Toolkit itself | Use [Toolkit Setup](#toolkit-setup), then ask Codex or Claude Code: `setup toolkit` or `refresh toolkit`. |
| Install a skill | Copy the whole skill folder using [Install Skills By Platform](#install-skills-by-platform). |
| Review skill safety | Use the [Skill Safety Matrix](repo/docs/SKILL-SAFETY-MATRIX.md) before creating, extending, or importing skills. |
| Maintenance work | Start with [repo/docs/](repo/docs/) and the validation commands below. |

## Toolkit Setup

For normal human setup, keep the journey short:

1. Pull or update this Toolkit repo from `weijunswj/ai-agent-toolkit`.
2. In Codex or Claude Code, open the repo and say `setup toolkit`, `refresh toolkit`, or plain `refresh` while the conversation is clearly about Toolkit setup/update state.
3. The agent must run the managed checkout setup script when it exists: Windows Codex uses `node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main`; POSIX Codex uses `node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main`; Claude Code appends `--host claude-code`.
4. Use `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main` from the active repo only as bootstrap/fallback when the managed checkout script is missing, then hand off to the managed checkout script after it exists.
5. If setup exits with code `23`, the complete compact bank must be visible in the same response as any recommended-default shortcut. Missing output is retried and never treated as approval; `--yes-recommended` is allowed only after you accept the displayed recommendations.
6. Keep routine setup on the root agent; it must not spawn subagents for instruction, docs, state, choice, or validation inspection. Codex recommends root-only under the strict contract and exposes one helper only as a manual conservative memory backstop; runtime mechanics stay in a technical proposal. Capacity is not launch permission: unsupported admission, effort, or child non-fast enforcement stays root-only. Unsafe current capacity is labelled, user-owned conflicts require one exact `apply` confirmation in the same flow, and other hosts receive no invented enforcement profile.
7. If Codex installs or updates the plugin, manually approve the startup hook when Codex prompts.
8. Restart the host if setup says the plugin needs a fresh session.
9. Keep native plugin installs host-local: Codex must not install/update Claude Code, and Claude Code must not install/update Codex.
10. Add OpenCode or Antigravity 2 bridge targets only when you ask for that setup and approve the writes.

More setup context lives in [How To Use](repo/docs/HOW-TO-USE.md#install-toolkit-skills); detailed plugin and bridge mechanics live in [Toolkit Local Bridge](repo/docs/TOOLKIT-LOCAL-BRIDGE.md).

## Terms

| Term | What it means |
|---|---|
| Skill | A copyable AI-agent folder with instructions, references, templates, metadata, and helper files. |
| MCP | Not a repo-wide shipped/generated surface in this repo right now. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references live inside the n8n local setup skill as secondary material. |
| Contract | A schema, policy, fixture, template, or reviewed source input under [repo/contracts/](repo/contracts/). |
| Native plugin metadata | Platform-specific `.codex-plugin/**` or `.claude-plugin/**` metadata that lets Codex and Claude Code update Toolkit through their own plugin systems. |

## Canonical Map

| Path | Purpose |
|---|---|
| [skills/](skills/) | Complete copyable skill folders. |
| [repo/contracts/](repo/contracts/) | Machine contracts, fixtures, templates, agent-rule inputs, and plugin source contracts. |
| [repo/source-watch/](repo/source-watch/) | Notification-only source-watch state and active third-party provenance. |
| [repo/scripts/](repo/scripts/) | Deterministic runtime and maintenance helpers. |
| [repo/tests/](repo/tests/) | Focused contract, safety, parser, and runtime tests. |
| [repo/docs/](repo/docs/) | Policy, safety, architecture, and validation guidance. |

## Skills

Skills are copyable folder packages. The portable package unit is `skills/<skill-name>/`. Copy whole skill folders, not just `SKILL.md`.

| Skill | Use |
|---|---|
| [AI Coding Agent Rules](skills/ai-coding-agent-rules/) | Install generic execution-first agent rules for supported coding agents. |
| [Toolkit Setup](skills/toolkit-setup/) | Route Toolkit plugin setup, Windows hook repair, repo-backed auto-update, local bridge setup, OpenCode bridge support, Antigravity 2 adapter support, audit, sync, disable, stale-state, and bridge troubleshooting requests to the shared setup subsystem. |
| [n8n Agent Rules](skills/n8n-agent-rules/) | Apply the full n8n operating contract before n8n workflow, MCP, import/export, credential, execution, or live-instance work. |
| [n8n Local Setup](skills/n8n-local-setup/) | Set up n8n with the localhost/ngrok dev stack, the separate production Cloudflare Tunnel self-hosting stack for local/CGNAT machines, Hostinger Coolify VPS guidance for hosted n8n, launcher/menu use, skills-first agent routing, and [official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references. |
| [n8n Workflow Helper Scripts](skills/n8n-workflow-helper-scripts/) | Sanitise, validate, export, import, compare, prepare, or sync n8n workflow JSON safely. |
| [n8n Workflow Templates](skills/n8n-workflow-templates/) | Review reusable public inactive n8n workflow JSON templates. |
| [Secure CI/CD Installer](skills/secure-cicd-installer/) | Plan CI/CD setup with approval gates, GitHub Actions notes, and status templates. |
| [Context-Preserving AI Publisher](skills/context-preserving-ai-publisher/) | Maintain source-traceable skills, contracts, provenance, templates, and audits. |
| [Agent Skill Supply-Chain Audit](skills/agent-skill-supply-chain-audit/) | Audit third-party agent skills for provenance, license, safety, conversion fit, and token-bloat risk. |
| [Local AI Stack Safety](skills/local-ai-stack-safety/) | Review local AI runtimes, model downloads, local AI web UIs, and endpoint exposure before setup. |
| [Managed App Foundation Review](skills/managed-app-foundation-review/) | Compare low-cost managed or owner-hosted foundations before custom-building auth, backend, database, workflow automation, CRM, forms, email, analytics, ops, and account-security surfaces. |
| [N5 GitHub Governance and Truthful PR-Review Reconciler](skills/github-governance-review-reconciler/) | Explicit-only current-main N5 parent/direct-child governance, bounded reconciliation, truthful PR-review inventory and disposition evidence, and Deferred Findings without review mutation or Web finality. |
| [Project Completion Audit](skills/project-completion-audit/) | Run guarded final readiness preflight, audit reporting, security-readiness review, and remediation batches before calling a repo release-ready. |
| [Codex SSH Hostinger Coolify Setup Maintainer](skills/codex-ssh-hostinger-coolify-setup-maintainer/) | Guide Codex through Hostinger VPS plus Coolify deployment setup, SSH preflight, daily security checks, intrusion-signal review, optional Telegram/email maintenance alerts, and incident response with owner approval gates. |
| [Self-Hosted Service Safety](skills/self-hosted-service-safety/) | Review non-n8n Docker/VPS, tunnel, public-port, credential, backup, SSH, traffic-log, and first-run safety. |
| [Secure UI/UX Frontend Design](skills/ui-ux-secure-frontend-design/) | Design or review frontend work with accessibility, responsive, privacy, and security guardrails. |
| [Windows Localhost Workflows](skills/windows-localhost-workflows/) | Start and verify Windows localhost dev services. |

## Install Skills By Platform

This section is only for manually copying Toolkit-owned skill folders under [skills/](skills/). Native Toolkit plugin setup belongs in [Toolkit Setup](#toolkit-setup).

> [!IMPORTANT]
> Repo-local agent instruction installs require a selected/open target repo or an explicit target path. Standalone chats without a workspace cannot safely infer where to install `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`.

Copy the whole `skills/<skill-name>/` folder into **ANY ONE** supported location for the target platform. Keep `README.md`, `references/`, `templates/`, `agents/`, and other supporting files beside `SKILL.md` when present.

`AGENTS.md` is the shared managed instruction file inside the target repo. For portable installs, create or merge it from [repo-local/AGENTS.managed.template.md](skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md), not from this toolkit repo's root [AGENTS.md](AGENTS.md). Claude Code and Antigravity 2 use tiny shims that point back to the target repo's `AGENTS.md`; do not install a shim by itself. Antigravity 2 also uses `.agents/rules/00-agent-toolkit-bootstrap.md` as a tiny bootstrap, but the target repo's `AGENTS.md` remains canonical.

| Platform | Manual Toolkit-owned skill folder locations | Active instruction files | Reference |
|---|---|---|---|
| Codex | `<repo>/.agents/skills/<skill-name>/`<br>`$HOME/.agents/skills/<skill-name>/`<br>`/etc/codex/skills/<skill-name>/` | `AGENTS.md` | [Codex](repo/docs/HOW-TO-USE.md#codex). |
| Claude Code | `<repo>/.claude/skills/<skill-name>/`<br>`$HOME/.claude/skills/<skill-name>/` | `AGENTS.md`, `CLAUDE.md` shim | [Claude Code](repo/docs/HOW-TO-USE.md#claude-code). |
| OpenCode | `<repo>/.opencode/skills/<skill-name>/`<br>`$HOME/.config/opencode/skills/<skill-name>/`<br>`<repo>/.claude/skills/<skill-name>/`<br>`$HOME/.claude/skills/<skill-name>/`<br>`<repo>/.agents/skills/<skill-name>/`<br>`$HOME/.agents/skills/<skill-name>/` | `AGENTS.md` | [OpenCode](repo/docs/HOW-TO-USE.md#opencode). |
| Antigravity 2 | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\` | `AGENTS.md`, `GEMINI.md`, Antigravity 2 bootstrap | [Antigravity 2](repo/docs/HOW-TO-USE.md#antigravity-2). |

Humans and agents use the same canonical `skills/**` and `repo/**` surfaces. No project-to-skill publishing step is required.

## MCP Status

Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now.

The supported path is direct and skills-first: humans and agents use `skills/**` and `repo/**`.

[Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references remain under [skills/n8n-local-setup/](skills/n8n-local-setup/) as secondary n8n setup material. They are not a repo-wide MCP surface.

## Folder Map

| Path | Use it when |
|---|---|
| [skills/](skills/) | You want copyable agent skills. |
| [repo/contracts/](repo/contracts/) | You want machine contracts, templates, agent-rule inputs, or plugin source contracts. |
| [.codex-plugin/](.codex-plugin/) | You want generated Codex native plugin metadata. |
| [.claude-plugin/](.claude-plugin/) | You want generated Claude Code native plugin metadata. |
| [repo/](repo/) | You are maintaining this toolkit. |
| [repo/source-watch/](repo/source-watch/) | You are reviewing source-watch lanes, including host-harness capability drift. |

## For Maintainers

Edit the canonical surface directly:

1. Update `skills/<skill-name>/` for skill content.
2. Update `repo/contracts/` for schemas, policies, fixtures, templates, or agent-rule inputs.
3. Update `repo/source-watch/provenance/` only for reviewed active third-party provenance changes.
4. Run the two retained synchronizer checks when managed blocks or instruction shims changed.

There is no project-generated skill output to rebuild. Keep every retained skill complete and locally usable.

For canonical surface rules, follow [repo/docs/PROJECT-MODULE-STANDARD.md](repo/docs/PROJECT-MODULE-STANDARD.md).

## Validation

Use targeted local checks before pushing. CI runs the full `npm run validate:all` merge gate; run it locally for broad or risky changes, workflow/sync/generator/package/security changes, or CI reproduction. See [repo/docs/VALIDATION-STRATEGY.md](repo/docs/VALIDATION-STRATEGY.md).

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-agent-instruction-shims.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/audit-skill-portability.cjs
node repo/scripts/audit-published-surfaces.cjs --check
git diff --check
```

## Appendix: Source-of-Truth Contract

<!-- AI-AGENT-TOOLKIT:repo/contracts/source-of-truth-contract.md:BEGIN SOURCE-OF-TRUTH-CONTRACT v1 -->
## Source-of-Truth Contract

`skills/**` is the canonical copyable AI-agent product surface. The whole skill folder is the install unit, and retained skills are edited directly.
- `repo/contracts/**` is the canonical machine contract surface for schemas, policies, fixtures, templates, and agent-rule inputs.
- `repo/scripts/**` is the canonical runtime and maintenance implementation surface; `repo/tests/**` owns focused contract and runtime tests.
- `repo/contracts/agent-rules/toolkit-skill-routing.md` is the routing source for the current `skills/*/SKILL.md` set and records intentionally omitted skills.
- `repo/source-watch/provenance/**/SOURCE-LOCK.json` contains only active third-party attribution pins. Each lock records the upstream repo, ref, commit, update policy, attribution requirement, allowlist, and exact blob pins for retained copied or adapted files.
- Scheduled source-watch is PR-notification-only. It may compare active source-lock pins and advisory targets with upstream GitHub commits, then open or refresh a stable review PR. It must not copy upstream files, change source-lock/advisory records, execute upstream code, auto-merge, push to main, run live n8n actions, or treat notification as approval. Real updates require a separate human-approved PR.
- The toolkit does not maintain project manifests, standalone `_main` source ownership, project-to-skill publishing, pack packaging, generated skill copies, privileged generated-surface writeback, or a generic Toolkit sync command. New Toolkit skills are created directly at canonical `skills/**` paths after Skill Creation Center review; contracts, runtime, tests, and docs are created directly at canonical `repo/**` paths.
- The retained deterministic synchronizers remain narrow: `repo/scripts/sync-repo-doc-contract.cjs` maintains only the managed source-of-truth block, while `repo/scripts/sync-agent-instruction-shims.cjs` maintains root/repo-local instruction shims and exactly four portable n8n safety derivatives sourced from `repo/contracts/agent-rules/n8n-agent-rules.md`:
  - `skills/n8n-agent-rules/n8n-agent-rules.md`
  - `skills/n8n-local-setup/references/n8n-agent-rules.md`
  - `skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md`
  - `skills/n8n-workflow-templates/references/n8n-agent-rules.md`
- This n8n derivative set is a bounded portable/local safety-context exception, not project-to-skill publishing or general generated-surface writeback. Use the exact retained synchronizer command for repair; no unspecified generic `run sync` command exists.
- `.codex-plugin/` and `.claude-plugin/` contain native plugin metadata for the current Toolkit package. They remain platform-separated and must not be used to cross-update the other native platform.
- This repo intentionally does not ship or maintain a repo-wide MCP generated surface. Official n8n Skills plus instance-level MCP references remain inside `skills/n8n-local-setup/` as secondary n8n setup material.
- All retained skill/runtime context must remain local, complete enough to use, and traceable through direct repository paths or the two retained third-party provenance records. External links may support provenance but must not be required for normal execution.
<!-- AI-AGENT-TOOLKIT:repo/contracts/source-of-truth-contract.md:END SOURCE-OF-TRUTH-CONTRACT -->
