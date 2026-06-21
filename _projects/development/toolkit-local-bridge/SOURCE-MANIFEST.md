# Source Manifest: Toolkit Local Bridge

## Preserved In `_main/`

- `codex-plugin/plugin.json`
- `codex-plugin/hooks/hooks.json`
- `claude-plugin/plugin.json`
- `claude-plugin/hooks/hooks.json`
- Plugin metadata and hook configuration only.

## Reviewed In `curated_output_for_ai/`

- `skills/toolkit-setup/README.md`
- `skills/toolkit-setup/SKILL.md`
- `skills/toolkit-setup/agents/openai.yaml`

These files publish one compact discoverability skill. Bridge setup, sync, audit, and disable operations remain deterministic Toolkit maintenance commands implemented by the shared updater, not a command-per-bridge skill family.

## Repo Script Source

[repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs) is the canonical shared bridge updater source. The native plugin hooks call that script. It is not copied from private Codex or Claude plugin caches.

[repo/scripts/repair-codex-plugin-windows-hooks.cjs](../../../repo/scripts/repair-codex-plugin-windows-hooks.cjs) is the canonical Windows post-install hook repair utility for installed Codex plugin roots. It parses `hooks/hooks.json`, writes only the Toolkit-managed hook wrapper when needed, and applies the n8n-specific Node fallback patch for `n8n-skills@n8n-io`. It is first-party Toolkit setup infrastructure, not copied third-party plugin source.

## AI-Facing Surfaces

- `skills/toolkit-setup/` is generated from curated output as the only Toolkit setup or bridge discoverability skill.
- `.codex-plugin/plugin.json` and `.codex-plugin/hooks/hooks.json` are generated from `_main/codex-plugin/**`.
- `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json` are generated from `_main/claude-plugin/**`.
- The seven command-specific bridge skills are not published.

## Excluded

- Public marketplace publication.
- Private Codex or Claude plugin cache paths.
- User-local bridge hub state.
- OpenCode global skill output.
- AG2 adapter output.
- Package archives, dependency installs, `.env*`, credentials, private keys, and project-repo mutations.

## Validation

Targeted validation lives in [repo/tests/toolkit-local-bridge.test.cjs](../../../repo/tests/toolkit-local-bridge.test.cjs) and [repo/scripts/validate-toolkit.cjs](../../../repo/scripts/validate-toolkit.cjs).
