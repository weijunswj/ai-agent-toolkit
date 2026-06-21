# Toolkit Local Bridge

First-party project module for the v2 native plugin/update architecture and opt-in local bridge setup subsystem.

Source files live in [_main/](_main/). Generated outputs publish into:

- `.codex-plugin/plugin.json`
- `.codex-plugin/hooks/hooks.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/hooks/hooks.json`

The shared bridge updater source is maintained at [repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs). Bridge setup, audit, sync, and disable operations are deterministic Toolkit maintenance commands, not agent skills.
