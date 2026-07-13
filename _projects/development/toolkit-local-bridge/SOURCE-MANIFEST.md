# Source Manifest: Toolkit Local Bridge

## Preserved In `_main/`

- `codex-plugin/plugin.json`
- `codex-plugin/assets/*.png`
- `codex-plugin/hooks/hooks.json`
- `claude-plugin/plugin.json`
- `claude-plugin/hooks/hooks.json`
- `claude-plugin/marketplace.json`
- Plugin metadata, Codex icon assets, and hook configuration only.

## Reviewed In `curated_output_for_ai/`

- `skills/toolkit-setup/README.md`
- `skills/toolkit-setup/SKILL.md`
- `skills/toolkit-setup/agents/openai.yaml`

These files publish one compact discoverability skill. Bridge setup, repo auto-update, sync, audit, and disable operations remain deterministic Toolkit maintenance commands implemented by the shared updater, not a command-per-bridge skill family.

## Repo Script Source

[repo/scripts/toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs) is the canonical shared bridge updater source. The native plugin hooks call that script for optional bridge autocheck, passive repo-local instruction managed-block preflight, repo auto-update, and enabled-target sync. It is not copied from private Codex or Claude plugin caches.

[repo/scripts/setup-codex-toolkit-plugin.cjs](../../../repo/scripts/setup-codex-toolkit-plugin.cjs) is the Codex-only native plugin install verifier and local marketplace wrapper runner. It validates `.agents/plugins/marketplace.json`, headless-safe `ON_USE` auth policy, `.codex-plugin/plugin.json`, installed Codex plugin state, Toolkit version `2.4.5`, the installed-cache `SessionStart` hook, and package-critical cache freshness before setup reports success. Supported non-interactive inspection does not expose hook trust, so guidance routes the user to `/hooks` and identifies the installed plugin-cache copy as the expected hook source rather than the managed Git checkout. It never reads or edits trust state manually and does not install or update Claude Code.

[repo/scripts/setup-claude-toolkit-plugin.cjs](../../../repo/scripts/setup-claude-toolkit-plugin.cjs) is the Claude Code-only native plugin install verifier and local marketplace wrapper runner. It validates `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `.claude-plugin/hooks/hooks.json`, and installed Claude Code plugin state via `claude plugin list --json` before setup reports success. It uses the supported `claude plugin marketplace add <repo>` and `claude plugin install ai-agent-toolkit@ai-agent-toolkit-local --scope <scope>` commands instead of editing Claude Code config by hand, and does not install or update Codex. Unlike the Codex helper, it does not fingerprint a version-pinned plugin cache directory, since Claude Code's local-marketplace install has no documented equivalent to Codex's copied plugin cache.

[repo/scripts/setup-toolkit.cjs](../../../repo/scripts/setup-toolkit.cjs) is the script-backed English `setup toolkit` and `refresh toolkit` orchestrator, with shared workflow in `repo/scripts/setup-toolkit-core.cjs`. It discovers effective Codex multi-agent runtime through app-server `experimentalFeature/list`, asks one plain-language helper-capacity question, defaults to keeping current state, and applies only explicit RAM-safe, custom, remove, or skip choices. MultiAgentV2 migrates the official boolean enablement form to a `[features.multi_agent_v2]` table with `enabled = true`, `max_concurrent_threads_per_session`, and root/helper policy hints; one helper means two total session threads because the root counts. MultiAgentV1 uses `[agents].max_threads` and `[agents].max_depth`. Exact PR #237 Toolkit-managed V1 blocks may migrate to V2, while user-owned or malformed settings fail closed. The official behavior was checked against `openai/codex` commit `2f7d89b1419bf7064346855b0acde23514b1ebc5`; V2 helpers retain spawn capability, so nested-helper prevention is reported as policy-only. No documented scan-scoped Codex Security capacity activation was found, and normal global capacity is never raised automatically. Isolated official config editing, structural TOML validation, exact proposal deltas, atomic backup/restore, bounded temporary cleanup, and shell-safe restore commands preserve the transaction boundary.

[repo/scripts/codex-delegation-common.cjs](../../../repo/scripts/codex-delegation-common.cjs), [repo/scripts/codex-delegation-layout.cjs](../../../repo/scripts/codex-delegation-layout.cjs), [repo/scripts/codex-delegation-state.cjs](../../../repo/scripts/codex-delegation-state.cjs), [repo/scripts/codex-delegation-backup.cjs](../../../repo/scripts/codex-delegation-backup.cjs), and [repo/scripts/codex-delegation-config.cjs](../../../repo/scripts/codex-delegation-config.cjs) are the shared Codex configuration parser, topology, state, backup, and transaction helpers. They are package-critical Codex setup dependencies and are included in the native plugin cache freshness fingerprint.

[repo/scripts/repair-codex-plugin-windows-hooks.cjs](../../../repo/scripts/repair-codex-plugin-windows-hooks.cjs) is the canonical Windows post-install hook repair utility for installed Codex plugin roots. It parses `hooks/hooks.json`, writes only the Toolkit-managed hook wrapper when needed, repairs generic installed third-party hook launchers without executing them, and applies the n8n-specific Node fallback patch only for `n8n-skills@n8n-io`. The paired audit script can run `--verify-output` to execute repaired hooks with sample input and verify hook JSON output before approval. It is first-party Toolkit setup infrastructure, not copied third-party plugin source.

## AI-Facing Surfaces

- `skills/toolkit-setup/` is generated from curated output as the only Toolkit setup or bridge discoverability skill.
- `.codex-plugin/plugin.json`, `.codex-plugin/assets/*.png`, and `.codex-plugin/hooks/hooks.json` are generated from `_main/codex-plugin/**`.
- `.agents/plugins/marketplace.json` is the local Codex marketplace wrapper for installing this repo as `ai-agent-toolkit@ai-agent-toolkit-local`.
- `.claude-plugin/plugin.json`, `.claude-plugin/hooks/hooks.json`, and `.claude-plugin/marketplace.json` are generated from `_main/claude-plugin/**`.
- `.claude-plugin/marketplace.json` is the local Claude Code marketplace wrapper for installing this repo as `ai-agent-toolkit@ai-agent-toolkit-local`.
- The seven command-specific bridge skills are not published.

## Excluded

- Public marketplace publication.
- Private Codex or Claude plugin cache paths.
- User-local bridge hub state.
- OpenCode global skill output.
- Antigravity 2 adapter output.
- Package archives, dependency installs, `.env*`, credentials, private keys, and arbitrary project-repo mutations.

## Validation

Targeted validation lives in [repo/tests/toolkit-local-bridge.test.cjs](../../../repo/tests/toolkit-local-bridge.test.cjs), [repo/tests/toolkit-setup-orchestrator-1.test.cjs](../../../repo/tests/toolkit-setup-orchestrator-1.test.cjs), [repo/tests/toolkit-setup-orchestrator-2.test.cjs](../../../repo/tests/toolkit-setup-orchestrator-2.test.cjs), [repo/tests/toolkit-setup-orchestrator-3.test.cjs](../../../repo/tests/toolkit-setup-orchestrator-3.test.cjs), and [repo/scripts/validate-toolkit.cjs](../../../repo/scripts/validate-toolkit.cjs).
