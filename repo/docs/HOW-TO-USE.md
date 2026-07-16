# How To Use

This repo is a reusable toolkit for AI-agent work. It gives humans and agents a stable place to find preserved project modules, copyable skills, and maintenance scripts.

## Use Project Modules

Use [_projects/](../../_projects/) when you need the preserved source context behind an AI-facing surface.

- `_main/` keeps preserved project files, full docs, and provenance source.
- `curated_output_for_ai/` keeps reviewed AI-facing source material that sync recipes publish into `skills/`.
- `_generated/` is preview-only and not source of truth.
- `toolkit.project.json` owns the toolkit module version, routing contract, generated outputs, and write policy.
- `SOURCE-LOCK.json` owns upstream/source provenance, source pins, blob pins, lifecycle, attribution requirements, and source-watch update policy.

For third-party projects, the project `version` is the toolkit adaptation version, not the upstream version. Source-watch tasks must use `SOURCE-LOCK.json` for upstream repo, source ref, locked commit, update policy, attribution requirement, allowlisted files, and exact blob pins.

Start with:

- [Local n8n Setup](../../_projects/n8n/local-setup/)
- [n8n Workflow Toolkit](../../_projects/n8n/workflow-toolkit/)
- [Secure CI/CD Installer](../../_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](../../_projects/design/ui-ux-pro-max/)

To sync generated AI-facing surfaces:

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --write
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-toolkit-projects.cjs --write
node repo/scripts/sync-toolkit-projects.cjs --check
```

To inspect source update status:

```powershell
node repo/scripts/watch-project-sources.cjs
```

To run the same active third-party commit drift check used by the scheduled PR notifier:

```powershell
node repo/scripts/check-project-source-updates.cjs
```

Retired internal sources are provenance-only, not active update targets. Third-party active sources require manual review. The scheduled source-watch PR is a notification only; it must not copy upstream files, update SOURCE-LOCK pins, update advisory records, or change toolkit components. Host-harness capability drift reviews live under [repo/source-watch/](../source-watch/) and can only recommend separate evidence-backed PRs.

## Install Toolkit Skills

### Native Toolkit Setup

For normal human setup, keep the journey short:

1. Pull or update this Toolkit repo from `weijunswj/ai-agent-toolkit`.
2. In Codex or Claude Code, open the repo and say `setup toolkit`, `refresh toolkit`, or plain `refresh` while the conversation is clearly about Toolkit setup/update state. Agents must run the one-question-bank setup journey from the managed checkout instead of stopping after plugin verification or using the active repo worktree as the canonical source. Windows Codex uses `node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main`; POSIX Codex uses `node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main`; Claude Code appends `--host claude-code`.
3. Setup is handled by the root agent alone and must not spawn subagents for instructions, state, choices, or validation. In chat, the complete compact bank must be visible in the same response as any recommended-default shortcut; hidden command output or a summary does not count. Missing output is retried once and then blocks approval and writes. Do not rerun with `--yes-recommended` unless the user explicitly accepts the displayed recommendations.
4. **Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**
5. Default managed checkout paths are `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit` on Windows and `~/.ai-agent-toolkit/source/ai-agent-toolkit` on POSIX. Use `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main` from the active repo only as bootstrap/fallback when the managed checkout script is missing, then hand off to the managed checkout script after it exists.
6. Let the host install, verify, or refresh its own Toolkit native plugin path, then run the lite setup validation.
7. If Codex installs or updates the plugin, manually approve the startup hook when Codex prompts.
8. Restart the host if setup says the plugin needs a fresh session.
9. Keep native plugin installs host-local: Codex must not install/update Claude Code, and Claude Code must not install/update Codex.
10. Answer the complete setup wizard before any preference, target, or Codex configuration write. One semantic model drives chat, terminal, piped, flag, plan, JSON, summary, and execution modes, and rejects unexpected extra non-empty piped answers for every host before mutation. The normal Codex capacity recommendation is root agent only. One-helper and custom values are manual memory backstops, never a strict launch profile or launch permission. Effective runtime details, exact keys, root-inclusive capacity arithmetic, backups, and restore commands appear only in a technical proposal. Structurally complete user-owned controls already matching the selected outcome are preserved byte-for-byte without `apply`, editor, backup, replacement, or Toolkit markers; different replaceable controls require one `apply` confirmation. Unsupported MultiAgentV2 child tables, explicit false or non-boolean V2 enablement, and unknown or unsupported detection make no mutation. Current host paths without verified admission, medium effort, and child-only non-fast enforcement stay root-only. Codex Security never raises normal capacity automatically or relabels a sequential review as official Deep Scan.
11. The current wizard supersedes older internal choice wording: it groups `Automatic updates`, `Computer performance`, and `Other coding apps`; asks `How many helper agents may Codex use?`; and normally recommends root agent only while presenting helper counts only as manual capacity backstops. When exact PR #237 migration is pending, it visibly offers `migrate`, recommends `keep`, and neither empty input nor `--yes-recommended` migrates. Runtime names, raw settings, paths, backup, and restore mechanics remain in the technical proposal only. A replaceable user-owned conflict receives one exact proposal and `apply` confirmation in the same flow, or setup reports the selection unapplied. Claude separately offers root-only, one verified direct-only Toolkit path, broader native behavior outside coverage, and keep-current. Strict root/direct state is applied only while the installed plugin hook/cache bytes and current CLI launch controls verify; no Toolkit-managed nesting is advertised.
12. Add OpenCode or Antigravity 2 rows only when the app is detected or already enabled. These targets remain opt-in and host-local.
13. Meaningful update reports stay enabled by default. Action-required reports open automatically, successful update/refresh/repair/sync reports remain closed, true no-ops create no report, and legacy all-report auto-open state migrates to this failure-only behavior. Toolkit-managed reports/logs older than 7 days are cleaned up best-effort from the Toolkit report/log directory.

Codex and Claude Code update Toolkit through their own native plugin systems:

- Codex updates Toolkit through the Codex native plugin system using [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json).
- Claude Code updates Toolkit through the Claude Code native plugin system using [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json).
- Codex does not install or update Claude Code.
- Claude Code does not install or update Codex.
- OpenCode and Antigravity 2 are opt-in local bridge targets, not native plugin update targets.

Detailed plugin verification and bridge command mechanics live in [Toolkit Local Bridge](TOOLKIT-LOCAL-BRIDGE.md).

### Manual Skill-Folder Copying

Manual installation means copying a Toolkit-owned `skills/<skill-name>/` folder into one supported location. It is separate from native plugin setup and bridge target setup.

1. Use the whole `skills/<skill-name>/` folder as the install unit.
2. Copy whole skill folders, not just `SKILL.md`.
3. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.
4. Choose **ANY ONE** supported install location per platform.
5. Do not paste secrets, tokens, `.env` values, or credentials into repo files.

### Manual Skill Folder Locations

| Platform | Manual Toolkit-owned skill folder locations | Notes |
|---|---|---|
| Codex | `<repo>/.agents/skills/<skill-name>/`<br>`$HOME/.agents/skills/<skill-name>/`<br>`/etc/codex/skills/<skill-name>/` | Direct manual copy for a specific Toolkit skill. |
| Claude Code | `<repo>/.claude/skills/<skill-name>/`<br>`$HOME/.claude/skills/<skill-name>/` | Direct manual copy for a specific Toolkit skill. |
| OpenCode | `<repo>/.opencode/skills/<skill-name>/`<br>`$HOME/.config/opencode/skills/<skill-name>/`<br>`<repo>/.claude/skills/<skill-name>/`<br>`$HOME/.claude/skills/<skill-name>/`<br>`<repo>/.agents/skills/<skill-name>/`<br>`$HOME/.agents/skills/<skill-name>/` | Direct manual copy for a specific Toolkit skill. |
| Antigravity 2 | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` | Plugin-scoped manual copy for a specific Toolkit skill. |

This repo does not commit package archives. Keep `_dist/`, `.zip`, and `.tgz` artifacts out of commits.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync.

### Codex

Manual whole-skill-folder copying is for installing a specific Toolkit skill without the native plugin.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Repo-level | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
| Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

Codex scans repo skills from `.agents/skills` from the current working directory up to the repo root. It initially sees each skill's name, description, and file path, then loads the full `SKILL.md` only when selected. Use `/skills` or `$skill-name` for explicit invocation; implicit invocation depends on the `description` frontmatter. `~/.codex/config.toml` is for Codex configuration, including disabling skills by `SKILL.md` path, not the main skill install surface.

### Claude Code

Manual whole-skill-folder copying is for installing a specific Toolkit skill without the native plugin.

**Choose any one supported Claude Code skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project-level | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.claude/skills/<skill-name>/SKILL.md` |

Use `CLAUDE.md`, `CLAUDE.local.md`, or `.claude/rules/` for always-on Claude Code instructions.

### OpenCode

Manual whole-skill-folder copying is for installing a specific Toolkit skill. For the opt-in OpenCode bridge target, use [Use The Toolkit Local Bridge](#use-the-toolkit-local-bridge).

**Choose any one supported OpenCode skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project OpenCode config | `<repo>/.opencode/skills/<skill-name>/SKILL.md` |
| User OpenCode config | `$HOME/.config/opencode/skills/<skill-name>/SKILL.md` |
| Project Claude-compatible | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
| User Claude-compatible | `$HOME/.claude/skills/<skill-name>/SKILL.md` |
| Project agent-compatible | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User agent-compatible | `$HOME/.agents/skills/<skill-name>/SKILL.md` |

OpenCode walks upward from the current working directory to the git worktree for project-local skill paths, and it also loads global skill definitions. Use `AGENTS.md`, `AGENTS.override.md`, or the configured OpenCode rules file for always-on OpenCode instructions.

### Antigravity 2

For Antigravity 2, use the observed plugin-scoped skill-folder install for Toolkit skills. Its internal bridge target remains `ag2`, but manual skill copying uses the plugin-scoped skill folder below.

Run a dry-run bridge setup preview first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2
```

After explicit approval:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write
```

The bridge writes Antigravity 2 adapter metadata under the Toolkit Local Bridge Hub only. It does not install Python, Antigravity 2, AG2, or pip packages.

If the AG2 package is installed under a Python that is not on PATH, persist the reviewed command so future audits and hooks can reuse it:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --set-ag2-python-command "<python.exe>" --write
```

Audits list the selected AG2 Python command when detected, or the exact commands tried when Antigravity 2/AG2 is not detected.

**Use the Antigravity 2 plugin-scoped skill-folder location for toolkit skills:**

| Location type | Skill folder path |
|---|---|
| Plugin-scoped | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` |

Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder. This plugin-scoped folder is for loading toolkit skills.

**Put repo-local bootstrap outputs in the target repo, not inside the Antigravity 2 plugin folder:**

1. `AGENTS.md`.
2. `GEMINI.md`.
3. `.agents/rules/00-agent-toolkit-bootstrap.md`.

Use `GEMINI.md` or the configured context file for always-on Antigravity 2 instructions.

`skills/**/SKILL.md` files are published toolkit surfaces. If a generated notice is present, update the source path named in that notice and run `node repo/scripts/sync-toolkit-projects.cjs --write`. Directly maintained `linked` skills should be rare and justified in the related project manifest.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

## Use The Toolkit Local Bridge

The Toolkit Local Bridge is for user-local, PC-level adapter state. It is not a project-repo installer.

Default paths:

| Platform | Hub path |
|---|---|
| POSIX | `~/.ai-agent-toolkit/current` |
| Windows | `%USERPROFILE%\.ai-agent-toolkit\current` |

Audit without writes:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Sync already-enabled targets after approval:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
```

Enable opt-in repo-backed auto-update from a trusted local Toolkit checkout:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "C:\Users\<user>\GitHub Projects\ai-agent-toolkit" --repo-branch main --enable-auto-sync --write
```

After this is enabled, Codex and Claude Code Toolkit plugin SessionStart hooks use the configured local repo as source of truth: they validate the repo and remote, refuse dirty worktrees without stashing or switching, auto-switch a clean non-configured branch back to the configured branch, fetch the configured branch, fast-forward only, run hook-light validation (`node repo/scripts/validate-toolkit.cjs` + `node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs`), and then sync enabled bridge targets from the updated repo script. The hook path does not run full suite validation; run full validation manually when needed:

```powershell
npm run validate:all
node --test repo/tests/toolkit-local-bridge.test.cjs
```

Disable a target without deleting files:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
```

Disable auto-sync:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-auto-sync --write
```

Disable repo auto-update:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-repo-auto-update --write
```

The bridge is Toolkit setup and maintenance infrastructure with one compact `toolkit-setup` discoverability skill, not a command-per-bridge skill family. It never silently sets up new non-native targets. Repo, Codex, and Claude Code bridge copies record and enforce their versions independently, while `hub_version` remains a reporting and older-cache compatibility watermark only. Disabled and never-enabled targets are not touched.

Native hooks run cached bridge copies. After a bridge fix is merged, the machine is not fully updated until every affected host cache is refreshed:

- In Codex, run `setup toolkit`.
- In Claude Code, run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then restart Claude Code.

Refreshing one host never mutates the other host's cache.

Claude strict direct/root-only enforcement is applied only when native plugin installation freshness, enabled state, host-reported trust, and active hook execution all verify for the exact plugin version, cache identity, hook bytes, and controller bytes. Setup does not approve trust or manufacture activation proof, and an install/update or restart instruction is not proof that the current session executes the hook. Direct admission re-reads the current native state and exact installed identities before reservation; stale or replayed proof fails closed. Executable preflight follows official-style launcher symlinks only to verify a regular executable target and still invokes the original command so native auto-update behavior is preserved. Missing or lost proof leaves strict state root-only/unapplied; broader-native remains available explicitly outside Toolkit admission.

Automatic or manual Claude direct capacity additionally requires supported validated Linux `/proc/meminfo` or Windows operating-system counters. Unsupported platforms and malformed/overflowed counters omit those choices and resolve recommended setup safely. Prompt limits use UTF-8 bytes at the synchronous launch boundary before reservations or artifacts. Explicit Claude CLI paths use one reviewed process contract: JavaScript and `.exe` paths are shell-free, while Windows `.cmd`/`.bat` shims use an escaped command-interpreter boundary without placing prompts in argv.

Policy layering stays portable:

1. `AGENTS.md` is compact context and routing.
2. Skills/docs carry detailed portable workflows.
3. Validators and schemas enforce deterministic rules.
4. Hooks provide optional native automation around the shared updater.

## Use Skill-Local Templates Manually

Templates are published material. Review them before copying into a consumer repo, and follow generated notices back to `_main/` or `curated_output_for_ai/` when editing toolkit-owned sources.

- [Generic agent rule templates](../../skills/ai-coding-agent-rules/) contain generated inert slim baseline templates only. They intentionally do not include the full n8n ruleset or full skill-routing table.
- [n8n agent rules](../../skills/n8n-agent-rules/) contain the full n8n operating ruleset plus optional brief adapters under `adapters/`.
- [n8n local setup](../../skills/n8n-local-setup/references/n8n/local-setup.md), [production Cloudflare Tunnel self-hosting](../../skills/n8n-local-setup/references/n8n/production-cloudflare-tunnel.md), and [Hostinger Coolify VPS n8n](../../skills/n8n-local-setup/references/n8n/hostinger-vps.md) contain the full local dev, local/CGNAT production, and hosted n8n setup guides.
- [Codex SSH Hostinger Coolify Setup Maintainer](../../skills/codex-ssh-hostinger-coolify-setup-maintainer/) is the separate skill for Hostinger VPS plus Coolify setup, SSH preflight, maintenance, and incident response. Use it before the hosted n8n guide when Coolify is not already running.
- [n8n AI-agent platform references](../../skills/n8n-local-setup/references/ai-agent-platforms/) contain platform-specific skills/rules pointers, [official n8n Skills](https://github.com/n8n-io/skills) setup, and official n8n MCP setup.
- [n8n local stack templates](../../skills/n8n-local-setup/templates/.n8n-local/) contain the localhost/ngrok dev Docker Compose, placeholder environment, launcher, and menu files.
- [n8n production Cloudflare stack templates](../../skills/n8n-local-setup/templates/.n8n-production-cloudflare/) contain the separate production Docker Compose, placeholder environment, launcher, and menu files for local/CGNAT self-hosting through Cloudflare Tunnel.
- [n8n MCP config templates](../../skills/n8n-local-setup/templates/mcp-configs/) contain official instance-level MCP config examples for users intentionally enabling n8n MCP.
- [n8n import/export sync helpers](../../skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/) contain n8n import/export, validation, compare, prepare, and sync helper templates.
- [n8n sanitizer helpers](../../skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/) contain sanitizer tooling.
- [n8n workflow templates](../../skills/n8n-workflow-templates/templates/) contain public generic inactive workflow JSON templates.
- [CI/CD templates](../../skills/secure-cicd-installer/templates/cicd/) contain CI/CD installer prompts and status templates.

Generated template outputs are intentional. `node repo/scripts/sync-agent-instruction-shims.cjs --write` regenerates project-pure source-side baseline templates and root instruction shims from `_projects/development/ai-coding-agent-rules/_main/`; `node repo/scripts/sync-toolkit-projects.cjs --write` publishes inert skill copies and the generated `n8n-agent-rules` skill.

For n8n work, install or load `skills/n8n-agent-rules`. The optional adapter installer can detect n8n repositories and preview patches to active instruction files, but it must be run with `--dry-run` first. Before running it with `--write`, pause, name the current target file and operation, explain the write, and ask for explicit current-turn approval. Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the context cost.

n8n helper templates may write scoped local outputs after they are copied into a reviewed consumer repo: `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, and sanitizer staging folders. Keep those local folders ignored.

## Use Skill-Local Packs

Packs are manifest-defined bundles stored inside the related skill folder under `skills/<skill-name>/packs/`. They are review checklists, not a root user-facing surface.

Until the installer MCP exists, use packs as review checklists:

1. Open the pack README inside the skill folder.
2. Inspect `pack.json`.
3. Review every path in `installs`.
4. Before copying files, name the exact source and target paths and ask for explicit current-turn approval.
5. Copy only the files the user intentionally approves.

## Codex Setup

Use:

- [Codex reference](../../skills/n8n-local-setup/references/ai-agent-platforms/codex.md)
- [Codex managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Codex n8n adapter](../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-local-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-local-setup/templates/.n8n-production-cloudflare/)
- [Local n8n setup source module](../../_projects/n8n/local-setup/)

Keep live n8n tokens in user environment variables, not repo files. Codex [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup is secondary and not part of the beginner local setup path.

## Claude Code Setup

Use:

- [Claude Code reference](../../skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Claude Code shim template](../../skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Claude n8n adapter](../../skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-local-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-local-setup/templates/.n8n-production-cloudflare/)

Claude Code [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup is secondary and not part of the beginner local setup path.

## OpenCode Setup

Use:

- [OpenCode reference](../../skills/n8n-local-setup/references/ai-agent-platforms/opencode.md)
- [OpenCode managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional OpenCode n8n adapter](../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-local-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-local-setup/templates/.n8n-production-cloudflare/)

OpenCode [official n8n Skills](https://github.com/n8n-io/skills) support is platform-dependent; the official instance-level MCP setup is secondary and not part of the beginner local setup path.

## Antigravity 2 Setup

Use:

- [Antigravity 2 reference](../../skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Antigravity 2 GEMINI shim template](../../skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md)
- [Antigravity 2 bootstrap template](../../skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Antigravity 2 n8n adapter](../../skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-local-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-local-setup/templates/.n8n-production-cloudflare/)

Antigravity 2 [official n8n Skills](https://github.com/n8n-io/skills) support is platform-dependent; the official instance-level MCP setup is secondary and not part of the beginner local setup path.

## ChatGPT Web And Claude Web

ChatGPT web and Claude web can use instruction-only skills when custom skills are available in the account or workspace. They cannot safely run local shell commands unless the platform provides a tool with that access.

Do not automate ChatGPT web or Claude web with cookies, sessions, browser automation, or session hacks.

## MCP Status

Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now.

The supported path is skills-first: humans use `_projects/**`, and agents use `skills/**`.

[Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are packaged under [skills/n8n-local-setup/](../../skills/n8n-local-setup/) as secondary setup material. They are not a repo-wide MCP surface.

## Optional Design Tool

Use [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../skills/ui-ux-secure-frontend-design/tools/design-system-generator/) for local-only CSV-backed design-system recommendations. It does not require internet access and is separate from the instruction-only [design skill](../../skills/ui-ux-secure-frontend-design/).

## What Not To Do

- Do not paste real secrets into repo files.
- Do not copy live n8n exports into this toolkit.
- Pause before installing pack files: review the target writes, name the exact files, and ask for explicit current-turn approval.
- Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
- Do not run live import/export helpers from this toolkit repo.
- Do not run live n8n import/export helpers in CI.
- Do not auto-merge or auto-apply upstream updates. Treat upstream changes as review prompts, then use a separate human-approved PR for any source update.
- Do not edit generated AI-facing project outputs directly; update `_main/` or `curated_output_for_ai/` and run sync/check.
