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

Preferred v2 install for toolkit-owned skills:

- Codex updates Toolkit through the Codex native plugin system using [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json).
- Claude Code updates Toolkit through the Claude Code native plugin system using [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json).
- Codex does not install or update Claude Code.
- Claude Code does not install or update Codex.
- OpenCode and AG2 are opt-in local bridge targets, not native plugin update targets.

For the English prompt `setup toolkit`, Codex must verify the native plugin install instead of assuming it:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

If the plugin is missing, disabled, stale, or lacks Toolkit version `2.2.0` plus the Codex `SessionStart` hook in the installed plugin cache, install or update through the supported local marketplace path:

```powershell
codex plugin marketplace add "<local-ai-agent-toolkit-repo>" --json
codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

The local marketplace wrapper is [`.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json) and uses `policy.authentication: "ON_USE"` so the no-auth local Toolkit plugin can install headlessly. `node repo/scripts/setup-codex-toolkit-plugin.cjs --write` runs the same Codex-only install/update path and fails clearly if local marketplace installs are unsupported. It never installs or updates Claude Code.

Verification prefers `codex plugin list --available --json`. If that list is empty or unreliable but Codex config and the installed cache prove the Toolkit plugin is enabled, sourced from the local marketplace, current, and has the expected `SessionStart` hook, the helper reports config/cache fallback verification. After every verify, install, or update, follow the helper's `**Next Steps:**` section: restart Codex if anything changed, open Codex hook review when prompted, and trust the Codex `SessionStart` hook only if it runs `node ".../repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin`. This hook approval step is Codex-only; Claude Code does not need Codex hook approval.

Manual fallback: copy the whole `skills/<skill-name>/` folder into one supported location.

1. Use the whole `skills/<skill-name>/` folder as the install unit.
2. Copy whole skill folders, not just `SKILL.md`.
3. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.
4. Choose **ANY ONE** supported install location per platform.
5. Do not paste secrets, tokens, `.env` values, or credentials into repo files.

[Official n8n Skills](https://github.com/n8n-io/skills) are upstream-owned and must not be copied, forked, mirrored, vendored, or recreated inside this toolkit. English prompt: `setup n8n plugin`. Install the official n8n plugin only if hooks can be made Windows-safe. Never touch `n8n_live` during plugin setup; instance-level MCP access is a separate explicitly approved live-action path.

On Windows, the installed package's `hooks/hooks.json` must not leave a bare `.sh` path like `${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh`, bare `bash`, or `C:\WINDOWS\system32\bash.exe`; a bare `.sh` hook would open `session-start.sh` in VS Code instead of running as a hook. Toolkit repairs generic `.sh` hook commands through a PowerShell 5.1-compatible wrapper that invokes Git Bash from `C:\Program Files\Git\bin\bash.exe` or `C:\Program Files\Git\usr\bin\bash.exe`; for `n8n-skills@n8n-io`, it also patches hook emitters so they can output JSON with Node when `jq` and `python3` are unavailable.

Install the official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin:

```powershell
codex plugin marketplace add n8n-io/skills
codex plugin add n8n-skills@n8n-io
```

```text
/plugin marketplace add n8n-io/skills
/plugin install n8n-skills@n8n-io
```

On Windows, repair and audit the installed plugin cache before approving or trusting hooks:

```powershell
node repo/scripts/repair-codex-plugin-windows-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --write --plugin-id n8n-skills@n8n-io
node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --verify-output
```

For Codex this path is commonly `C:\Users\<user>\.codex\plugins\cache\n8n-io\n8n-skills\<version>`. If repair fails, audit fails, or hook JSON output verification fails, do not approve the hooks; use the clear error message to install Git for Windows, update the plugin, or fall back to the upstream "Other platforms" route plus the target repo cue.

Restart the agent and approve or trust plugin hooks when prompted so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.

For OpenCode, Windows installs that cannot be repaired, and other platforms without proven official plugin parity, follow the upstream "Other platforms" route from the [official n8n Skills](https://github.com/n8n-io/skills) README when the target runtime supports it. From the target project folder, run:

```powershell
npx skills add n8n-io/skills
```

Compatibility varies by agent; check `skills.sh` support for the specific platform.

For Antigravity/AG2, use the observed plugin-scoped skill folder for both toolkit-owned skills and locally installed official n8n Skills. Do not stop after `npx skills add n8n-io/skills` if it writes to `$HOME\.agents\skills` or a loose `$HOME\.gemini\antigravity\skills` folder. Use official upstream `n8n-io/skills` content as the source, then place the whole official n8n skill folders under:

```text
C:\Users\<user>\.gemini\config\plugins\n8n-skills\skills\<skill-name>\SKILL.md
```

Keep `C:\Users\<user>\.gemini\config\plugins\n8n-skills\plugin.json` BOM-less UTF-8, use an `author` object such as `{ "name": "n8n-io" }`, and add `installed_version.json` beside it so the local plugin resembles Antigravity's installed multi-skill plugin shape.

Verify this path exists before relying on Antigravity to load the official entry point:

```text
C:\Users\<user>\.gemini\config\plugins\n8n-skills\skills\using-n8n-skills\SKILL.md
```

Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Local Antigravity plugin-scoped folder installs also do not include the official n8n plugin hooks, so add the current official entry-point cue to the target repo's `AGENTS.md`:

```text
This project uses n8n. When working with workflows, nodes, expressions, or
the n8n MCP tools, always start by loading the `using-n8n-skills` meta-skill
and follow its routing into the matching capability skill before acting.
```

The cue names the current [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`. If the upstream entry point changes, update this cue from the official README instead of inventing a local alias.

### Preferred Routes

| Platform | Toolkit-owned skill route | Location guidance | Notes |
|---|---|---|---|
| Codex | Native plugin package | `.codex-plugin/plugin.json` points to `./skills` and optional hooks. | Codex updates natively; it does not update Claude Code. |
| Claude Code | Native plugin package | `.claude-plugin/plugin.json` points to `./skills` and optional hooks. | Claude Code updates natively; it does not update Codex. |
| OpenCode | Opt-in local bridge target | `$HOME/.config/opencode/skills/ai-agent-toolkit/` after approval. | Autocheck may detect OpenCode; autosetup is forbidden. |
| AG2 | Opt-in local bridge target | `$HOME/.ai-agent-toolkit/current/adapters/ag2/` after approval. | Adapter metadata only; no Python packages are installed. |
| Antigravity | Plugin-scoped skill-folder install | See Antigravity path below. | Skill loading stays separate from repo-local bootstrap outputs. |

This repo does not commit package archives. Keep `_dist/`, `.zip`, and `.tgz` artifacts out of commits.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are secondary and not the beginner local setup path.

### Codex

For Codex, use the native Toolkit plugin package first. The generated manifest is [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json), and it points to the root `skills/` folder.

Direct whole-skill-folder install remains a manual fallback.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Repo-level | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
| Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

Codex scans repo skills from `.agents/skills` from the current working directory up to the repo root. It initially sees each skill's name, description, and file path, then loads the full `SKILL.md` only when selected. Use `/skills` or `$skill-name` for explicit invocation; implicit invocation depends on the `description` frontmatter. `~/.codex/config.toml` is for Codex configuration, including disabling skills by `SKILL.md` path, not the main skill install surface.

### Claude Code

For Claude Code, use the native Toolkit plugin package first. The generated manifest is [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json), and it points to the root `skills/` folder.

Direct whole-skill-folder install remains a manual fallback.

**Choose any one supported Claude Code skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project-level | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.claude/skills/<skill-name>/SKILL.md` |

Use `CLAUDE.md`, `CLAUDE.local.md`, or `.claude/rules/` for always-on Claude Code instructions.

### OpenCode

For OpenCode, use the opt-in Toolkit Local Bridge target when the user asks for setup. The bridge writes only the managed global skill folder:

```text
$HOME/.config/opencode/skills/ai-agent-toolkit/
```

Run a dry-run audit first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode
```

After explicit approval:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write
```

Manual whole-skill-folder install remains a fallback.

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

### AG2

AG2 is an opt-in local adapter target, not a native plugin marketplace.

Run a dry-run audit first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2
```

After explicit approval:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write
```

The bridge writes AG2 adapter metadata under the Toolkit Local Bridge Hub only. It does not install Python, AG2, or pip packages.

If AG2 is installed under a Python that is not on PATH, persist the reviewed command so future audits and hooks can reuse it:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --set-ag2-python-command "<python.exe>" --write
```

Audits list the selected AG2 Python command when detected, or the exact commands tried when AG2 is not detected.

### Antigravity

For Antigravity, use the observed plugin-scoped install first.

**Use the Antigravity plugin-scoped skill-folder location for toolkit skills:**

| Location type | Skill folder path |
|---|---|
| Plugin-scoped | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` |

Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder. This plugin-scoped folder is for loading toolkit skills.

**Put repo-local bootstrap outputs in the target repo, not inside the Antigravity plugin folder:**

1. `AGENTS.md`.
2. `GEMINI.md`.
3. `.agents/rules/00-agent-toolkit-bootstrap.md`.

Use `GEMINI.md` or the configured context file for always-on Antigravity instructions.

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
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "C:\Users\<user>\GitHub Projects\ai-agent-toolkit" --repo-branch main --enable-auto-sync --enable-target opencode --enable-target ag2 --write
```

After this is enabled, Codex and Claude Code Toolkit plugin SessionStart hooks use the configured local repo as source of truth: they validate the repo, fetch the configured branch, fast-forward only, run hook-light validation, and then sync enabled bridge targets from the updated repo script. The hook path does not run full `npm run validate:all`; run that manually before broad maintenance or release work.

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

## Antigravity Setup

Use:

- [Antigravity reference](../../skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Antigravity GEMINI shim template](../../skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md)
- [Antigravity bootstrap template](../../skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Antigravity n8n adapter](../../skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

Antigravity [official n8n Skills](https://github.com/n8n-io/skills) support is platform-dependent; the official instance-level MCP setup is secondary and not part of the beginner local setup path.

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
