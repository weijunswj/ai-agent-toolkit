# Toolkit Local Bridge

First-party project module for the v2 native plugin/update architecture and opt-in local bridge targets.

Source files live in [_main/](_main/). Generated outputs publish into:

- `skills/setup-local-toolkit-bridge/`
- `skills/setup-opencode-bridge/`
- `skills/setup-ag2-bridge/`
- `skills/setup-all-non-native-bridges/`
- `skills/sync-enabled-bridges/`
- `skills/audit-local-toolkit-bridge/`
- `skills/disable-local-toolkit-bridge/`
- `.codex-plugin/plugin.json`
- `.codex-plugin/hooks/hooks.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/hooks/hooks.json`

The shared bridge updater source is maintained at [repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs).
