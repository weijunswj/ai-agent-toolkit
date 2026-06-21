# Source Manifest: Toolkit Local Bridge

## Preserved In `_main/`

- `codex-plugin/plugin.json`
- `codex-plugin/hooks/hooks.json`
- `claude-plugin/plugin.json`
- `claude-plugin/hooks/hooks.json`
- Plugin metadata and hook configuration only.

## Reviewed In `curated_output_for_ai/`

- `skills/**/README.md`
- `skills/**/SKILL.md`

`curated_output_for_ai/skills/**` contains the canonical bridge command skill text. The bridge command skills are intentionally small routers around the canonical updater script and v2 architecture doc.

## Repo Script Source

[repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs) is the canonical shared bridge updater source. The native plugin hooks call that script. It is not copied from private Codex or Claude plugin caches.

## AI-Facing Surfaces

- `skills/setup-local-toolkit-bridge/**` is generated from `curated_output_for_ai/skills/setup-local-toolkit-bridge/**`.
- `skills/setup-opencode-bridge/**` is generated from `curated_output_for_ai/skills/setup-opencode-bridge/**`.
- `skills/setup-ag2-bridge/**` is generated from `curated_output_for_ai/skills/setup-ag2-bridge/**`.
- `skills/setup-all-non-native-bridges/**` is generated from `curated_output_for_ai/skills/setup-all-non-native-bridges/**`.
- `skills/sync-enabled-bridges/**` is generated from `curated_output_for_ai/skills/sync-enabled-bridges/**`.
- `skills/audit-local-toolkit-bridge/**` is generated from `curated_output_for_ai/skills/audit-local-toolkit-bridge/**`.
- `skills/disable-local-toolkit-bridge/**` is generated from `curated_output_for_ai/skills/disable-local-toolkit-bridge/**`.
- `.codex-plugin/plugin.json` and `.codex-plugin/hooks/hooks.json` are generated from `_main/codex-plugin/**`.
- `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json` are generated from `_main/claude-plugin/**`.

## Excluded

- Public marketplace publication.
- Private Codex or Claude plugin cache paths.
- User-local bridge hub state.
- OpenCode global skill output.
- AG2 adapter output.
- Package archives, dependency installs, `.env*`, credentials, private keys, and project-repo mutations.

## Validation

Targeted validation lives in [repo/tests/toolkit-local-bridge.test.cjs](../../../repo/tests/toolkit-local-bridge.test.cjs) and [repo/scripts/validate-toolkit.cjs](../../../repo/scripts/validate-toolkit.cjs).
