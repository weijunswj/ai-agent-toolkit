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
10. The Toolkit Local Bridge Hub under the user profile stores generated OpenCode and Antigravity 2 adapter state. It is not source of truth.

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
- Antigravity 2 plugin-scoped local adapter skills under the Gemini config plugin root.

OpenCode and Antigravity 2 are opt-in. The bridge may detect them during audit or hook autocheck, but it must not write target files until the user explicitly enables that target.

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
- Managed Toolkit skill payload metadata, including the current Toolkit skill names written to non-native targets.
- Source commit or `unknown` when Git metadata is unavailable.
- Sync source: `repo`, `codex-plugin`, or `claude-plugin`.
- Sync timestamp.
- Repo auto-update state: `repo_auto_update_enabled`, `repo_path`, `repo_branch`, `repo_remote`, `last_repo_update`, `last_repo_update_status`, `last_repo_update_from_commit`, `last_repo_update_to_commit`, and `last_repo_update_error`.
- Update-report state: `last_update_report_path` and `update_report_open_enabled`.
- Codex plugin cache auto-refresh preference: `codex_plugin_auto_refresh_enabled`.
- Target paths.
- Target detected, enabled, disabled, stale, and synced state.

The lock file lives beside the hub at `%USERPROFILE%\.ai-agent-toolkit\update.lock` or `~/.ai-agent-toolkit/update.lock`.

Writes are atomic:

1. Write a staging directory.
2. Validate staged `manifest.json`, `state.json`, OpenCode adapter output, and Antigravity 2 adapter output.
3. Rename staging into `current`.
4. For OpenCode target sync, write into the OpenCode `skills/` root and atomically replace only Toolkit-managed skill folders.
5. For Antigravity 2 target sync, write into the local `ai-agent-toolkit` plugin root and atomically replace only Toolkit-managed skill folders under that plugin's `skills/` directory.
6. Remove only skill folders listed in the previous Toolkit-managed target manifest when they are no longer part of the current Toolkit skill set. Preserve unrelated user-created skills and unrelated files.

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
- `--open-update-report`.
- `--enable-update-report-open`.
- `--disable-update-report-open`.
- `--enable-codex-plugin-auto-refresh`.
- `--disable-codex-plugin-auto-refresh`.
- `--force-downgrade`.
- `--python-command <command>`.
- `--set-ag2-python-command <command>`.
- `--sync-source repo|codex-plugin|claude-plugin`.

The updater must not:

- Install npm, pip, Python, Antigravity 2, OpenCode, Codex, or Claude Code.
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

For `setup toolkit` or `refresh toolkit` in Codex, agents must run the full script-backed journey even when Toolkit is already installed:

```powershell
node repo/scripts/setup-toolkit.cjs --execute
```

The orchestrator performs only the minimal repo update check first, then runs the required steps to verify and refresh the Codex native Toolkit plugin cache before repo validation, bridge setup, repo auto-update enablement, or target sync. Do not shortcut already-installed Toolkit refreshes to plugin verification only; the full journey is required so stale repo, plugin-cache, bridge-state, report, and target-sync pieces are detected and patched in order. If it pauses before repo-backed auto-update, ask the user before rerunning with `--write-repo-auto-update`; then ask the bolded update-report auto-open preference before target writes, rerunning with either `--enable-update-report-open` or `--skip-update-report-open`; then ask the bolded Codex plugin auto-refresh preference, rerunning with either `--enable-codex-plugin-auto-refresh` or `--skip-codex-plugin-auto-refresh`; ask separately before adding any `--enable-target opencode` or `--enable-target ag2` target writes. If an installed stale `toolkit-setup` skill says to run the full `repo/tests/toolkit-local-bridge.test.cjs` suite during routine setup, override it with root `AGENTS.md` and this document. Routine setup uses `repo/tests/toolkit-local-bridge-hook-light.test.cjs`; the full bridge suite is for bridge changes, PR review, or release validation.

Before reporting `setup toolkit` complete, run:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

If the plugin is missing, disabled, stale, points at another source path, has same-version cache content that does not match this repo, or its installed plugin cache does not contain Toolkit version `2.2.0` with `.codex-plugin/hooks/hooks.json` and a Codex `SessionStart` hook, install or update it with:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --write
```

The verifier uses only supported Codex plugin commands. If no usable Codex CLI with `plugin marketplace` support is available, or if local marketplace installation fails, setup must fail clearly instead of pretending native plugin activation completed.

The setup helper checks `codex plugin list --available --json` after `codex plugin marketplace add` before invoking `codex plugin add`. CLI list verification remains the preferred path. If the CLI list is empty or unreliable, the helper may use config/cache fallback verification only when Codex config enables `[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]`, Codex config includes `[marketplaces.ai-agent-toolkit-local]` with `path` or `source` resolving to this repo root, optional `source_type` or `type` is absent or `local`, the installed cache exists under the Codex home plugin cache at `plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/2.2.0`, the cache manifest has the expected Toolkit name/version, and the cache hook file contains the Toolkit `SessionStart` hook. The fallback normalizes Windows paths and strips a leading `\\?\` before comparing the marketplace source path. Report this as config/cache fallback verification, not normal CLI verification.

If an installed same-version cache is stale, the helper removes `ai-agent-toolkit@ai-agent-toolkit-local` before reinstalling from the local marketplace. If plugin add is needed, the helper starts `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json` and polls `codex plugin list --available --json` plus the expected cache until verification passes. Treat setup as successful only when the verifier confirms enabled Toolkit version `2.2.0`, `authPolicy` `ON_USE` when available from the CLI list, the cached `SessionStart` hook, and package-critical cache files matching this repo; terminate or ignore a lingering add process and emit a warning when `codex plugin add` did not exit cleanly. If CLI and fallback verification never pass before the add deadline, report setup failure.

After install, update, or verify, the helper prints or returns a `**Next Steps:**` section. It tells the user to restart Codex if installation changed anything, open Codex hook review when prompted, and trust the Codex `SessionStart` hook only if it runs:

```powershell
node ".../repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin
```

If no hook prompt appears, report whether hook trust is already recorded, still pending, or likely waiting for Codex to refresh plugin hooks. This hook approval step applies to Codex only. Claude Code does not need Codex hook approval. Codex must not install or update Claude Code, and Claude Code must not install or update Codex.

After a fresh Codex plugin install or update, the user must manually approve or trust the startup hook when Codex prompts. Verification can confirm the installed cache contains a `SessionStart` hook, but it cannot approve that hook on the user's behalf.

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
- Package-critical cache files match the local repo, including Codex plugin metadata, Toolkit bridge/setup scripts, hook-light validation test, assets, and `skills/`.

## Repo-Backed Auto-Update

Repo auto-update is opt-in and uses the configured local Toolkit Git repo as source of truth. Native Codex and Claude Code plugin hooks remain launchers only; they do not become source of truth and do not update each other.

Enable once from a trusted local Toolkit checkout:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "C:\Users\<user>\GitHub Projects\ai-agent-toolkit" --repo-branch main --enable-auto-sync --write
```

Use `--repo-remote <url>` only when intentionally testing or maintaining a non-default remote. The expected production remote is `https://github.com/weijunswj/ai-agent-toolkit`.

Release-branch auto-update consideration: the current default setup uses `main`. If the repo later adopts a stable `release` branch for user-facing Toolkit updates, configure `--repo-branch release` only after that branch exists and has a clear CI/merge policy. The bridge remains pull-on-session-start: GitHub pushes to the configured branch are picked up by the next native hook run or explicit `--repo-update-now`; the Toolkit does not run a GitHub webhook listener or background push daemon.

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
node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs
```

9. Checks whether the running Codex native plugin cache is stale against the configured repo source. When `codex_plugin_auto_refresh_enabled` is true, the trusted `main` hook refreshes the Codex Toolkit plugin cache through `repo/scripts/setup-codex-toolkit-plugin.cjs --write --json --repo-root <repo_path>` after repo validation and delegated target sync succeed. When the preference is false, it records a report reminder to enable auto-refresh in setup or run `setup toolkit` manually.
10. Delegates enabled-target sync to the freshly updated repo script with `--skip-repo-auto-update`.

The delegated repo script builds the target payload from the updated local Toolkit repo `skills/` tree plus the small `ai-agent-toolkit` adapter skill. It must not use Codex or Claude private plugin caches as the skill payload source.

The delegated command shape is:

```powershell
node <repo_path>/repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write --sync-source repo --hub <same-hub> --skip-repo-auto-update
```

The hook validation is intentionally lighter than `npm run validate:all` so SessionStart stays short. Run full validation manually before release, merge, or broad maintenance changes:

```powershell
npm run validate:all
node --test repo/tests/toolkit-local-bridge.test.cjs
```

Repo auto-update never runs `git pull`, merge commits, rebase, package installs, marketplace installs, Codex native plugin refresh/reinstall, credential writes, `n8n_live` actions, or arbitrary project-repo mutations. If validation, fetch, fast-forward, or delegation fails in hook mode, the hook prints a concise warning, records the last repo update status in hub state when possible, skips target sync, and exits successfully so agent startup is not blocked.

## Update Reports

When a hook run performs meaningful work or safely skips a risky update, the bridge writes a markdown report under the user temp directory:

```text
%TEMP%\ai-agent-toolkit\update-reports\toolkit-update-YYYYMMDD-HHMMSS.md
```

Meaningful work means at least one of:

- The configured Toolkit repo fast-forwarded.
- The configured Toolkit repo was already advanced before the hook run compared with the last recorded bridge update state. This is reported as an inference, likely from a manual pull or another local Git update, not as proof of a manual action.
- An enabled OpenCode or Antigravity 2 target was synced.
- A stale Toolkit-managed skill folder was removed from a managed target.
- Delegated repo sync failed.
- Hook-light validation failed after a repo update.
- Repo auto-update skipped safely because the branch did not match, the tree was dirty, the remote did not match, fetch failed, or the fetched commit was not a fast-forward.
- The Codex native plugin cache is stale relative to the configured repo source, was auto-refreshed, or failed auto-refresh.

Normal no-op hook runs with the same observed repo commit and no target sync, stale plugin cache, skip, or validation issue do not write or open a report. Meaningful reports are also deduplicated by event signature: if a later hook sees the same repo status, target-sync result, native plugin cache status, and checksum, it does not create or open another timestamped report. In hook mode, the bridge prints only:

```text
Toolkit updated: <report path>
```

The report starts with a short `TL;DR` section for repo status, target sync status, and any action needed. Details include the new and previous observed commits, sync source, Singapore time (`SGT`), a Repo Update section with configured branch and configured remote, changed files from the fast-forward or already-advanced observed range when available, synced target paths, copied/updated skill counts, removed stale managed skill folders, the explicit n8n/live-system skip note, repo update status, hook-light validation result, target sync status, Codex native plugin cache status when checked, checksum, and any warning/error. If auto-update skips because the local Toolkit repo is on the wrong branch, the report tells the user to switch the Toolkit repo back to `main`, then restart Codex or rerun setup/sync. For the default production configuration, this shows configured branch `main` and configured remote `https://github.com/weijunswj/ai-agent-toolkit` so users can see whether updates are coming from GitHub `main`. The latest report path is stored in hub state as `last_update_report_path` and appears in `--audit`.

For first-restart compatibility after a bridge update, an older installed native hook may fast-forward the configured local Toolkit repo and then delegate into the newly updated repo script without passing `--hook`. An unsuppressed delegated command with `--sync-enabled --write --sync-source repo --hub <same-hub> --skip-repo-auto-update` is report-eligible. When hub state contains `last_repo_update_from_commit`, `last_repo_update_to_commit`, and `last_repo_update_status`, the delegated repo script uses that stored metadata plus a local `git diff --name-only` over `repo_path` to populate the update report. New parent hooks pass `--suppress-update-report` to delegated sync so the parent hook remains the single report writer and duplicate reports are avoided.

Opening reports is opt-in. `--open-update-report` opens only the report created by the current run. `--enable-update-report-open` and `--disable-update-report-open` persist that preference in hub state. On Windows, opening uses only `notepad.exe <reportPath>` and only for files created under the Toolkit temp update-report folder. Opening is best-effort, non-blocking, and never uses OS default file associations, `.sh` files, or VS Code.

During `setup toolkit`, this preference is a required approval gate after repo-backed auto-update is configured and audited, and before OpenCode or Antigravity 2 target writes. The user-facing setup question must be bolded as `**Do you want Codex to open Toolkit update reports automatically after meaningful hook activity?**`. Rerun with `--enable-update-report-open` to opt in, or `--skip-update-report-open` to explicitly continue with reports left closed by default.

Codex plugin cache auto-refresh is also opt-in during setup. The user-facing setup question must be bolded as `**Do you want Codex to auto-refresh the Toolkit native plugin cache from this trusted main checkout when a startup hook detects it is stale?**`. Rerun with `--enable-codex-plugin-auto-refresh` to opt in, or `--skip-codex-plugin-auto-refresh` to keep stale Codex plugin cache refresh manual.

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
- Persisted bridge target state exists.

OpenCode target path:

- POSIX: `~/.config/opencode/skills/`.
- Windows: `%USERPROFILE%\.config\opencode\skills\`.

OpenCode loads one folder per skill under that root, for example `~/.config/opencode/skills/toolkit-setup/SKILL.md`. The bridge writes every current Toolkit skill folder plus the `ai-agent-toolkit` adapter skill there after the user explicitly enables OpenCode. Old bridge state that points at `skills/ai-agent-toolkit` is migrated to the parent `skills/` root.

The bridge intentionally does not use `.agents/skills` for OpenCode output, avoiding duplicate Codex skill discovery.

Antigravity 2 detection signals:

- Antigravity user config exists, such as `%USERPROFILE%\.antigravity`.
- Gemini/Antigravity plugin config exists, such as `%USERPROFILE%\.gemini\config` or `%USERPROFILE%\.gemini\config\plugins`.
- The managed Toolkit AG2 adapter exists under the Toolkit Local Bridge Hub.
- The managed Antigravity 2 plugin-scoped target exists under `%USERPROFILE%\.gemini\config\plugins\ai-agent-toolkit`.
- The user explicitly enabled the target.
- Persisted bridge target state exists, such as `target_path`, `synced_version`, `synced_checksum`, or `last_sync`.
- Saved AG2 Python command, when configured.
- Explicit `--python-command`, for one run.
- `python`, `python3`, and `py`.
- Safe read-only user-local candidates such as Windows user Python locations, `UV_PYTHON`, `VIRTUAL_ENV`, and `CONDA_PREFIX`.
- Optional package signal: a candidate Python command exists, returns a version, and `python -m pip show ag2` succeeds.

Antigravity 2 target path:

- POSIX: `~/.gemini/config/plugins/ai-agent-toolkit/`.
- Windows: `%USERPROFILE%\.gemini\config\plugins\ai-agent-toolkit\`.
- Required app-facing skills: every current Toolkit skill under `skills/<skill-name>/SKILL.md`, plus the `skills/ai-agent-toolkit/SKILL.md` adapter skill inside that plugin root.

Persist a known non-PATH Antigravity 2/AG2 Python command with:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --set-ag2-python-command "<python.exe>" --write
```

Future audit and hook runs reuse the saved command. If the Python `ag2` package is not detected, audit output must list the exact Python commands tried and keep `python_command` empty unless a command actually has the package. Detection must never install Python, AG2, Antigravity 2, OpenCode, npm packages, or pip packages.

Audit separates Antigravity 2 app/bridge relevance from the optional Python package signal:

- `detected` means the Antigravity 2 bridge target is present or relevant.
- `ag2_package_detected` means the Python package `ag2` was found.
- `python_command` is set only when `ag2_package_detected` is true.
- `signals.tried_python_commands` records package misses such as `Package(s) not found: ag2`.

Audit also separates internal hub metadata from app-facing target sync:

- `internal_adapter_path` points under the Toolkit Local Bridge Hub.
- `target_path` points at the app-facing OpenCode skills root or Antigravity 2 plugin root.
- `target_exists` reports whether the app-facing managed output files exist.
- `synced` is true only when the enabled target state and the real app-facing output match the current full Toolkit skill payload and no previously managed Toolkit skill folder is stale. Hub metadata alone is not enough.

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

Dry-run Antigravity 2 setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2
```

Apply Antigravity 2 setup:

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

OpenCode and Antigravity 2 do not need Codex or Claude hooks to receive core policy because the policy remains in portable docs, validators, and generated adapter content.

The packaged Toolkit hooks remain startup-only. The bridge uses `SessionStart` because update and sync work is most useful before the agent starts relying on local skills. Claude Code documents a `SessionEnd` event, but the Toolkit does not add a Claude-only exit hook because app exit hooks can be skipped or killed and Codex plugin `SessionEnd` support is not validated in this repo. Do not add unsupported hook event names such as `Stop` or `SessionEnd` to the packaged Codex or Claude plugin manifests without a current platform-supported, safe, fast implementation and matching tests.

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
- Mechanical validation logic: `repo/tests/toolkit-local-bridge-hook-light.test.cjs` for hook-light startup behavior, `repo/scripts/validate-toolkit.cjs`, and full manual bridge validation in `repo/tests/toolkit-local-bridge.test.cjs`.

Do not move exclusively into hooks:

- Source-of-truth policy.
- Approval gates.
- Generated-output ownership.
- OpenCode and Antigravity 2 opt-in requirement.
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
