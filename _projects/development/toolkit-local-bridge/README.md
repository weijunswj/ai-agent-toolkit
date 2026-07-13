# Toolkit Local Bridge

First-party project module for the native plugin/update architecture, opt-in repo-backed auto-update, and local bridge setup subsystem.

Source files live in [_main/](_main/). Generated outputs publish into:

- `skills/toolkit-setup/`
- `.codex-plugin/plugin.json`
- `.codex-plugin/assets/*.png`
- `.codex-plugin/hooks/hooks.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/hooks/hooks.json`

The shared bridge updater source is maintained at [repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs). Bridge setup, passive repo-local instruction preflight, repo auto-update, audit, sync, and disable operations are deterministic Toolkit maintenance commands. The setup orchestrator also owns the narrow Codex-only `[agents]` limit block; portable rules own cross-host single-agent behavior. The single `toolkit-setup` skill exists only as a compact discoverability router; it is not a command-per-bridge skill family.
