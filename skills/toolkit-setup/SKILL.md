---
name: toolkit-setup
description: Use when the user says "setup toolkit" or "refresh toolkit", asks to repair the installed n8n Skills plugin or fix n8n .sh hooks opening in an editor on Windows, or when the task is clearly about AI Agent Toolkit plugin setup/update state, Toolkit Local Bridge setup or troubleshooting, repo-backed auto-update, bridge audit/sync/disable, OpenCode or Antigravity 2 opt-in bridge support, native Codex or Claude Code plugin behavior, Windows hook repair, or bridge setup safety. Route only installed-plugin repair intents to the bounded Toolkit setup subsystem and repo/scripts/toolkit-local-bridge.cjs; do not use for ordinary project coding, repo-local n8n helper scripts, live n8n operations, or generic n8n/MCP work.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.toolkit-local-bridge
Source: _projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this skill as a compact setup router. Do not duplicate the bridge implementation, command-per-target procedures, or hook policy here.
-->

# Toolkit Setup

Use this skill as a discoverability router for Toolkit plugin and local bridge setup work.

Run this routine with the root agent alone. `setup toolkit` is ordinary interactive setup; do not spawn subagents to inspect instructions, documentation, repository or host state, setup choices, or validation output.

Bridge setup, repo auto-update, sync, audit, disable, Windows plugin hook repair, and troubleshooting are Toolkit setup infrastructure. The bridge implementation lives in `repo/scripts/toolkit-local-bridge.cjs`; Codex native plugin verification/install lives in `repo/scripts/setup-codex-toolkit-plugin.cjs`; Codex plugin hook repair lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`; Claude Code native plugin metadata lives under `.claude-plugin/`; detailed policy lives in `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`, `repo/docs/HOW-TO-USE.md`, `AGENTS.md`, validators, and tests.

## Platform Split

- Codex native plugin install/update is Codex-only. Codex may verify or refresh only the Codex Toolkit native plugin cache. On Windows, the same opt-in may also reconcile only the exactly recognised installed `n8n-skills@n8n-io` hook layout after plugin updates.
- Claude Code native plugin install/update is Claude Code-only. The setup orchestrator verifies `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json`; use Claude Code's native Toolkit plugin flow when Claude Code reports the package is missing, stale, disabled, or untrusted.
- The shared bridge is platform-neutral. After the native Toolkit package is installed in Codex or Claude Code, use `repo/scripts/toolkit-local-bridge.cjs` for repo auto-update, audit, OpenCode sync, and Antigravity 2 sync.
- Hook approval differs by host. Codex setup must explain Codex hook trust; Claude Code setup must follow Claude Code's own native plugin/hook review behavior and should confirm the hook uses `--sync-source claude-plugin`.
- Codex setup may prepare only explicitly approved runtime-matched helper-capacity backstops in `CODEX_HOME/config.toml`, using the official app-server editor in an isolated temporary home plus structural TOML validation. MultiAgentV2 tracks Toolkit ownership of feature enablement, helper capacity, root guidance, and helper guidance independently. Pre-existing table-form `enabled = true` remains user-owned; boolean `multi_agent_v2 = true` may migrate structurally while remaining user-owned. MultiAgentV1 uses `agents.max_threads` and `agents.max_depth`. A capacity value is not a launch profile.
- Claude Code setup separately offers `Root agent only`, `Direct Toolkit-managed subagents only`, `Broader native behaviour`, and `Keep current` only when the detected CLI supports their real effects. A strict profile is active only while the enabled installed Toolkit plugin, exact `Agent|Task` `PreToolUse` hook, source/cache identity and bytes, controller version, and current CLI launch controls verify. Activation-proof schema 3 binds the hooks, controller, process-launch dependency, and native-agent hook as non-symlink regular files; schema-2 proof is stale and unsupported. Installed-cache completeness separately verifies the SessionStart bridge bytes and regular-file topology. Plugin verification, setup capability, persistence, current enforcement, and launch share this precedence: explicit argument, `AI_AGENT_TOOLKIT_CLAUDE_CLI`, `CLAUDE_TOOLKIT_CLAUDE_CLI`, `CLAUDE_CLI_PATH`, persisted command, then bare default. The selected command fails closed rather than falling through. Direct admission rechecks those identities and rejects Toolkit-child re-entry. A supported kept topology resolves before capacity reconciliation, preserving broader-native with root-only/not-applicable Toolkit capacity. The direct profile blocks native `Agent` and legacy `Task` launches and admits only external sessions started by `repo/scripts/toolkit-agent-control.cjs`; capability loss invalidates the strict profile to root-only policy. Codex state is never used or changed.
- Automatic Claude capacity uses physical availability, commit/pagefile headroom, pressure, active Toolkit workers, the validated aggregate memory cost of outstanding reservations, requested estimated cost, topology, and depth under one atomic transaction. Manual maximum remains a backstop. Built-in, team, Security, plugin, user-created, third-party, and direct CLI launches outside this script are not covered.

## Required Route

1. Inspect the local repo context and read `repo/docs/TOOLKIT-LOCAL-BRIDGE.md` before changing bridge behavior or running write commands.
2. For English prompts such as `setup toolkit`, `refresh toolkit`, or plain `refresh` in a Toolkit setup/update context, use the host-aware setup orchestrator from the managed checkout whenever it exists. Do not use the active repo worktree command as the canonical route.

```powershell
node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main
```

```sh
node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main
```

The orchestrator discovers current state, shows one consolidated upfront setup question bank, pauses before preference or target writes, then runs to completion unless a real safety blocker appears.

If the setup command exits with code `23` or prints that the setup question bank requires answers, treat that as an intentional pause for user input, not a setup failure. In a chat host, emit the complete compact bank as ordinary visible text before asking for approval. Hidden tool output, an internal summary, or a statement that the bank exists does not count. A blanket recommended-default action is allowed only in the same visible response as every consequential current outcome, recommendation, effect, and choice. Never say `shown above` or equivalent unless the complete bank is in that same payload. If the bank is missing or suppressed, do not ask for approval or infer consent; repeat the complete bank deterministically, then fail closed before writes if it still cannot be surfaced. Do not rerun with `--yes-recommended` unless the user explicitly asked to use the displayed recommended choices in the current turn.

It must show this explanation:

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

Default managed source checkout:

- Windows: `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit`
- POSIX: `~/.ai-agent-toolkit/source/ai-agent-toolkit`

The managed checkout is separate from the active Codex or Claude Code worktree, plugin caches, `.tmp` directories, and temporary marketplace checkouts. If the active Toolkit worktree is on a PR branch, setup should warn that this is okay and continue using the managed clean `main` checkout.

If the managed checkout path does not yet exist or does not contain `repo/scripts/setup-toolkit.cjs`, the active repo command is bootstrap/fallback only:

```powershell
node repo/scripts/setup-toolkit.cjs --execute --profile auto-main
```

When fallback/bootstrap is used, say that it is bootstrap-only. After the managed checkout exists, hand off to the managed checkout script above and use that script for the question bank, setup writes, and verification. In Claude Code, append `--host claude-code` to the managed or fallback setup command. If the managed setup script exists but exits for question-bank pause or a real safety blocker, do not fall back to the active repo command; stop and report the pause or blocker. Do not run an active stale verifier after managed setup; verify from the same managed checkout script/repo that performed setup.

3. One semantic wizard model must drive chat text, interactive terminal prompts, piped answers, explicit flags, plan output, structured JSON, approval summaries, generated setup documentation, and execution in the same order. The ordinary renderer groups only consequential rows under `Automatic updates`, `Computer performance`, and `Other coding apps`. Every decision block uses this order with readable spacing: title, **What this controls:**, **Current:**, **Recommended:**, **Why:**, **Choices:** with a consequence for every choice, then **After applying:** when state, files, native configuration, restart, or manual steps are relevant. The generated [Toolkit setup question reference](../../repo/docs/SETUP-QUESTIONS.generated.md) is produced from this same runtime metadata and must not be edited directly.

- Keep ordinary descriptions to one or two short sentences. Omit OpenCode, Antigravity, or host-specific rows when they have no practical effect in the detected environment.
- The primary bank must not expose issue or PR references, ownership terminology, raw runtime names, raw TOML keys, slot arithmetic, source identifiers, raw paths, backup paths, or restore commands. Put those details only in an optional technical proposal after a choice requires configuration work. The one exception is a visible `migrate` choice when an exact PR #237 legacy setting is pending.
- Automatic maintenance includes the clean Toolkit update source, automatic verified updates, meaningful report creation, and report retention. Failed or safety-blocked reports open automatically; successful reports stay closed. Report auto-open is not an ordinary question.
- Ordinary setup does not ask users to choose helper-agent quantities. Toolkit reports that controlled children are limited automatically from verified available memory. Existing saved Codex capacity state is preserved without reinterpretation; an explicit root-only, one-helper, migration, removal, or custom compatibility flag remains available for repair and diagnostics. Those inputs can only restrict the canonical live memory gate and never authorize or force a launch. New or unconfigured Codex state fails closed to root-only when no hard native launch boundary can be proven.
- Root-only and one-helper choices map to the detected effective runtime internally. Unknown, contradictory, disabled, or unsupported detection fails visibly without configuration mutation or an enforcement claim. Malformed recognised Toolkit delegation markers remain fail closed unless one regular active Codex user config is valid UTF-8/TOML, the effective runtime has exactly one explicit supported table, every marker and canonical owned assignment is isolated inside it, and no unknown marker, child/duplicate/dotted/inline table, user content, table crossing, mixed legacy/current family, special filesystem object, or snapshot ambiguity exists. Only that proven case may show an exact repair proposal and require literal `apply`; inspection, planning, SessionStart, and ordinary reads never repair. Explicit V2 `enabled = false` or non-boolean enablement remains user-owned and is never replaceable. The `migrate` action is valid only while an exact complete PR #237 legacy block is actually present.
- If structurally complete user-owned controls already match the selected effective helper outcome, preserve the file byte-for-byte without `apply`, editor invocation, backup, replacement, or Toolkit ownership markers. Otherwise, when a selected helper outcome meets replaceable user-owned or conflicting effective controls, immediately show one exact technical proposal with runtime, target, before/after behavior, affected keys, structural edit, backup generation metadata, and PowerShell/POSIX restore commands. Request only the required `apply` confirmation, then complete the transaction in the same setup flow. Unsupported MultiAgentV2 child tables are not replaceable and must stop before any setup mutation. If setup cannot proceed, state that the selection remains unapplied and name the one required action; do not report setup complete.
- Reject unexpected extra non-empty piped question-bank input for every host before any setup mutation. Whitespace-only trailing input remains empty after normalization.
- On a capable Claude Code host, ask only the topology question `How should Claude Code use agents?`. Direct Toolkit-managed topology implies automatic live resource admission; root-only and broader-native imply root-only/not-applicable Toolkit admission. The ordinary bank never asks for a capacity quantity or manual maximum. Existing saved manual state and explicit advanced flags remain compatible as restrictive backstops only. Strict direct mode still requires exact CLI controls, validated resource counters, current installed bytes, and host-reported native hook trust plus active execution.
- The Claude direct boundary requires a launch-spec JSON file declaring a meaningful child responsibility, a distinct productive parent responsibility, root-owned integration, root-owned cross-shard validation, material benefit, and depth 1. Launch with `node repo/scripts/toolkit-agent-control.cjs launch --spec <path>`. The controller returns only `start`, `queue`, or `refuse-root-only`; retry a queued specification with its returned `queue_id`, and only the oldest live entry may start. Every child defaults to medium effort, uses `--no-session-persistence`, receives `CLAUDE_CODE_DISABLE_FAST_MODE=1`, and cannot use `Agent` or legacy `Task`. The detached supervisor inherits the exact preflight environment without serializing environment values into Toolkit artifacts. The exact UTF-8 prompt bytes are bounded synchronously before admission and sent through stdin rather than argv; an oversized prompt creates no reservation, queue entry, job artifact, or supervisor. One reviewed executable contract handles bare Claude, shell-free JavaScript and `.exe` paths, and safely escaped `.cmd`/`.bat` paths. Bare commands resolve only from absolute PATH directories and carry the verified stable launcher candidate through controller and supervisor execution; each use revalidates the current target, preserving official POSIX launcher updates while blocking cwd and relative-PATH shadows. Invalid, missing, or non-executable candidates refuse before admission or child execution. Higher effort requires one named difficult role plus a narrow justification, and only one higher-effort reservation may be active.
- Every Toolkit-managed child on Codex, Claude Code, or OpenCode uses the same atomic memory admission policy and host-specific thin adapter. The gate verifies host responsiveness and live physical/commit headroom, subtracts existing reservations, reserves projected child memory before launch, releases on failed launch or completion, and reclaims only bounded identity-safe stale reservations. Unknown state fails closed. CPU is secondary evidence only. Native paths that cannot invoke this controller remain root-only and must not be described as hard-enforced. Worker/checker mappings are sticky contracts: Codex and OpenCode use GPT-5.6 Sol Medium for both in separate contexts; Claude Code uses Fable 5 workers and Opus 4.8 checkers. Children never use Fast mode and never nest. Weekly drift review belongs to #248; no model auto-upgrader exists.
- After meaningful code-changing implementation is complete, focused validation passes, and the diff is ready, one deterministic checker decision runs. Only typo-only docs, mechanical comments, or generated-only churn with independently validated authoritative source may return `SKIPPED_TRIVIAL`; packaged/runtime, setup, security/privacy, host integration, generated-source coupling, or versioned behavior always requires checking. One fresh direct read-only checker receives only the task contract, changed-file list, bounded diff, focused validation, and relevant invariants. It cannot edit, commit, push, open or merge PRs, or spawn children. Results are `PASS`, `FINDINGS`, `ADMISSION_DENIED`, or `SKIPPED_TRIVIAL`; the root owns every fix. A denied required checker triggers a bounded root self-review and must never be reported as an independent pass.
- More than one helper remains an explicit advanced compatibility setting with separate memory-risk approval, and the canonical live resource gate still has final authority.

After the question bank is answered by interactive input, explicit flags, or explicitly user-requested `--yes-recommended`, do not pause again for preference questions.

Allowed later blockers include dirty managed checkout, unexpected remote, fetch/auth failure, non-fast-forward update, validation failure, plugin cache verification failure, host hook trust required, unsupported/missing host CLI, unsafe Codex config topology/TOML, or unsafe OpenCode/AG2 target writes.

4. Start other bridge requests with a dry-run or audit command, usually:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

The audit reports new-format owned staging generations separately from historical unmarked or unrelated matching directories. Never delete staging from its name, age, or dead PID alone. For one safely attributable generation reported as reconcilable, preview and then run only the exact approved generation:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id>
node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id> --write
```

Historical unmarked, malformed, mismatched, live, indeterminate, escaped, symlink, junction, reparse-point, and unrelated entries remain untouched.

5. Use `repo/scripts/setup-codex-toolkit-plugin.cjs` only through the managed checkout setup flow for Codex native plugin install/update verification. For Claude Code setup prompts, run the managed checkout setup command with `--host claude-code`, while keeping Claude Code's native plugin install/trust flow host-local. Use `repo/scripts/toolkit-local-bridge.cjs` for shared bridge setup, repo auto-update enablement, sync, audit, disable, stale-state recovery, and troubleshooting. Use `repo/scripts/repair-codex-plugin-windows-hooks.cjs` only for post-install Windows hook audit/repair of an installed Codex plugin root.

On Windows, do **not** rely on bare `codex`; it can resolve to a non-runnable WindowsApps alias. Use `setup-codex-toolkit-plugin.cjs --codex-cli "%USERPROFILE%\.codex\plugins\.plugin-appserver\codex.exe"` when an explicit CLI path is needed.

6. Before final response after setup, report the active worktree path and commit if inspected, managed checkout path and commit, exact setup script path executed, whether the question bank appeared, and the exact Codex delegation state. Before final response after repo changes, run the relevant validators or tests for the touched surface.

## Codex Delegation Safety

- Structural truth comes from an actual TOML parser. Text resembling `[agents]` or limit assignments inside basic, literal, or multiline strings is never treated as configuration.
- Toolkit asks the official Codex app-server `config/batchWrite` editor to prepare an isolated proposal. After structural parsing, Toolkit adds separate exact ownership markers only around values it owns and parses the final marked proposal again. Existing user-owned enablement is never absorbed into Toolkit ownership. A repairable malformed historical block removes only approval-bound marker/assignment byte ranges, then writes only the selected runtime representation; an isolated marker-only repair preserves already-compatible user-owned assignments and writes no Toolkit markers. Missing begin/end, one duplicated recognised marker, reversed order, incomplete exact PR #237 material, and exact assignments beside malformed markers are repairable only when this proof succeeds. Legacy/current coexistence, unsupported or user-interleaved content, markers outside the target table, unknown/obsolete markers, multiple/unsupported tables, symlink/junction/reparse/special files, and every ambiguous case remain fail closed.
- The proposed config path, runtime, before/after semantics, exact values, planned backup metadata, verified absolute setup script, and exact PowerShell/POSIX restore commands are printed before the approved write. Commands quote script and metadata paths and do not depend on the current directory. Malformed repair proposals also show marker/assignment categories, exact affected line ranges, legacy/current replacement decisions, proposal digest, and the unrelated-byte preservation guarantee. Approval is bound to the preview-time target path, existence/topology, exact bytes and digest, size, mode, identity, runtime, helper count, affected keys and line ranges, affected-byte hash, proposal identity/digest, and backup generation. Immediately before editor invocation, backup, and atomic replacement, Toolkit proves the target still matches that approved snapshot and uses it as the transaction baseline rather than capturing a replacement baseline. Drift stops before the official editor or backup, reports the helper selection unapplied, and requires a fresh setup proposal. Existing files receive a Toolkit-owned exact-byte backup plus mode, identity, and integrity metadata; final semantic failure rolls back exactly. Restore validates generation-local metadata, paths, topology, hashes, and the expected current Codex config before mutation. Keep, skip, configured no-op, declined repair, conflicting, and stale-approval states create no backup.
- The final bridge audit must run and parse successfully after plugin, validation, preference, and sync work. Only then may setup commit the config as its final fallible operation, so a later setup failure cannot leave `CODEX_HOME/config.toml` mutated.
- Runtime detection accepts genuine V1-only and V2-only feature lists. Enabled V2 wins; otherwise enabled V1 wins; otherwise a present supported row with boolean disabled state means disabled. Missing booleans, duplicate/contradictory rows, malformed results, and unsupported methods remain unknown. User TOML alone never proves effective V1 state.
- In the optional technical proposal, MultiAgentV2 one-helper mode maps to two total session threads because the root counts; root-only maps to one total thread. MultiAgentV1 uses only its supported legacy controls when that runtime is effective.
- MultiAgentV2 guidance is root-first and permits productive parallelism only for independent non-overlapping scopes with material benefit, available resource admission, a verified medium non-fast child, meaningful concurrent root-owned work, and root-owned integration. Capacity remains a backstop. Current Codex `SubagentStart` hooks cannot block launch, Codex plugins do not package custom-agent definitions, and parent runtime overrides can reach children; Toolkit therefore must not claim adaptive admission or strict child-mode enforcement for built-in, plugin, Security, third-party, or nested paths. Unsupported paths remain root-only or are refused. No documented Codex Security scan-scoped capacity activation exists, so never raise normal global capacity automatically or imply that an official Deep Scan can run with insufficient capacity; report lower-capacity ordinary or sequential review, Deep Scan on another sufficiently provisioned machine, or an explicitly approved temporary global increase with backup and restoration as alternatives.

## Safety Rules

- OpenCode and Antigravity 2 are opt-in only.
- Detection is allowed; autosetup is forbidden.
- Sync only enabled targets.
- Disabled or never-enabled targets must not be touched.
- Repo auto-update must validate the configured Toolkit repo and expected remote, refuse dirty worktrees without stashing or switching, auto-switch only the managed clean checkout back to the configured branch, fast-forward update, and run hook-light validation before enabled-target sync.
- Codex plugin cache auto-refresh is Codex-only. When enabled, startup hooks may refresh stale Codex Toolkit plugin cache content only from the configured managed `main` repo after repo validation and delegated target sync succeed. On Windows, the same opt-in inventories n8n cache identity independently of the legacy hook-manifest path, prefers `codex plugin list --available --json` to select the single installed and enabled `n8n-skills@n8n-io` version/root, and reconciles only a known supported version/layout with the existing Toolkit wrapper. CLI omission is not uninstall proof: explicit enabled config plus exactly one cache candidate may select the fallback target; explicit disabled config leaves retained caches untouched; absent, malformed, or multi-candidate state fails closed. Retained historical caches and unrelated plugins are skipped. Missing, moved, ambiguous, unknown, or malformed current layouts fail closed and require upstream compatibility review.
- Startup hooks may also run a passive repo-local instruction preflight for the current working directory. Codex checks `AGENTS.md`; Claude Code checks `AGENTS.md` and `CLAUDE.md`. The preflight may compare expected `AI-AGENT-TOOLKIT` managed block content against bundled repo-local templates, but it must only warn and must not write, repair, back up, create, or refresh instruction files. When findings exist, pause and ask whether to run `ai-coding-agent-rules` check/repair/refresh now or proceed with the current task despite the warning.
- Claude Code plugin cache refresh is Claude-Code-only. If it cannot be automated, report the verified metadata/cache status and the exact manual Claude Code native plugin action required.
- Meaningful update activity should write an update report when reports are enabled; no-op updates should print concise status instead of spamming reports. A central classification opens only reports requiring action, including validation, fetch/update, dirty-checkout, remote-mismatch, target-sync, native-cache refresh, hook-repair, rollback, or restoration failures. Successful updates, refreshes, repairs, and syncs remain closed. Legacy persisted all-report auto-open state is migrated to this failure-only behavior, and compatibility flags never restore success-report auto-opening.
- Toolkit-managed update reports/logs older than 7 days are cleaned up best-effort from the Toolkit-managed report/log directory only. Cleanup failures should warn but not block setup or agent startup.
- Do not run npm, pip, package installs, or dependency installers from this skill.
- In Codex, the only allowed marketplace operation in this flow is the Codex-only local Toolkit plugin install/update path through `setup-codex-toolkit-plugin.cjs --write` or equivalent Codex local marketplace commands.
- In Claude Code, use Claude Code's native Toolkit plugin flow and do not call Codex marketplace commands.
- After a requested Codex plugin install or update on Windows, repair that installed plugin root before approving hooks. If repair cannot make hooks safe, fail with the repair error instead of reporting success. Trusted Toolkit Codex startup hooks may repeat the exact supported `n8n-skills@n8n-io` repair when Codex plugin cache auto-refresh is enabled; other plugins require an explicit targeted install/repair flow.
- Do not mutate arbitrary project repos by default.
- Do not use Codex to update Claude Code or Claude Code to update Codex.
- Refuse downgrade unless the user explicitly requests `--force-downgrade` for recovery.
- Keep hooks optional and policy-light; critical policy must stay in docs, validators, and the shared updater.

## n8n Plugin Path Note

Official `n8n-io/skills` plugin setup is owned by n8n setup guidance. Marketplace registration alone is not installation. Verify `n8n-skills@n8n-io` is installed and enabled, not merely available. On Windows, repair and audit the current installed plugin cache path under `.codex/plugins/cache/n8n-io/n8n-skills/<version>` before trusting hooks. The current version must come from positive Codex installed state or the bounded single-candidate config/cache fallback, never cache directory ordering. Trusted Toolkit Codex startup hooks may repair an exactly recognised supported upstream layout again after future plugin updates when Codex plugin cache auto-refresh is enabled. Already repaired layouts are a no-op; retained historical caches are skipped; partially repaired, moved, ambiguous, malformed, or unknown current versions fail closed. Startup reconciliation proves repaired bytes for later hook discovery; it does not claim that Codex re-reads another plugin's already-discovered command during the same SessionStart event. After an upstream refresh, the deterministic pre-session path remains the approved Toolkit n8n repair before restarting Codex, and native UAT must record first-session behavior. Do not repair or audit temporary marketplace checkout paths such as `.codex/.tmp/marketplaces/n8n-io/plugins/n8n-skills`.

Route `repair n8n plugin`, `fix n8n skill hooks`, `repair the n8n Skills plugin`, and questions about n8n `.sh` hooks opening in VS Code to this bounded installed-plugin inspection/repair path. Before acting, distinguish the target:

1. Installed Codex `n8n-skills@n8n-io` cache: inspect the exact identity/version/layout and use the existing Windows hook reconciliation. The enabled Codex plugin-maintenance preference is standing permission only for the exact known-compatible transform.
2. Claude Code plugin: inspect and report through Claude Code's native plugin flow; Codex must not mutate Claude Code cache.
3. Toolkit source or generated skill: follow repository source ownership and regeneration rules, not installed-cache repair.
4. Consumer-repo `n8n-workflows/scripts/` helpers: route to the workspace helper ownership path; do not touch plugin caches.
5. Live n8n workflows, community nodes, Docker, or server operations: load the n8n safety/setup route and require its live-action approvals; do not trigger plugin-cache repair.

When the target is genuinely ambiguous, ask for the smallest numbered choice from the applicable targets above. Do not load every n8n or MCP skill merely because the word `n8n` appears.

Plain skill installs for OpenCode, AG2/Antigravity, or other folder-based targets do not include official n8n plugin hooks, so target repo instructions must cue `using-n8n-skills`.

## Validation

For bridge or setup-surface changes, prefer targeted checks first:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs
node repo/scripts/validate-toolkit.cjs
```

Run `node --test repo/tests/toolkit-local-bridge.test.cjs` when the change affects bridge behavior, hooks, target sync semantics, repo auto-update behavior, report cleanup, host-native cache behavior, or before PR/release validation. Run `npm run validate:all` only when broad validation is specifically warranted by the repo rules.
