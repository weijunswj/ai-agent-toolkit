---
name: toolkit-setup
description: Use when the user asks about AI Agent Toolkit plugin setup, Toolkit Local Bridge setup or troubleshooting, OpenCode bridge support, AG2 adapter support, bridge audit, enabled-target sync, disable, stale bridge state, native Codex or Claude Code plugin update behavior, or bridge setup safety. Routes agents to the Toolkit setup subsystem and repo/scripts/toolkit-local-bridge.cjs; do not use for ordinary project coding, unrelated n8n setup, or as a command-per-bridge workflow.
---

<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this skill as a compact setup router. Do not duplicate the bridge implementation, command-per-target procedures, or hook policy here.
-->

# Toolkit Setup

Use this skill as a discoverability router for Toolkit plugin and local bridge setup work.

Bridge setup, sync, audit, disable, and troubleshooting are Toolkit setup infrastructure. The implementation lives in `repo/scripts/toolkit-local-bridge.cjs`; detailed policy lives in `repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md`, `repo/docs/HOW-TO-USE.md`, `AGENTS.md`, validators, and tests.

## Required Route

1. Inspect the local repo context and read `repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md` before changing bridge behavior or running write commands.
2. Start with a dry-run or audit command, usually:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

3. Use `repo/scripts/toolkit-local-bridge.cjs` for setup, sync, audit, disable, stale-state recovery, and troubleshooting. Do not invent a new command family or duplicate the updater logic in the skill.
4. Before final response after repo changes, run the relevant validators or tests for the touched surface.

## Safety Rules

- Dry-run first.
- OpenCode and AG2 are opt-in only.
- Detection is allowed; autosetup is forbidden.
- Sync only enabled targets.
- Disabled or never-enabled targets must not be touched.
- Do not run npm, pip, package installs, marketplace installs, or dependency installers from this skill.
- Do not mutate project repos by default.
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
