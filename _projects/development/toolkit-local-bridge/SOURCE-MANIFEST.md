# Source Manifest: Toolkit Local Bridge

## Preserved In `_main/`

- `codex-plugin/plugin.json`
- `codex-plugin/hooks/hooks.json`
- `claude-plugin/plugin.json`
- `claude-plugin/hooks/hooks.json`
- Plugin metadata and hook configuration only.

## Reviewed In `curated_output_for_ai/`

- None currently. Bridge setup, sync, audit, and disable operations are deterministic Toolkit maintenance commands, not published agent skills.

## Repo Script Source

[repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs) is the canonical shared bridge updater source. The native plugin hooks call that script. It is not copied from private Codex or Claude plugin caches.

## AI-Facing Surfaces

- `.codex-plugin/plugin.json` and `.codex-plugin/hooks/hooks.json` are generated from `_main/codex-plugin/**`.
- `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json` are generated from `_main/claude-plugin/**`.
- No `skills/**` output is published by this module.

## Excluded

- Public marketplace publication.
- Private Codex or Claude plugin cache paths.
- User-local bridge hub state.
- OpenCode global skill output.
- AG2 adapter output.
- Package archives, dependency installs, `.env*`, credentials, private keys, and project-repo mutations.

## Validation

Targeted validation lives in [repo/tests/toolkit-local-bridge.test.cjs](../../../repo/tests/toolkit-local-bridge.test.cjs) and [repo/scripts/validate-toolkit.cjs](../../../repo/scripts/validate-toolkit.cjs).
