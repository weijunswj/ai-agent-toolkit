---
name: audit-local-toolkit-bridge
description: Use when the user asks to inspect, audit, diagnose, or report Toolkit local bridge state. Reads current bridge state and target detection status without writing by default.
---

# Audit Local Toolkit Bridge

Use this skill when the user asks for bridge status or diagnostics.

Run:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Report:

- Current bridge version.
- Hub path.
- Sync source.
- Auto-sync status.
- Target detected, enabled, disabled, stale, and synced status.
- Target paths.
- Checksums.
- Skip reasons.

Interpret the audit conservatively. A detected target is only a signal that the platform may exist locally; it is not permission to set it up. If OpenCode or AG2 is detected but not enabled, report that no target writes are allowed until the user explicitly asks for setup. If auto-sync is disabled, describe it as reminder or manual-sync mode. If the hub has a newer version than the current updater, stop before any write and report the downgrade refusal.

Do not run `--write` unless the user explicitly asks for a write action.
