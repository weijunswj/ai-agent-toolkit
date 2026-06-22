---
name: toolkit-setup
description: Use when the user says "setup toolkit" or asks about AI Agent Toolkit plugin setup, Toolkit Local Bridge setup or troubleshooting, repo-backed Toolkit auto-update, OpenCode bridge support, Antigravity 2 adapter support, bridge audit, enabled-target sync, disable, stale bridge state, native Codex or Claude Code plugin update behavior, or bridge setup safety. Routes agents to the Toolkit setup subsystem and repo/scripts/toolkit-local-bridge.cjs; do not use for ordinary project coding, unrelated n8n setup, or as a command-per-bridge workflow.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.toolkit-local-bridge
Source: _projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this skill as a compact setup router. Do not duplicate the bridge implementation, command-per-target procedures, or hook policy here.
-->

# Toolkit Setup

Use this skill as a discoverability router for Toolkit plugin and local bridge setup work.

Bridge setup, repo auto-update, sync, audit, disable, Windows plugin hook repair, and troubleshooting are Toolkit setup infrastructure. The bridge implementation lives in `repo/scripts/toolkit-local-bridge.cjs`; Codex native plugin verification/install lives in `repo/scripts/setup-codex-toolkit-plugin.cjs`; Codex plugin hook repair lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`; detailed policy lives in `repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md`, `repo/docs/HOW-TO-USE.md`, `AGENTS.md`, validators, and tests.

## Required Route

1. Inspect the local repo context and read `repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md` before changing bridge behavior or running write commands.
2. For the English prompt `setup toolkit`, run the end-to-end setup journey below instead of stopping at a generic audit.
3. Start other bridge requests with a dry-run or audit command, usually:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

4. Use `repo/scripts/setup-codex-toolkit-plugin.cjs` only for Codex native plugin install/update verification. Use `repo/scripts/toolkit-local-bridge.cjs` for bridge setup, repo auto-update enablement, sync, audit, disable, stale-state recovery, and troubleshooting. Use `repo/scripts/repair-codex-plugin-windows-hooks.cjs` only for post-install Windows hook audit/repair of an installed Codex plugin root. Do not invent a new command family or duplicate the updater logic in the skill.
5. Before final response after repo changes, run the relevant validators or tests for the touched surface.

## English Setup Journey

When the user says `setup toolkit`, complete this Codex-focused flow:

1. Validate the trusted local Toolkit repo on `main` before configuring anything:

```powershell
git status --short
git switch main
git fetch origin main
git merge --ff-only origin/main
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/toolkit-local-bridge.test.cjs
```

Stop if the repo is dirty, not on the expected remote, cannot fast-forward, or validation fails.

2. Verify the Toolkit Codex native plugin is already installed, active, current, and sourced from this local repo:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

If verification reports the plugin is missing, disabled, stale, has the wrong source path, or lacks a valid installed plugin cache, install or update it through the supported Codex local marketplace path:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --write
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

The local marketplace wrapper is `.agents/plugins/marketplace.json`; it exposes this repo root as `ai-agent-toolkit@ai-agent-toolkit-local`, uses `policy.authentication: "ON_USE"` so install can complete headlessly, and the package manifest is `.codex-plugin/plugin.json`. `setup-codex-toolkit-plugin.cjs --write` runs the supported Codex local marketplace path, checks plugin state after marketplace add before invoking plugin add, and verifies the final result. If plugin add is needed, the setup helper starts `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json`, polls `codex plugin list --available --json` plus the expected cache until verification passes, then terminates or ignores the lingering add process if it has not exited. Treat setup as successful only when final verification passes, with a warning if plugin add did not exit cleanly.

Normal verification prefers `codex plugin list --available --json`. If that CLI list is empty or unreliable, the setup helper may use the conservative config/cache fallback only when Codex config enables `[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]`, Codex config includes `[marketplaces.ai-agent-toolkit-local]` with `path` or `source` resolving to this repo root, optional `source_type` or `type` is absent or `local`, the installed cache exists under the Codex home plugin cache at `plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/2.2.0`, the cache manifest has the expected name/version, and the cache hook file contains the Toolkit `SessionStart` hook. The fallback normalizes Windows paths and strips a leading `\\?\` before comparing the marketplace source path. Report fallback success as config/cache fallback verification, not normal CLI verification.

After every install, update, or verify, read the helper's `**Next Steps:**` section. It tells the user to restart Codex if anything changed, open Codex hook review when prompted, and trust the Codex `SessionStart` hook only if it runs `node ".../repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin`. If no hook prompt appears, report whether hook trust is already recorded, still pending, or likely waiting for Codex to refresh plugin hooks. After a fresh install or update, tell the user they must manually approve the startup hook when Codex prompts; setup cannot approve it for them. This hook approval step applies to Codex only; Claude Code does not need Codex hook approval. Do not use Codex to install or update Claude Code. Codex must not install or update Claude Code, and Claude Code must not install or update Codex.

Verification must confirm the installed plugin cache contains Toolkit version `2.2.0` and `.codex-plugin/hooks/hooks.json` includes the Codex `SessionStart` hook. If Codex local marketplace install is unsupported, the verifier cannot find a usable Codex CLI, CLI/fallback verification fails, or verification never passes before the add deadline, fail clearly instead of pretending setup completed.

3. Configure repo-backed auto-update from this local repo without enabling OpenCode or Antigravity 2 yet:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "<local-ai-agent-toolkit-repo>" --repo-branch main --enable-auto-sync --write
```

4. Audit OpenCode and Antigravity 2, then explain the detected targets, enabled state, app-facing target paths, internal hub adapter paths, app target existence, synced state, planned writes, Antigravity 2 bridge-detection signals, and optional AG2 Python package discovery result:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

OpenCode detection should mention useful signals such as the `opencode` command, `OPENCODE_CONFIG_DIR` or `~/.config/opencode`, an existing managed target folder, and persisted bridge target state. Antigravity 2 detection and Python `ag2` package detection are separate: Antigravity 2 may be detected from `%USERPROFILE%\.antigravity`, `%USERPROFILE%\.gemini\config`, `%USERPROFILE%\.gemini\config\plugins`, an existing Toolkit hub adapter, an existing `%USERPROFILE%\.gemini\config\plugins\ai-agent-toolkit` plugin target, explicit enablement, or persisted bridge state even when the Python package is absent. The audit should report `ag2_package_detected` separately, keep `python_command` empty unless the package is found, and include the exact Python commands tried plus package misses such as `Package(s) not found: ag2`. If the user provides a non-PATH AG2 Python for package-specific workflows, persist it with `--set-ag2-python-command "<python.exe>" --write` so future audits and hooks can reuse it.

5. Ask once before non-native target writes. The approval question must name OpenCode and Antigravity 2 and state that enabling them writes only Toolkit-managed user-local bridge output into the app-facing target: OpenCode uses `~/.config/opencode/skills/ai-agent-toolkit`, and Antigravity 2 uses `~/.gemini/config/plugins/ai-agent-toolkit` with `skills/ai-agent-toolkit/SKILL.md` inside that plugin root. If OpenCode or Antigravity 2 is not detected, explain that either can be enabled later with `node repo/scripts/toolkit-local-bridge.cjs --enable-target <target> --write`. Never silently enable OpenCode or Antigravity 2.
6. If approved, enable only the approved targets and run a sync test. Include `--set-ag2-python-command "<python.exe>"` in the approved write command only when the user supplied or selected that AG2 Python command:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --enable-target ag2 --write
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
node repo/scripts/toolkit-local-bridge.cjs --audit
```

7. Confirm future Codex `SessionStart` hooks will use the configured repo-backed updater: validate repo path, branch, remote, clean tree, `git fetch origin main`, `git merge --ff-only FETCH_HEAD`, hook-light validation, and enabled-target sync from the freshly updated repo.

## Safety Rules

- Dry-run first.
- OpenCode and Antigravity 2 are opt-in only.
- Detection is allowed; autosetup is forbidden.
- Sync only enabled targets.
- Disabled or never-enabled targets must not be touched.
- Audit `synced` means the real app-facing target output matches the current Toolkit payload. Internal hub metadata alone is not synced.
- The Python `ag2` package is optional for package-specific AG2 workflows; it is not required for Toolkit-managed Antigravity 2 bridge metadata or plugin-scoped skill sync.
- Repo auto-update is opt-in only and must validate the configured Toolkit repo, expected remote, clean tree, fast-forward update, and hook-light validation before enabled-target sync.
- Do not run npm, pip, package installs, or dependency installers from this skill. The only allowed marketplace operation in this flow is the Codex-only local Toolkit plugin install/update path through `setup-codex-toolkit-plugin.cjs --write` or the equivalent `codex plugin marketplace add "<local-ai-agent-toolkit-repo>" --json` plus `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json` commands.
- After a requested Codex plugin install or update on Windows, repair that installed plugin root before approving hooks. If repair cannot make hooks safe, fail with the repair error instead of reporting success.
- Do not mutate arbitrary project repos by default.
- Do not use Codex to update Claude Code or Claude Code to update Codex.
- Refuse downgrade unless the user explicitly requests `--force-downgrade` for recovery.
- Keep hooks optional and policy-light; critical policy must stay in docs, validators, and the shared updater.

## Validation

For bridge or setup-surface changes, prefer targeted checks first:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node --test repo/tests/toolkit-local-bridge.test.cjs
node repo/scripts/validate-toolkit.cjs
```

Run `npm run validate:all` when the change affects generated outputs, manifests, packaging, workflow policy, or broad validation.
