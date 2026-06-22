# Toolkit Local Bridge

First-party project module for the v2 native plugin/update architecture, opt-in repo-backed auto-update, and local bridge setup subsystem.

Source files live in [_main/](_main/). Generated outputs publish into:

- `skills/toolkit-setup/`
- `.codex-plugin/plugin.json`
- `.codex-plugin/assets/*.png`
- `.codex-plugin/hooks/hooks.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/hooks/hooks.json`

The shared bridge updater source is maintained at [repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs). Bridge setup, repo auto-update, audit, sync, and disable operations are deterministic Toolkit maintenance commands. The single `toolkit-setup` skill exists only as a compact discoverability router; it is not a command-per-bridge skill family.
