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

Retired internal sources are provenance-only, not active update targets. Third-party active sources require manual review. The scheduled source-watch PR is a notification only; it must not copy upstream files or update SOURCE-LOCK pins.

## Install Toolkit Skills

### Native Toolkit Setup

For normal human setup, keep the journey short:

1. Pull or update this Toolkit repo from `weijunswj/ai-agent-toolkit`.
2. For Codex, open the repo in Codex and say `setup toolkit` or `refresh toolkit`; agents must run the full setup journey with `node repo/scripts/setup-toolkit.cjs --execute` from this repo instead of stopping after plugin verification, even when Toolkit is already installed.
3. Let Codex install or verify the Toolkit native plugin, then run the lite setup validation.
4. If Codex installs or updates the plugin, manually approve the startup hook when Codex prompts.
5. Restart Codex if setup says the plugin needs a fresh session.
6. Approve repo-backed auto-update only if you want the Toolkit bridge hub configured from this local repo on `main` with auto-sync.
7. Answer the required update-report auto-open preference: approve `--enable-update-report-open` if you want meaningful Toolkit hook reports to open automatically, or choose `--skip-update-report-open` to keep reports closed by default.
8. Answer the required Codex plugin cache auto-refresh preference: approve `--enable-codex-plugin-auto-refresh` if you want trusted `main` startup hooks to refresh stale Codex Toolkit plugin cache content automatically, or choose `--skip-codex-plugin-auto-refresh` to keep that refresh manual.
9. For Claude Code, use Claude Code's native Toolkit plugin flow from this repo; keep Codex and Claude Code plugin setup separate.
10. Add OpenCode or Antigravity 2 bridge targets only when you ask for that setup and approve the writes.

Codex and Claude Code update Toolkit through their own native plugin systems:

- Codex updates Toolkit through the Codex native plugin system using [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json).
- Claude Code updates Toolkit through the Claude Code native plugin system using [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json).
- Codex does not install or update Claude Code.
- Claude Code does not install or update Codex.
- OpenCode and Antigravity 2 are opt-in local bridge targets, not native plugin update targets.

Detailed Codex plugin verification and bridge command mechanics live in [Toolkit Local Bridge V2](TOOLKIT-LOCAL-BRIDGE-V2.md).

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

After this is enabled, Codex and Claude Code Toolkit plugin SessionStart hooks use the configured local repo as source of truth: they validate the repo, fetch the configured branch, fast-forward only, run hook-light validation (`node repo/scripts/validate-toolkit.cjs` + `node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs`), and then sync enabled bridge targets from the updated repo script. The hook path does not run full suite validation; run full validation manually when needed:

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

The bridge is Toolkit setup and maintenance infrastructure with one compact `toolkit-setup` discoverability skill, not a command-per-bridge skill family. It never silently sets up new non-native targets. Enabled targets may auto-sync from whichever native plugin is newer. Disabled and never-enabled targets are not touched.

Policy layering stays portable:

1. `AGENTS.md` is compact context and routing.
2. Skills/docs carry detailed portable workflows.
3. Validators and schemas enforce deterministic rules.
4. Hooks provide optional native automation around the shared updater.

## Use Skill-Local Templates Manually

Templates are published material. Review them before copying into a consumer repo, and follow generated notices back to `_main/` or `curated_output_for_ai/` when editing toolkit-owned sources.

- [Generic agent rule templates](../../skills/ai-coding-agent-rules/) contain generated inert slim baseline templates only. They intentionally do not include the full n8n ruleset or full skill-routing table.
- [n8n agent rules](../../skills/n8n-agent-rules/) contain the full n8n operating ruleset plus optional brief adapters under `adapters/`.
- [n8n local setup](../../skills/n8n-local-setup/references/n8n/local-setup.md) and [Hostinger Coolify VPS n8n](../../skills/n8n-local-setup/references/n8n/hostinger-vps.md) contain the full local and hosted n8n setup guides.
- [Codex SSH Hostinger Coolify Setup Maintainer](../../skills/codex-ssh-hostinger-coolify-setup-maintainer/) is the separate skill for Hostinger VPS plus Coolify setup, SSH preflight, maintenance, and incident response. Use it before the hosted n8n guide when Coolify is not already running.
- [n8n AI-agent platform references](../../skills/n8n-local-setup/references/ai-agent-platforms/) contain platform-specific skills/rules pointers, [official n8n Skills](https://github.com/n8n-io/skills) setup, and official n8n MCP setup.
- [n8n local stack templates](../../skills/n8n-local-setup/templates/local-stack/) contain the local Docker Compose, placeholder environment, launcher, and menu files.
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
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)
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
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

Claude Code [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup is secondary and not part of the beginner local setup path.

## OpenCode Setup

Use:

- [OpenCode reference](../../skills/n8n-local-setup/references/ai-agent-platforms/opencode.md)
- [OpenCode managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional OpenCode n8n adapter](../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

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
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

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
