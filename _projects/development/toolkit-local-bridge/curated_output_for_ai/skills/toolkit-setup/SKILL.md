---
name: toolkit-setup
description: Use when the user says "setup toolkit" or asks about AI Agent Toolkit plugin setup, Toolkit Local Bridge setup or troubleshooting, repo-backed Toolkit auto-update, OpenCode bridge support, AG2 adapter support, bridge audit, enabled-target sync, disable, stale bridge state, native Codex or Claude Code plugin update behavior, or bridge setup safety. Routes agents to the Toolkit setup subsystem and repo/scripts/toolkit-local-bridge.cjs; do not use for ordinary project coding, unrelated n8n setup, or as a command-per-bridge workflow.
---

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
codex plugin marketplace add "<local-ai-agent-toolkit-repo>" --json
codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

The local marketplace wrapper is `.agents/plugins/marketplace.json`; it exposes this repo root as `ai-agent-toolkit@ai-agent-toolkit-local`, uses `policy.authentication: "ON_USE"` so install can complete headlessly, and the package manifest is `.codex-plugin/plugin.json`. `setup-codex-toolkit-plugin.cjs --write` runs the same supported Codex commands and then verifies the result. Verification must confirm the installed plugin cache contains Toolkit version `2.2.0` and `.codex-plugin/hooks/hooks.json` includes the Codex `SessionStart` hook. If Codex local marketplace install is unsupported or the verifier cannot find a usable Codex CLI, fail clearly instead of pretending setup completed. Do not use Codex to install or update Claude Code.
3. Configure repo-backed auto-update from this local repo without enabling OpenCode or AG2 yet:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "<local-ai-agent-toolkit-repo>" --repo-branch main --enable-auto-sync --write
```

4. Audit OpenCode and AG2, then explain the detected targets, target paths, and planned writes:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

5. Ask once before non-native target writes. The approval question must name OpenCode and AG2 and state that enabling them writes only Toolkit-managed user-local bridge output. Never silently enable OpenCode or AG2.
6. If approved, enable only the approved targets and run a sync test:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --enable-target ag2 --write
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
node repo/scripts/toolkit-local-bridge.cjs --audit
```

7. Confirm future Codex `SessionStart` hooks will use the configured repo-backed updater: validate repo path, branch, remote, clean tree, `git fetch origin main`, `git merge --ff-only FETCH_HEAD`, hook-light validation, and enabled-target sync from the freshly updated repo.

## Safety Rules

- Dry-run first.
- OpenCode and AG2 are opt-in only.
- Detection is allowed; autosetup is forbidden.
- Sync only enabled targets.
- Disabled or never-enabled targets must not be touched.
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
