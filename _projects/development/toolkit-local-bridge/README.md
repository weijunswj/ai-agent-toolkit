# Toolkit Local Bridge

First-party project module for the native plugin/update architecture, opt-in repo-backed auto-update, and local bridge setup subsystem.

Source files live in [_main/](_main/). Generated outputs publish into:

- `skills/toolkit-setup/`
- `.codex-plugin/plugin.json`
- `.codex-plugin/assets/*.png`
- `.codex-plugin/hooks/hooks.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/hooks/hooks.json`

The shared bridge updater source is maintained at [repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs), with generation-owned staging safety in [repo/scripts/toolkit-staging-generations.cjs](../../../repo/scripts/toolkit-staging-generations.cjs). Bridge setup, passive repo-local instruction preflight, repo auto-update, audit, sync, disable, staging audit, and exact approved staging reconciliation are deterministic Toolkit maintenance commands. The setup orchestrator also owns the narrow Codex-only `[agents]` capacity backstop; portable rules own cross-host root-first launch qualification and fail closed when a host profile cannot verify admission, effort, or non-fast execution. The single `toolkit-setup` skill exists only as a compact discoverability router; it is not a command-per-bridge skill family.
