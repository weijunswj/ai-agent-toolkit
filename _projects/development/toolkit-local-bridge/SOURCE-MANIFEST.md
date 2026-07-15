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

[repo/scripts/toolkit-staging-generations.cjs](../../../repo/scripts/toolkit-staging-generations.cjs) owns generation-scoped staging registration, identity validation, audit, current-operation cleanup, and exact approved reconciliation. It pre-registers immutable ownership before creating staging, never authorizes deletion from a matching name or dead PID alone, and leaves historical unmarked or ambiguous entries untouched.

Bridge version state is recorded independently for `repo`, `codex-plugin`, and `claude-plugin`. Same-source downgrade protection uses only the running source's recorded version; the monotonic `hub_version` remains reporting and older-cache compatibility state. Locked writes reread and merge the latest state so independently cached host copies cannot erase one another's entries. Existing cached copies are not repaired by source changes, so each affected native host must be refreshed after merge.

[repo/scripts/setup-codex-toolkit-plugin.cjs](../../../repo/scripts/setup-codex-toolkit-plugin.cjs) is the Codex-only native plugin install verifier and local marketplace wrapper runner. It validates `.agents/plugins/marketplace.json`, headless-safe `ON_USE` auth policy, `.codex-plugin/plugin.json`, installed Codex plugin state, the current Toolkit version, the installed-cache `SessionStart` hook, its cache-local exact Node runtime metadata, and package-critical cache freshness before setup reports success. On Windows it replaces the portable source command in the isolated installed cache with an exact PowerShell launcher command that does not depend on interactive-shell Node resolution or shell-style `${PLUGIN_ROOT}` expansion. Supported non-interactive inspection does not expose hook trust, so guidance routes the user to `/hooks` and identifies the installed plugin-cache copy as the executing hook source while the managed Git checkout remains the refresh source. It never reads or edits trust state manually and does not install or update Claude Code.

[repo/scripts/toolkit-codex-session-start.cjs](../../../repo/scripts/toolkit-codex-session-start.cjs) and [repo/scripts/toolkit-codex-session-start.ps1](../../../repo/scripts/toolkit-codex-session-start.ps1) form the Codex hook-safe launcher boundary. The Node launcher fixes the permitted hook arguments, derives the plugin root from its own package location, and converts thrown or returned non-zero optional-maintenance outcomes into one visible safe skip. The Windows launcher reads only setup-generated cache-local runtime metadata, preserves standard input and bridge output, uses the exact verified Node executable, and exits zero after a visible safe skip when startup cannot proceed. Manual bridge commands retain their normal non-zero failures.

[repo/scripts/setup-claude-toolkit-plugin.cjs](../../../repo/scripts/setup-claude-toolkit-plugin.cjs) is the Claude Code-only native plugin install verifier and local marketplace wrapper runner. It validates `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `.claude-plugin/hooks/hooks.json`, and installed Claude Code plugin state via `claude plugin list --json` before setup reports success. It uses the supported `claude plugin marketplace add <repo>` and `claude plugin install ai-agent-toolkit@ai-agent-toolkit-local --scope <scope>` commands instead of editing Claude Code config by hand, and does not install or update Codex. It requires the exact installed-cache path reported by Claude Code and compares the installed manifest, hooks, controller, and agent hook byte-for-byte with the selected source before strict enforcement is considered current.

[repo/scripts/setup-toolkit.cjs](../../../repo/scripts/setup-toolkit.cjs) is the script-backed English `setup toolkit` and `refresh toolkit` orchestrator, with shared workflow in `repo/scripts/setup-toolkit-core.cjs`. One semantic model drives the complete compact bank, terminal and piped answers, flags, plans, JSON, summaries, and execution. Codex retains a conservative helper-capacity backstop but no strict managed topology and therefore recommends root-only rather than a fixed helper. Claude Code separately exposes only capability-valid topology and capacity outcomes: root-only, Toolkit-managed direct agents, broader native behavior, keep-current, automatic admission, or a manual maximum backstop. Automatic/manual choices are omitted when the exact launch flags cannot be verified, and topology plus capacity resolve to one compatible semantic outcome before display, approval, or write. Strict kept profiles are invalidated when the current CLI or installed hook/cache contract no longer verifies. Codex and Claude state and writes remain isolated. Unexpected piped answers and unsupported choices stop before setup writes. Structural config validation, proposal binding, atomic backup/restore, bounded cleanup, and failure-only reports remain unchanged.

[repo/scripts/toolkit-agent-control.cjs](../../../repo/scripts/toolkit-agent-control.cjs) is the canonical Claude direct-agent launch and admission boundary. It validates productive-root launch specifications, forces medium effort by default and non-fast child execution, blocks nesting, reads physical plus commit/pagefile headroom, applies substantial reserves after subtracting aggregate live reservation costs, returns only `start`, `queue`, or `refuse-root-only`, and uses one atomic lock for queue/reservation decisions. Child prompts use bounded stdin rather than argv, and private artifacts use explicit restrictive modes. A detached supervisor owns lifecycle release. It never claims coverage for native, Security, team, built-in, plugin, user-created, third-party, or direct CLI launches outside this script.

[repo/scripts/toolkit-claude-agent-hook.cjs](../../../repo/scripts/toolkit-claude-agent-hook.cjs) is the Claude `PreToolUse` boundary for native `Agent` and legacy `Task`. Root-only and Toolkit-direct profiles deny those bypasses; broader-native mode allows them while reporting them outside Toolkit admission.

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
