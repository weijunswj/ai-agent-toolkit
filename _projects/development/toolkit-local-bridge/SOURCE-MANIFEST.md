# Source Manifest: Toolkit Local Bridge

## Preserved In `_main/`

- `codex-plugin/plugin.json`
- `codex-plugin/assets/*.png`
- `codex-plugin/hooks/hooks.json`
- `claude-plugin/plugin.json`
- `claude-plugin/hooks/hooks.json`
- Plugin metadata, Codex icon assets, and hook configuration only.

## Reviewed In `curated_output_for_ai/`

- `skills/toolkit-setup/README.md`
- `skills/toolkit-setup/SKILL.md`
- `skills/toolkit-setup/agents/openai.yaml`

These files publish one compact discoverability skill. Bridge setup, repo auto-update, sync, audit, and disable operations remain deterministic Toolkit maintenance commands implemented by the shared updater, not a command-per-bridge skill family.

## Repo Script Source

[repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs) is the canonical shared bridge updater source. The native plugin hooks call that script. It is not copied from private Codex or Claude plugin caches.

[repo/scripts/setup-codex-toolkit-plugin.cjs](../../../repo/scripts/setup-codex-toolkit-plugin.cjs) is the Codex-only native plugin install verifier and local marketplace wrapper runner. It validates `.agents/plugins/marketplace.json`, the headless-safe `ON_USE` auth policy, `.codex-plugin/plugin.json`, installed Codex plugin state, Toolkit version `2.2.0`, the installed cache `SessionStart` hook, and package-critical cache freshness against this repo before setup reports success. The user must still approve the startup hook manually when Codex prompts after installation. The helper uses supported Codex plugin commands instead of editing Codex config by hand and does not install or update Claude Code.

[repo/scripts/repair-codex-plugin-windows-hooks.cjs](../../../repo/scripts/repair-codex-plugin-windows-hooks.cjs) is the canonical Windows post-install hook repair utility for installed Codex plugin roots. It parses `hooks/hooks.json`, writes only the Toolkit-managed hook wrapper when needed, and applies the n8n-specific Node fallback patch for `n8n-skills@n8n-io`. The paired audit script can run `--verify-output` to execute repaired hooks with sample input and verify hook JSON output before approval. It is first-party Toolkit setup infrastructure, not copied third-party plugin source.

## AI-Facing Surfaces

- `skills/toolkit-setup/` is generated from curated output as the only Toolkit setup or bridge discoverability skill.
- `.codex-plugin/plugin.json`, `.codex-plugin/assets/*.png`, and `.codex-plugin/hooks/hooks.json` are generated from `_main/codex-plugin/**`.
- `.agents/plugins/marketplace.json` is the local Codex marketplace wrapper for installing this repo as `ai-agent-toolkit@ai-agent-toolkit-local`.
- `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json` are generated from `_main/claude-plugin/**`.
- The seven command-specific bridge skills are not published.

## Excluded

- Public marketplace publication.
- Private Codex or Claude plugin cache paths.
- User-local bridge hub state.
- OpenCode global skill output.
- Antigravity 2 adapter output.
- Package archives, dependency installs, `.env*`, credentials, private keys, and arbitrary project-repo mutations.

## Validation

Targeted validation lives in [repo/tests/toolkit-local-bridge.test.cjs](../../../repo/tests/toolkit-local-bridge.test.cjs) and [repo/scripts/validate-toolkit.cjs](../../../repo/scripts/validate-toolkit.cjs).
