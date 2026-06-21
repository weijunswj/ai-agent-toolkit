---
name: sync-enabled-bridges
description: Use when the user asks to sync already-enabled Toolkit local bridge targets. Syncs only enabled targets, uses the lock file, refuses downgrades, and does not set up new targets.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.toolkit-local-bridge
Source: _projects/development/toolkit-local-bridge/curated_output_for_ai/skills/sync-enabled-bridges/SKILL.md
Update the curated output and run sync.
-->
# Sync Enabled Bridges

Use this skill when the user asks to sync already-enabled bridge targets.

1. Run an audit first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

2. Confirm which targets are already enabled.
3. Ask for approval before writing if the sync will touch user-level files.
4. Run:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write
```

This command does not enable new targets. It refuses to overwrite newer bridge state unless the user explicitly asks for manual recovery with `--force-downgrade`.

When reporting the result, separate hub updates from target updates. OpenCode sync may write only the managed OpenCode `ai-agent-toolkit` global skill folder. AG2 sync may write only adapter metadata under the hub. If a target is detected but not enabled, skipped, disabled, or already current, report that status instead of treating it as a failure. Do not add `--enable-target` during a sync-only task.
