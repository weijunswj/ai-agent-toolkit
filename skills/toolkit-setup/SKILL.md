---
name: toolkit-setup
description: Use when the user says "setup toolkit" or "refresh toolkit", or when the task is clearly about AI Agent Toolkit plugin setup/update state, Toolkit Local Bridge setup or troubleshooting, repo-backed auto-update, bridge audit/sync/disable, OpenCode or Antigravity 2 opt-in bridge support, native Codex or Claude Code plugin behavior, Windows hook repair, or bridge setup safety. Route to the Toolkit setup subsystem and repo/scripts/toolkit-local-bridge.cjs; do not use for ordinary project coding or unrelated n8n setup.
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

Run this routine with the root agent alone. `setup toolkit` is ordinary interactive setup; do not spawn subagents to inspect instructions, documentation, repository or host state, setup choices, or validation output.

Bridge setup, repo auto-update, sync, audit, disable, Windows plugin hook repair, and troubleshooting are Toolkit setup infrastructure. The bridge implementation lives in `repo/scripts/toolkit-local-bridge.cjs`; Codex native plugin verification/install lives in `repo/scripts/setup-codex-toolkit-plugin.cjs`; Codex plugin hook repair lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`; Claude Code native plugin metadata lives under `.claude-plugin/`; detailed policy lives in `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`, `repo/docs/HOW-TO-USE.md`, `AGENTS.md`, validators, and tests.

## Platform Split

- Codex native plugin install/update is Codex-only. Codex may verify or refresh only the Codex Toolkit native plugin cache. On Windows, the same opt-in may also repair unsafe installed third-party Codex plugin hook launchers after plugin updates.
- Claude Code native plugin install/update is Claude Code-only. The setup orchestrator verifies `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json`; use Claude Code's native Toolkit plugin flow when Claude Code reports the package is missing, stale, disabled, or untrusted.
- The shared bridge is platform-neutral. After the native Toolkit package is installed in Codex or Claude Code, use `repo/scripts/toolkit-local-bridge.cjs` for repo auto-update, audit, OpenCode sync, and Antigravity 2 sync.
- Hook approval differs by host. Codex setup must explain Codex hook trust; Claude Code setup must follow Claude Code's own native plugin/hook review behavior and should confirm the hook uses `--sync-source claude-plugin`.
- Codex setup may prepare only explicitly approved `agents.max_threads` and `agents.max_depth` values in `CODEX_HOME/config.toml`, using the official app-server editor in an isolated temporary home plus structural TOML validation. Claude Code and OpenCode receive the portable single-agent policy but no invented host-level enforcement.

## Required Route

1. Inspect the local repo context and read `repo/docs/TOOLKIT-LOCAL-BRIDGE.md` before changing bridge behavior or running write commands.
2. For English prompts such as `setup toolkit`, `refresh toolkit`, or plain `refresh` in a Toolkit setup/update context, use the host-aware setup orchestrator from the managed checkout whenever it exists. Do not use the active repo worktree command as the canonical route.

```powershell
node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main
```

```sh
node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main
```

The orchestrator discovers current state, shows one consolidated upfront setup question bank, pauses before preference or target writes, then runs to completion unless a real safety blocker appears.

If the setup command exits with code `23` or prints that the setup question bank requires answers, treat that as an intentional pause for user input, not a setup failure. Stop and present the question bank choices to the user in chat when the shell is non-interactive. Do not guess or infer. Do not rerun with `--yes-recommended` unless the user explicitly asked to use recommended/default choices in the current turn.

It must show this explanation:

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

Default managed source checkout:

- Windows: `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit`
- POSIX: `~/.ai-agent-toolkit/source/ai-agent-toolkit`

The managed checkout is separate from the active Codex or Claude Code worktree, plugin caches, `.tmp` directories, and temporary marketplace checkouts. If the active Toolkit worktree is on a PR branch, setup should warn that this is okay and continue using the managed clean `main` checkout.

If the managed checkout path does not yet exist or does not contain `repo/scripts/setup-toolkit.cjs`, the active repo command is bootstrap/fallback only:

```powershell
node repo/scripts/setup-toolkit.cjs --execute --profile auto-main
```

When fallback/bootstrap is used, say that it is bootstrap-only. After the managed checkout exists, hand off to the managed checkout script above and use that script for the question bank, setup writes, and verification. In Claude Code, append `--host claude-code` to the managed or fallback setup command. If the managed setup script exists but exits for question-bank pause or a real safety blocker, do not fall back to the active repo command; stop and report the pause or blocker. Do not run an active stale verifier after managed setup; verify from the same managed checkout script/repo that performed setup.

3. The one setup question bank must show current state, recommended default, and choices for every setup decision before writes:

- Managed checkout: detected/current path, default path, and keep current / use default managed main checkout / explicit custom path.
- Repo-backed auto-update: current enabled/disabled state and keep current / enable / disable.
- Update report writes: current enabled/disabled state and keep current / enable / disable.
- Update report auto-open: current enabled/disabled state and keep current / enable / disable. Do not write `update_report_open_enabled=false` unless the user explicitly chooses disable or passes an explicit disable flag.
- Update report/log retention: current days, default 7, and keep current / use default 7 / custom positive integer.
- Codex plugin cache auto-refresh on Codex only: current enabled/disabled state and keep current / enable / disable. When enabled on Windows, trusted Toolkit hooks may also repair unsafe installed third-party Codex plugin hook launchers and report the result.
- Codex delegation control on Codex only: current configured/conflicting state and keep current / limit / skip. Until native UAT is recorded, the recommendation and empty-input choice are `keep`, and `--yes-recommended` also keeps delegation configuration unchanged. Only explicit interactive `limit` or `--codex-delegation-control limit` approval may preview, back up, and write `agents.max_threads = 1` and `agents.max_depth = 1` through the official Codex config editor.
- Claude Code plugin behavior on Claude Code only: verify/report only, no Codex mutation, and keep manual/check-only behavior / show native refresh instructions if stale.
- OpenCode target: detected state, enabled state, synced state/version when known, and keep current / enable and sync / disable / skip.
- AG2/Antigravity target: detected state, enabled state, synced state/version when known, and keep current / enable and sync / disable / skip.

After the question bank is answered by interactive input, explicit flags, or explicitly user-requested `--yes-recommended`, do not pause again for preference questions.

Allowed later blockers include dirty managed checkout, unexpected remote, fetch/auth failure, non-fast-forward update, validation failure, plugin cache verification failure, host hook trust required, unsupported/missing host CLI, unsafe Codex config topology/TOML, or unsafe OpenCode/AG2 target writes.

4. Start other bridge requests with a dry-run or audit command, usually:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

5. Use `repo/scripts/setup-codex-toolkit-plugin.cjs` only through the managed checkout setup flow for Codex native plugin install/update verification. For Claude Code setup prompts, run the managed checkout setup command with `--host claude-code`, while keeping Claude Code's native plugin install/trust flow host-local. Use `repo/scripts/toolkit-local-bridge.cjs` for shared bridge setup, repo auto-update enablement, sync, audit, disable, stale-state recovery, and troubleshooting. Use `repo/scripts/repair-codex-plugin-windows-hooks.cjs` only for post-install Windows hook audit/repair of an installed Codex plugin root.

On Windows, do **not** rely on bare `codex`; it can resolve to a non-runnable WindowsApps alias. Use `setup-codex-toolkit-plugin.cjs --codex-cli "%USERPROFILE%\.codex\plugins\.plugin-appserver\codex.exe"` when an explicit CLI path is needed.

6. Before final response after setup, report the active worktree path and commit if inspected, managed checkout path and commit, exact setup script path executed, whether the question bank appeared, and the exact Codex delegation state. Before final response after repo changes, run the relevant validators or tests for the touched surface.

## Codex Delegation Safety

- Structural truth comes from an actual TOML parser. Text resembling `[agents]` or limit assignments inside basic, literal, or multiline strings is never treated as configuration.
- Toolkit asks the official Codex app-server `config/batchWrite` editor to prepare an isolated proposal. Unsupported dotted/inline, duplicate, malformed, symlink, special-file, or ambiguous child-table layouts fail closed without writing.
- The proposed config path, exact values, and backup directory are printed before an explicit limit write. Existing files receive a Toolkit-owned exact-byte backup plus mode/topology metadata. Writes are atomic, resulting TOML is parsed again, and an exact restore command is reported. Keep, skip, configured no-op, and conflicting states create no backup.
- The config commitment occurs only after preceding plugin, validation, preference, and sync work succeeds, so a later setup failure cannot leave `CODEX_HOME/config.toml` mutated.
- Documented thread semantics preserve one general direct-specialist slot and depth one prevents recursive specialist spawning. This is intended to support an explicitly invoked specialist. Codex Security ordinary/deep compatibility remains unverified pending native UAT. If official Security workflows later require more capacity, handle that result explicitly instead of silently widening the limit.

## Safety Rules

- OpenCode and Antigravity 2 are opt-in only.
- Detection is allowed; autosetup is forbidden.
- Sync only enabled targets.
- Disabled or never-enabled targets must not be touched.
- Repo auto-update must validate the configured Toolkit repo and expected remote, refuse dirty worktrees without stashing or switching, auto-switch only the managed clean checkout back to the configured branch, fast-forward update, and run hook-light validation before enabled-target sync.
- Codex plugin cache auto-refresh is Codex-only. When enabled, startup hooks may refresh stale Codex Toolkit plugin cache content only from the configured managed `main` repo after repo validation and delegated target sync succeed. On Windows, the same opt-in may scan installed non-Toolkit Codex plugin caches under `CODEX_HOME/plugins/cache` and repair unsafe `.sh` hook launchers with the Toolkit wrapper.
- Startup hooks may also run a passive repo-local instruction preflight for the current working directory. Codex checks `AGENTS.md`; Claude Code checks `AGENTS.md` and `CLAUDE.md`. The preflight may compare expected `AI-AGENT-TOOLKIT` managed block content against bundled repo-local templates, but it must only warn and must not write, repair, back up, create, or refresh instruction files. When findings exist, pause and ask whether to run `ai-coding-agent-rules` check/repair/refresh now or proceed with the current task despite the warning.
- Claude Code plugin cache refresh is Claude-Code-only. If it cannot be automated, report the verified metadata/cache status and the exact manual Claude Code native plugin action required.
- Meaningful update activity should write an update report when reports are enabled; no-op updates should print concise status instead of spamming reports.
- Toolkit-managed update reports/logs older than 7 days are cleaned up best-effort from the Toolkit-managed report/log directory only. Cleanup failures should warn but not block setup or agent startup.
- Do not run npm, pip, package installs, or dependency installers from this skill.
- In Codex, the only allowed marketplace operation in this flow is the Codex-only local Toolkit plugin install/update path through `setup-codex-toolkit-plugin.cjs --write` or equivalent Codex local marketplace commands.
- In Claude Code, use Claude Code's native Toolkit plugin flow and do not call Codex marketplace commands.
- After a requested Codex plugin install or update on Windows, repair that installed plugin root before approving hooks. If repair cannot make hooks safe, fail with the repair error instead of reporting success. Trusted Toolkit Codex startup hooks may repeat this repair for installed non-Toolkit Codex plugin caches when Codex plugin cache auto-refresh is enabled.
- Do not mutate arbitrary project repos by default.
- Do not use Codex to update Claude Code or Claude Code to update Codex.
- Refuse downgrade unless the user explicitly requests `--force-downgrade` for recovery.
- Keep hooks optional and policy-light; critical policy must stay in docs, validators, and the shared updater.

## n8n Plugin Path Note

Official `n8n-io/skills` plugin setup is owned by n8n setup guidance. Marketplace registration alone is not installation. Verify `n8n-skills@n8n-io` is installed and enabled, not merely available. On Windows, repair and audit the installed plugin cache path under `.codex/plugins/cache/n8n-io/n8n-skills/<version>` before trusting hooks. Trusted Toolkit Codex startup hooks may repair it again after future plugin updates when Codex plugin cache auto-refresh is enabled. Do not repair or audit temporary marketplace checkout paths such as `.codex/.tmp/marketplaces/n8n-io/plugins/n8n-skills`.

Plain skill installs for OpenCode, AG2/Antigravity, or other folder-based targets do not include official n8n plugin hooks, so target repo instructions must cue `using-n8n-skills`.

## Validation

For bridge or setup-surface changes, prefer targeted checks first:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs
node repo/scripts/validate-toolkit.cjs
```

Run `node --test repo/tests/toolkit-local-bridge.test.cjs` when the change affects bridge behavior, hooks, target sync semantics, repo auto-update behavior, report cleanup, host-native cache behavior, or before PR/release validation. Run `npm run validate:all` only when broad validation is specifically warranted by the repo rules.
