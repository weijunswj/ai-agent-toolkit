# Toolkit Local Bridge V2

This document defines the v2 plugin/update architecture for `weijunswj/ai-agent-toolkit`.

## Current Source-Of-Truth Chain

Current inspected chain:

1. Root `AGENTS.md` routes repo work and includes the managed source-of-truth contract.
2. `_projects/**/_main/` stores full source material.
3. `_projects/**/curated_output_for_ai/` stores reviewed AI-facing adapters, routers, and metadata.
4. `_projects/**/toolkit.project.json` declares generated outputs and write boundaries.
5. `_projects/**/SOURCE-LOCK.json` records first-party or third-party provenance.
6. `repo/scripts/sync-toolkit-projects.cjs` publishes declared generated outputs.
7. `skills/**` is the generated copyable skill surface.
8. `repo/scripts/validate-toolkit.cjs`, `repo/tests/*.test.cjs`, package checks, source-lock audit, and published-surface audit enforce drift and safety rules.
9. `.codex-plugin/**` and `.claude-plugin/**` are v2 native plugin package metadata generated from the Toolkit project module. They are not source of truth.
10. The Toolkit Local Bridge Hub under the user profile stores generated OpenCode and AG2 adapter state. It is not source of truth.

## V2 Architecture

Codex and Claude Code update Toolkit through their own native plugin systems.

- Codex uses `.codex-plugin/plugin.json`.
- Claude Code uses `.claude-plugin/plugin.json`.
- Both native package manifests point at the same Toolkit `skills/` surface.
- Both native packages use hooks only for optional bridge autocheck and enabled-target auto-sync.
- Codex never installs or updates Claude Code.
- Claude Code never installs or updates Codex.
- Toolkit does not publish to public marketplaces from this repo. Marketplace-ready metadata is present in the manifests, but publication remains a separate human action.

The shared bridge manages only non-native local adapter targets:

- OpenCode global skills.
- AG2-style local adapter metadata.

OpenCode and AG2 are opt-in. The bridge may detect them during audit or hook autocheck, but it must not write target files until the user explicitly enables that target.

## Local Bridge Hub

Default hub paths:

| Platform | Path |
|---|---|
| POSIX | `~/.ai-agent-toolkit/current` |
| Windows | `%USERPROFILE%\.ai-agent-toolkit\current` |

The hub contains:

- `manifest.json`.
- `state.json`.
- `adapters/opencode/**`.
- `adapters/ag2/**`.
- Version and checksum data.
- Source commit or `unknown` when Git metadata is unavailable.
- Sync source: `repo`, `codex-plugin`, or `claude-plugin`.
- Sync timestamp.
- Repo auto-update state: `repo_auto_update_enabled`, `repo_path`, `repo_branch`, `repo_remote`, `last_repo_update`, `last_repo_update_status`, `last_repo_update_from_commit`, `last_repo_update_to_commit`, and `last_repo_update_error`.
- Target paths.
- Target detected, enabled, disabled, stale, and synced state.

The lock file lives beside the hub at `%USERPROFILE%\.ai-agent-toolkit\update.lock` or `~/.ai-agent-toolkit/update.lock`.

Writes are atomic:

1. Write a staging directory.
2. Validate staged `manifest.json`, `state.json`, OpenCode adapter output, and AG2 adapter output.
3. Rename staging into `current`.
4. For OpenCode target sync, stage the `ai-agent-toolkit` skill folder beside the target and atomically replace only that managed folder.

Fresh locks cause a safe skip. Stale locks are removed before retry. Older bridge versions refuse to overwrite newer hub state unless `--force-downgrade` is supplied for explicit manual recovery.

## Shared Updater

The canonical updater is [toolkit-local-bridge.cjs](../scripts/toolkit-local-bridge.cjs).

Dry-run is default:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Write mode requires explicit `--write`:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
```

Supported flags:

- `--enable-target opencode`.
- `--enable-target ag2`.
- `--disable-target opencode`.
- `--disable-target ag2`.
- `--sync-enabled`.
- `--enable-auto-sync`.
- `--disable-auto-sync`.
- `--enable-repo-auto-update`.
- `--disable-repo-auto-update`.
- `--repo-path <path>`.
- `--repo-branch <branch>`, default `main`.
- `--repo-remote <url>`, default `https://github.com/weijunswj/ai-agent-toolkit`.
- `--repo-update-now`.
- `--audit`.
- `--force-downgrade`.
- `--sync-source repo|codex-plugin|claude-plugin`.

The updater must not:

- Install npm, pip, Python, AG2, OpenCode, Codex, or Claude Code.
- Manage Codex plugin installation or update.
- Manage Claude Code plugin installation or update.
- Mutate project repositories by default.
- Write outside the current user home or temp directories.
- Use Codex or Claude private plugin cache paths as source.

## Codex Native Plugin Install And Verification

Codex native plugin installation is Codex-only and separate from the shared bridge updater. The supported local install path uses Codex local marketplaces:

```powershell
codex plugin marketplace add "<local-ai-agent-toolkit-repo>" --json
codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json
```

The local marketplace wrapper lives at `.agents/plugins/marketplace.json` and exposes this repo root as `ai-agent-toolkit@ai-agent-toolkit-local`. The plugin package manifest remains `.codex-plugin/plugin.json`. The wrapper must use `policy.authentication: "ON_USE"`, not `ON_INSTALL`, so a no-auth local Toolkit plugin can install headlessly before any hook trust prompt.

Before reporting `setup toolkit` complete, run:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

If the plugin is missing, disabled, stale, points at another source path, or its installed plugin cache does not contain Toolkit version `2.2.0` with `.codex-plugin/hooks/hooks.json` and a Codex `SessionStart` hook, install or update it with:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --write
```

The verifier uses only supported Codex plugin commands. If no usable Codex CLI with `plugin marketplace` support is available, or if local marketplace installation fails, setup must fail clearly instead of pretending native plugin activation completed.

The setup helper checks `codex plugin list --available --json` after `codex plugin marketplace add` before invoking `codex plugin add`. If plugin add is needed, the helper starts `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json` and polls `codex plugin list --available --json` plus the expected cache until verification passes. Treat setup as successful only when the verifier confirms enabled Toolkit version `2.2.0`, `authPolicy` `ON_USE`, and the cached `SessionStart` hook; terminate or ignore a lingering add process and emit a warning when `codex plugin add` did not exit cleanly. If verification never passes before the add deadline, report setup failure.

Codex setup must never install or update Claude Code. Claude Code uses its own native plugin system and `.claude-plugin/plugin.json`.

### Manual Isolated CODEX_HOME Acceptance

Before merging changes that affect Codex local plugin install, run this smoke test with a fresh isolated Codex home. In the example, `CODEX_HOME=<temp>` means a newly created temporary directory, not the user's normal Codex home.

```powershell
$env:CODEX_HOME = "<temp>"
node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json
codex plugin list --available --json
```

Acceptance criteria:

- `node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json` exits successfully. If the underlying `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json` process keeps running after verification passes, setup output includes a warning that the command did not exit cleanly.
- `codex plugin list --available --json` shows `ai-agent-toolkit@ai-agent-toolkit-local` installed and enabled with `authPolicy` `ON_USE`.
- The final cache exists at `CODEX_HOME/plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/2.2.0`.
- The final cache `.codex-plugin/plugin.json` reports version `2.2.0`.
- The final cache `.codex-plugin/hooks/hooks.json` includes a `SessionStart` hook.

## Repo-Backed Auto-Update

Repo auto-update is opt-in and uses the configured local Toolkit Git repo as source of truth. Native Codex and Claude Code plugin hooks remain launchers only; they do not become source of truth and do not update each other.

Enable once from a trusted local Toolkit checkout:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "C:\Users\<user>\GitHub Projects\ai-agent-toolkit" --repo-branch main --enable-auto-sync --enable-target opencode --enable-target ag2 --write
```

Use `--repo-remote <url>` only when intentionally testing or maintaining a non-default remote. The expected production remote is `https://github.com/weijunswj/ai-agent-toolkit`.

When a native SessionStart hook runs and repo auto-update is enabled, the bridge:

1. Acquires the Toolkit bridge lock.
2. Validates `repo_path` exists and is a Git worktree.
3. Validates the current branch matches `repo_branch`.
4. Validates `origin` matches `repo_remote`.
5. Refuses to continue when the working tree is dirty.
6. Fetches `origin <repo_branch>`.
7. Updates only with `git merge --ff-only FETCH_HEAD`.
8. Runs hook-light validation:

```powershell
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/toolkit-local-bridge.test.cjs
```

9. Delegates enabled-target sync to the freshly updated repo script with `--skip-repo-auto-update`.

The delegated command shape is:

```powershell
node <repo_path>/repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write --sync-source repo --hub <same-hub> --skip-repo-auto-update
```

The hook validation is intentionally lighter than `npm run validate:all` so SessionStart stays short. Run full validation manually before release, merge, or broad maintenance changes:

```powershell
npm run validate:all
```

Repo auto-update never runs `git pull`, merge commits, rebase, package installs, marketplace installs, credential writes, `n8n_live` actions, or arbitrary project-repo mutations. If validation, fetch, fast-forward, or delegation fails in hook mode, the hook prints a concise warning, records the last repo update status in hub state when possible, skips target sync, and exits successfully so agent startup is not blocked.

## Windows Codex Plugin Hook Repair

Windows hook repair is a separate post-install maintenance utility, not part of the Local Bridge updater. Use [repair-codex-plugin-windows-hooks.cjs](../scripts/repair-codex-plugin-windows-hooks.cjs) after a requested Codex plugin install or update when an installed plugin root contains `hooks/hooks.json`.

The repair utility:

- Parses the installed plugin's `hooks/hooks.json` as JSON.
- Rewrites generic `.sh` hook commands to `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.ps1" "<relative-hook-script>"`.
- Writes a Toolkit-managed `hooks/run-hook.ps1` wrapper that invokes explicit Git Bash from `C:\Program Files\Git\bin\bash.exe` or `C:\Program Files\Git\usr\bin\bash.exe`.
- Rejects bare `bash`, `bash.exe`, and `C:\WINDOWS\system32\bash.exe` when the command cannot be safely normalized.
- Applies the n8n-specific Node JSON fallback patch for `n8n-skills@n8n-io`.
- Fails with an actionable error when a hook cannot be repaired safely.

Example:

```powershell
node repo/scripts/repair-codex-plugin-windows-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --write --plugin-id n8n-skills@n8n-io
node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --verify-output
```

This utility may repair the installed plugin root named by the user or install flow. The audit command verifies repaired hook JSON output before hook approval. It must not use private plugin cache paths as source for Toolkit publishing, copy third-party plugin content into this repo, touch `n8n_live` MCP config, or modify unrelated plugins except when the current install/update flow explicitly targets that plugin root for generic Windows hook wrapping.

## Target Discovery

OpenCode detection signals:

- `opencode --version` succeeds.
- `OPENCODE_CONFIG_DIR` is set.
- `~/.config/opencode` or an explicit OpenCode config dir exists.
- The managed OpenCode target exists.
- The user explicitly enabled the target.

OpenCode target path:

- POSIX: `~/.config/opencode/skills/ai-agent-toolkit/`.
- Windows: `%USERPROFILE%\.config\opencode\skills\ai-agent-toolkit\`.

The bridge intentionally does not use `.agents/skills` for OpenCode output, avoiding duplicate Codex skill discovery.

AG2 detection signals:

- Python command exists and returns a version.
- `python -m pip show ag2` succeeds.
- The user explicitly enabled the target.

AG2 output stays under the Toolkit Local Bridge Hub. The bridge does not install AG2 or Python packages.

## Auto-Check, Auto-Setup, And Auto-Sync

Autocheck is allowed. Autosetup is forbidden.

- Detected but never-enabled target: no target writes.
- Not detected and never-enabled target: skip.
- Enabled target: sync only that target when stale.
- Explicitly disabled target: never touch.
- Auto-sync enabled: native hooks may sync enabled stale targets.
- Auto-sync disabled: hooks may print a concise reminder or do nothing.

## Setup Command Surface

The bridge is Toolkit setup and maintenance infrastructure. It may have one compact `toolkit-setup` discoverability skill, but it must not become a family of reusable command skills.

Audit:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Dry-run OpenCode setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode
```

Apply OpenCode setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write
```

Dry-run AG2 setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2
```

Apply AG2 setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write
```

Sync enabled targets:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
```

Disable a target:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
node repo/scripts/toolkit-local-bridge.cjs --disable-target ag2 --write
```

Do not add one bridge skill per command. Keep `toolkit-setup` as the only bridge/setup discoverability skill, and keep setup guidance in this doc, the updater help, validators, and tests.

## Hook Policy

Hooks are optional automation. They must not contain unique critical policy.

The v2 hooks only call the shared updater:

- Codex hook source: `.codex-plugin/hooks/hooks.json`.
- Claude Code hook source: `.claude-plugin/hooks/hooks.json`.
- Shared policy source: this doc, `AGENTS.md`, Toolkit docs, and validators.
- Deterministic enforcement: `repo/scripts/toolkit-local-bridge.cjs` and tests.

OpenCode and AG2 do not need Codex or Claude hooks to receive core policy because the policy remains in portable docs, validators, and generated adapter content.

## Portable Policy-First Layering

Layering:

1. `AGENTS.md` is compact cross-platform context and routing.
2. Portable skills and docs contain detailed cross-platform workflows; bridge setup specifics stay in docs and the shared updater.
3. Validators and schema checks enforce deterministic rules where practical.
4. Hooks provide optional native automation around validators and the shared updater.

Rules that affect agent judgement must remain available outside hooks. Deterministic rules should be script-validated where practical. Hooks should call those scripts.

## AGENTS.md Slimming Plan

Keep in root `AGENTS.md`:

- Instruction priority and repo routing.
- Compact source-of-truth hierarchy.
- Compact native plugin/update architecture summary.
- Approval and user/global write safety rules.
- Generated-output rule.
- Skill routing rules and pointers.
- Validation and final report expectations.

Move or mirror outside root `AGENTS.md`:

- Long bridge setup procedures: this doc and the shared updater help.
- Exact bridge state schema: updater validation and tests.
- Exact command implementations: [toolkit-local-bridge.cjs](../scripts/toolkit-local-bridge.cjs).
- Hook behavior details: this doc, plugin hook manifests, and tests.
- Mechanical validation logic: `repo/tests/toolkit-local-bridge.test.cjs` and `repo/scripts/validate-toolkit.cjs`.

Do not move exclusively into hooks:

- Source-of-truth policy.
- Approval gates.
- Generated-output ownership.
- OpenCode and AG2 opt-in requirement.
- Native plugin cross-update prohibition.
- No package installs by default.
- No project repo mutation by default.

Root `AGENTS.md` changed in this PR only to add compact v2 architecture context and synced source-of-truth wording. No critical shared policy exists only in hooks.

## Disable And Rollback

Disable auto-sync:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-auto-sync --write
```

Disable a target without deleting files:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
node repo/scripts/toolkit-local-bridge.cjs --disable-target ag2 --write
```

The bridge does not delete user files unless a separate future command explicitly asks for deletion and the user approves it.
