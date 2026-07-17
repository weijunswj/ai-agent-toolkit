# Toolkit Local Bridge

This document defines the plugin/update architecture for `weijunswj/ai-agent-toolkit`.

## Current Source-Of-Truth Chain

Current inspected chain:

1. Root `AGENTS.md` routes repo work and includes the managed source-of-truth contract.
2. `_projects/**/_main/` stores full source material.
3. `_projects/**/curated_output_for_ai/` stores reviewed AI-facing adapters, routers, and metadata.
4. `_projects/**/toolkit.project.json` declares generated outputs and write boundaries.
5. `_projects/**/SOURCE-LOCK.json` records first-party or third-party provenance.
6. `repo/scripts/sync-toolkit-projects.cjs` publishes declared generated outputs.
7. `skills/**` is the generated copyable skill surface.
8. `repo/scripts/validate-toolkit.cjs`, `repo/tests/*.test.cjs`, package checks, source-lock audit, and published-surface audit enforce drift and safety rules.
9. `.codex-plugin/**` and `.claude-plugin/**` are native plugin package metadata generated from the Toolkit project module. They are not source of truth.
10. The Toolkit Local Bridge Hub under the user profile stores generated OpenCode and Antigravity 2 adapter state. It is not source of truth.

## Architecture

Codex and Claude Code update Toolkit through their own native plugin systems.

- Codex uses `.codex-plugin/plugin.json`.
- Claude Code uses `.claude-plugin/plugin.json`.
- Both native package manifests point at the same Toolkit `skills/` surface.
- Both native packages use hooks only for optional bridge autocheck, passive repo-local instruction managed-block preflight, and enabled-target auto-sync.
- Codex never installs or updates Claude Code.
- Claude Code never installs or updates Codex.
- Toolkit does not publish to public marketplaces from this repo. Marketplace-ready metadata is present in the manifests, but publication remains a separate human action.

The shared bridge manages only non-native local adapter targets:

- OpenCode global skills.
- Antigravity 2 plugin-scoped local adapter skills under the Gemini config plugin root.

OpenCode and Antigravity 2 are opt-in. The bridge may detect them during audit or hook autocheck, but it must not write target files until the user explicitly enables that target.

## Local Bridge Hub

Default hub paths:

| Platform | Path |
|---|---|
| POSIX | `~/.ai-agent-toolkit/current` |
| Windows | `%USERPROFILE%\.ai-agent-toolkit\current` |

The hub contains:

- `manifest.json`.
- `state.json`.
- `adapters/opencode/**`.
- `adapters/ag2/**`.
- Version and checksum data.
- Managed Toolkit skill payload metadata, including the current Toolkit skill names written to non-native targets.
- Source commit or `unknown` when Git metadata is unavailable.
- Sync source: `repo`, `codex-plugin`, or `claude-plugin`.
- Per-source bridge versions in `bridge_versions_by_source`, allowlisted to `repo`, `codex-plugin`, and `claude-plugin`.
- A monotonic `hub_version` compatibility/reporting watermark. New bridges do not use it as downgrade authority.
- Sync timestamp.
- Repo auto-update state: `repo_auto_update_enabled`, `repo_path`, `repo_branch`, `repo_remote`, `last_repo_update`, `last_repo_update_status`, `last_repo_update_from_commit`, `last_repo_update_to_commit`, and `last_repo_update_error`.
- Update-report state: `last_update_report_path`, `update_report_enabled`, failure-only opening behavior, `update_report_retention_days`, max retained report count, and last cleanup status. Legacy `update_report_open_enabled=true` is retained only as migration evidence and is normalized to failure-only behavior.
- Codex plugin cache auto-refresh preference: `codex_plugin_auto_refresh_enabled`. On Codex/Windows, this same opt-in also allows trusted Toolkit startup hooks to repair Windows-unsafe installed third-party Codex plugin hook caches after plugin updates.
- Target paths.
- Target detected, enabled, disabled, stale, and synced state.

The lock file lives beside the hub at `%USERPROFILE%\.ai-agent-toolkit\update.lock` or `~/.ai-agent-toolkit/update.lock`.

Writes are rename-first and atomic in the normal case. On Windows, when the final staging-to-`current` directory rename is blocked by a transient `EPERM`, `EBUSY`, or `ENOTEMPTY` after the previous target has already been moved to a backup path, the bridge may fall back to copying the validated staging directory into the empty target path and then cleaning up staging plus backup. If the fallback copy fails, it removes the partial target and restores the backup.

### Owned Staging Generations

Every bridge-created hub or target staging directory uses a generation-scoped ownership protocol. Before `mkdir`, the bridge exclusively creates an immutable sidecar that binds Toolkit owner/schema, generation ID, random ownership token, exact staging path and parent, exact final target, operation and source type, process lease identity, creation time, bridge version, and initial state. After `mkdir`, a second sidecar and an in-directory marker bind the token to the directory identity. Completion and handled failure use separate token-bound state markers.

The bridge cleans only its current proven generation in `finally` handling after success, payload-write failure, staged validation failure, replacement failure, and rollback. Initialization cleanup removes an unmarked partial directory only when the current invocation's own `mkdir` succeeded and the directory still has the identity captured immediately afterward; `EEXIST` and every other ambiguous creation result preserve both sidecar and directory for review. Immediately before deletion it revalidates the exact parent, target, generation ID, token, path containment, ordinary directory type, real path, directory identity, and unchanged ownership record. Ambiguous ownership is preserved and reported instead of deleted. A dead PID is only one liveness signal; it never establishes ownership or authorizes cleanup, and a reused live PID remains protected.

Ordinary `--audit` includes a bounded `staging_generations` inventory. It distinguishes live owned, dead safely attributable, completed awaiting cleanup, malformed, ownership-mismatched, unrelated matching, historical unmarked, special filesystem object, and indeterminate entries. Historical `.staging-*` directories without the new ownership format are reported but never modified.

Safe reconciliation stays inside the existing bridge command family and is dry-run first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id>
node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id> --write
```

The write form is the established explicit approval convention. It acquires the bridge lock, constructs the exact generation sidecar path under every approved managed parent, requires exactly one candidate across the complete parent set, and revalidates ownership immediately before mutation. This exact lookup is independent of the bounded general audit, which remains supplemental diagnostics only. It refuses live, indeterminate, malformed, mismatched, escaped, symlink, junction, reparse-point, or unrelated targets. Repeating an already successful exact reconciliation is a no-op only after absence was checked under every approved parent. Never use a generic recursive `.staging-*` cleaner or delete by name, timestamp, or dead PID.

Reconciliation uses an isolated command route before hook no-op handling, requested-state application, update-report retention cleanup, report writes/opening, repo auto-update, target sync, native plugin refresh, hook repair, or ordinary state persistence. Its accepted controls are limited to `--reconcile-staging`, optional `--write`, `--hub`, `--sync-source`, `--force-downgrade`, `--opencode-config-dir`, and `--opencode-target`; every other bridge flag is rejected before mutation. Dry-run creates no lock. Write mode may acquire and release the existing bridge lock, then remove only the exact generation and ownership sidecars.

Post-merge native Windows UAT for issue #247 must:

1. Use an isolated Windows fixture to prove success and handled payload, validation, replacement, and rollback failures create no staging residue.
2. Create one safely attributable abandoned new-format generation and prove audit identifies it.
3. Prove live and ambiguous generations are preserved.
4. Reconcile only the explicitly approved abandoned fixture generation, first by dry-run and then with `--write`.
5. Verify no lock, recovery marker, displaced evidence, ownership sidecar, or new staging residue remains in the fixture.
6. Refresh Codex and Claude Code separately after merge.
7. Confirm each host runs its own installed cache with its own `codex-plugin` or `claude-plugin` source identifier.
8. Confirm one host refresh does not mutate the other host cache.
9. Confirm repo, Codex, and Claude source-version state remains isolated and same-source downgrade protection remains active.
10. Leave the real 17 historical unmarked staging directories unchanged.

1. Write a staging directory.
2. Validate staged `manifest.json`, `state.json`, OpenCode adapter output, and Antigravity 2 adapter output.
3. Rename staging into `current`.
4. For OpenCode target sync, write into the OpenCode `skills/` root and atomically replace only Toolkit-managed skill folders.
5. For Antigravity 2 target sync, write into the local `ai-agent-toolkit` plugin root and atomically replace only Toolkit-managed skill folders under that plugin's `skills/` directory.
6. Remove only skill folders listed in the previous Toolkit-managed target manifest when they are no longer part of the current Toolkit skill set. Preserve unrelated user-created skills and unrelated files.

Locks are owner-aware. Each lock records the PID of the process that created it, and acquisition classifies that owner with a signal-0 existence probe before deciding anything:

- A lock whose recorded owner is a live process is always respected and never deleted, regardless of age. Hook runs skip safely; manual runs fail with the owner PID in the message.
- A lock whose recorded owner is provably dead (no such process) is recovered immediately, even when the lock file is younger than the stale-age threshold, so a killed bridge run cannot wedge later setup or hook runs.
- A lock with a missing, malformed, or non-positive PID keeps the pre-existing age rule: fresh locks cause a safe skip, stale locks are removed before retry.
- An indeterminate liveness probe (for example permission denied) is not proof of death and also falls back to the age rule.
- A lock file with unreadable JSON or an unparsable `created_at` uses the file mtime for the age rule, so a mid-write lock from another process is not treated as instantly stale.
- The bridge never signals the recorded owner for real.

Recovery of a recoverable lock is race-safe through an atomic recovery claim and per-run ownership tokens:

1. Every acquisition, including the no-main-lock path, claims the existing recovery marker before its authoritative displaced-evidence inspection and keeps that marker through any evidence retirement, main-lock recheck or recovery, and exclusive main-lock creation (`wx`). An optional initial evidence inspection can only fail fast; it never authorizes creation. This serialization makes evidence validation and no-lock ownership commitment one race-safe protocol, so evidence created after an initial scan is seen before creation and no replacement writer can enter behind a recoverer.
2. A recoverable lock may only be displaced by the process that first exclusively creates the `update.lock.recovery` marker. The exclusive marker create is the atomic recovery claim: two contenders that inspected the same dead lock serialize on it, and the loser never deletes anything.
3. Reclaiming a marker left by a dead or stale recovery is itself atomic and identity-safe. The reclaimer must first exclusively create a tombstone named after a hash of the exact marker bytes it inspected; contenders that inspected the same marker generation compute the same tombstone path, so exactly one wins, and the tombstone is never deleted by the protocol (spent tombstones are only aged out after 24 hours, far beyond any contender's inspect-to-claim window). The winner re-reads the marker under its tombstone and proceeds only when the bytes are still the inspected generation; any change means another process cycled the marker and the reclaimer yields without touching it. A marker owned by a live process is never reclaimable.
4. While holding the marker, the recoverer re-inspects the lock. A replacement written in the interim has a live owner and is respected untouched.
5. The recoverable lock is displaced by rename (not deleted in place) and the displaced file's owner is verified not alive before it is discarded. A displaced generation that cannot be proved safe to discard is never renamed back over `update.lock`, because destination replacement semantics cannot guarantee no-clobber restoration across supported platforms. It remains preserved on disk as evidence, this contender does not write a replacement, and the skip/error message names the preserved path. This remains true even when the main path looked free before the preservation decision; a concurrently created main lock is never altered.
6. The replacement lock is exclusively created and carries a unique per-run ownership token in addition to the PID. The marker is then released by its own token.
7. Preserved displaced evidence is a persistent fail-closed acquisition barrier, not just a one-run refusal. Every acquisition -- including the no-main-lock path -- authoritatively inspects `update.lock.displaced.*` evidence while owning the recovery marker before creating anything, so a later or already-running contender does not acquire merely because the recovery marker was released, the intruding main lock went away, or the evidence is old. While the recorded owner is alive the evidence blocks and is never deleted, protecting a long-running displaced owner indefinitely; an owner whose liveness is indeterminate (for example a permission-denied probe) also fails closed; evidence with unusable owner data uses the age fallback. Evidence enumeration, read, or age-inspection failures also fail closed because unreadability is not proof of absence or death; only `ENOENT` proves that a particular enumerated or retirement-verified path vanished. Hook runs skip and manual runs fail with the preserved evidence path and precise reason; the messages never tell the user to delete evidence that may belong to a live owner.
8. Once the displaced owner is provably dead, the evidence is retired under recovery-marker ownership through the same atomic identity-safe tombstone protocol as marker reclaim (exclusive tombstone on the inspected bytes, verify-under-claim, yield untouched if the generation changed). `ENOENT` during verification means that generation genuinely vanished; every other read failure preserves the evidence and blocks. Exactly one contender retires each generation, and the barrier cannot become a permanent wedge after the owner dies. Artifact cleanup ages out only exact Toolkit-owned recovery-claim tombstones (`update.lock.recovery.claim-<16 hex>`) and displaced-evidence retirement tombstones (`update.lock.displaced.<UUID>.retired-<16 hex>`); it never deletes displaced evidence, unrelated similarly suffixed files, or directories.

Release removes the lock only when the current lock file still carries that run's ownership token: a lock replaced by another process is never deleted, even by the process that previously owned that path. Marker release is equally token-guarded. Locks are released in normal success and caught-failure paths; recovery from abrupt process termination relies on the dead-owner rule above, not on cleanup code running after a forced kill.

Every successful state write rereads the latest state while holding this authoritative lock. From that locked state generation, the bridge resolves the Toolkit source again and rebuilds adapter payloads, checksum, discoveries, target plans, skipped-target context, manifest inputs, and related report context before writing. Pre-lock derived values are audit-only and are never combined with a later locked state in a committed snapshot. The write preserves unrelated top-level and forward-compatible fields, updates only the running source in `bridge_versions_by_source`, and preserves every other recognized source entry. `hub_version` is then calculated as the maximum of its existing valid value and every valid per-source value, so an older source run or forced same-source downgrade cannot lower the compatibility watermark. Staged hub replacement remains atomic and crash-safe under the existing transaction.

An active `--write` run persists this prepared source state after it acquires the lock even when no target, repo, cache, repair, or report action is needed. Report eligibility is evaluated only after that first snapshot; report metadata causes a second snapshot only when a report is actually created. A fully disabled hook remains a deliberate early no-write return when repo auto-update and auto-sync are disabled, or when no enabled target or maintenance action makes the hook active. Lock contention also remains a visible hook skip and does not claim that an unpersisted source version was recorded.

Downgrade enforcement is source-scoped. A running bridge compares itself only with `bridge_versions_by_source[sync_source]`; a newer repo, Codex, or Claude Code entry never blocks another source. `--force-downgrade` bypasses only that same-source comparison and updates only the running source entry. New bridges never use `hub_version` for downgrade enforcement.

Old state migrates lazily. When a valid legacy `hub_version` has one recognized `last_sync_source` and no usable per-source history, only that attributed source is seeded. Missing or unknown attribution seeds nothing, so an unattributed legacy watermark cannot cross-block a recognized source. Once any usable per-source history exists, `hub_version` is not used to infer a missing source entry. Arrays and other non-map values are treated as absent; unsupported and prototype-polluting keys are discarded; invalid values assigned to recognized source keys fail visibly instead of silently weakening same-source protection.

In hook mode a genuine same-source rollback skip is printed to stdout with source-specific remediation. For `claude-plugin`, run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then restart Claude Code; the supported raw native update is `claude plugin update ai-agent-toolkit@ai-agent-toolkit-local --scope user`, followed by setup if reinstall is required. For `codex-plugin`, run `setup toolkit` in Codex. For `repo`, update or restore the managed Toolkit source checkout.

### Mixed Cache Rollout

Native hooks execute independently cached bridge copies, not the source repository copy. A source patch or one refreshed host cache does not repair another host's older cache. During rollout, a new Codex cache may write per-source state while an old Claude Code cache still uses the legacy global `hub_version` guard; that old Claude bridge may continue to self-block until its own cache is refreshed. The issue is fully resolved on a machine only after every affected native host cache has the fixed bridge.

Required post-merge refresh flows:

- Codex: run `setup toolkit` in Codex.
- Claude Code: run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then restart Claude Code.

## Shared Updater

The canonical updater is [toolkit-local-bridge.cjs](../scripts/toolkit-local-bridge.cjs).

Dry-run is default:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Write mode requires explicit `--write`:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
```

Supported flags:

- `--enable-target opencode`.
- `--enable-target ag2`.
- `--disable-target opencode`.
- `--disable-target ag2`.
- `--sync-enabled`.
- `--enable-auto-sync`.
- `--disable-auto-sync`.
- `--enable-repo-auto-update`.
- `--disable-repo-auto-update`.
- `--repo-path <path>`.
- `--repo-branch <branch>`, default `main`.
- `--repo-remote <url>`, default `https://github.com/weijunswj/ai-agent-toolkit`.
- `--repo-update-now`.
- `--audit`.
- `--reconcile-staging <generation-id>`; dry-run by default, exact generation cleanup only with `--write`.
- `--open-update-report`.
- `--enable-update-reports`.
- `--disable-update-reports`.
- `--update-report-retention-days <days>`, default `7`.
- `--enable-update-report-open` and `--disable-update-report-open` remain compatibility flags; both retain failure-only opening and never restore success-report auto-opening.
- `--enable-codex-plugin-auto-refresh`.
- `--disable-codex-plugin-auto-refresh`.
- `--force-downgrade`.
- `--python-command <command>`.
- `--set-ag2-python-command <command>`.
- `--sync-source repo|codex-plugin|claude-plugin`.

The updater must not:

- Install npm, pip, Python, Antigravity 2, OpenCode, Codex, or Claude Code.
- Manage Codex plugin installation or update.
- Manage Claude Code plugin installation or update.
- Mutate project repositories by default.
- Write outside the current user home or temp directories.
- Use Codex or Claude private plugin cache paths as source.

## Codex Native Plugin Install And Verification

Codex native plugin installation is Codex-only and separate from the shared bridge updater. The supported local install path uses Codex local marketplaces:

```powershell
codex plugin marketplace add "<local-ai-agent-toolkit-repo>" --json
codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json
```

The local marketplace wrapper lives at `.agents/plugins/marketplace.json` and exposes this repo root as `ai-agent-toolkit@ai-agent-toolkit-local`. The plugin package manifest remains `.codex-plugin/plugin.json`. The wrapper must use `policy.authentication: "ON_USE"`, not `ON_INSTALL`, so a no-auth local Toolkit plugin can install headlessly before any hook trust prompt.

For `setup toolkit`, `refresh toolkit`, or plain `refresh` in a Toolkit setup/update context, agents must run the full script-backed journey even when Toolkit is already installed:

```powershell
node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main
```

```sh
node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main
```

Append `--host claude-code` for Claude Code. Use `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main` from the active repo only as bootstrap/fallback when the managed checkout script is missing. If fallback/bootstrap is used, say it is bootstrap-only and hand off to the managed checkout script after the managed checkout exists.

The orchestrator discovers current state, renders one compact semantic setup wizard before preference or target writes, then runs to completion unless a real safety blocker appears. The same model drives chat text, terminal prompts, piped answers, flags, plans, JSON, summaries, and execution. It uses a managed clean `main` checkout as the default source for setup, not the active Codex or Claude Code conversation worktree. This routine is root-agent work: agents must not spawn subagents to inspect setup instructions, docs, state, choices, or validation output.

Exit code `23` or a required-answer question-bank message is an intentional stop for user input. In chat, agents must emit the complete compact bank as ordinary visible text in the same response as any recommended-default shortcut. Hidden tool output and summaries do not count. If rendering is missing, setup retries the safe pre-write request once; a second failure blocks approval and writes. Agents must not rerun with `--yes-recommended` unless the user explicitly requested the displayed recommended choices in the current turn. If the managed setup script exists but pauses or hits a real safety blocker, do not bypass it with the active repo fallback.

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

Default managed source path:

- Windows: `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit`
- POSIX: `~/.ai-agent-toolkit/source/ai-agent-toolkit`

Setup creates or verifies that checkout, validates the expected remote, refuses dirty worktrees, fetches `origin main`, updates only by fast-forward, runs hook-light validation, and makes it the default `repo_path` for repo-backed auto-update. If the active Toolkit worktree is on a PR branch, setup warns that the active session may remain there and continues with the managed clean `main` source.

The wizard groups consequential decisions under `Automatic updates`, `Computer performance`, and `Other coding apps`. One resolved semantic row supplies the stable ID, title, what the setting controls, effective current behavior, available choices and their consequences, recommendation and reason, capability conditions, privacy-safe fallback, and after-apply effects. Interactive, piped, plan, JSON, approval-summary, execution, and generated-documentation representations consume that same row. Rendered blocks use this order with readable spacing: title, **What this controls:**, **Current:**, **Recommended:**, **Why:**, **Choices:**, then **After applying:** when relevant. The deterministic [Toolkit setup question reference](SETUP-QUESTIONS.generated.md) uses a privacy-safe representative state and is checked by Toolkit validation. Raw paths, runtime names, TOML keys, ownership, backup, and restore details stay out of the primary bank; pending exact PR #237 legacy migration is the one case that visibly adds a `migrate` choice. OpenCode and Antigravity rows are omitted unless detected or already enabled; Claude choices appear only on the Claude setup path. Unexpected extra non-empty piped answers are rejected for every host before mutation, while whitespace-only trailing input is normalized away. Report creation and retention remain under automatic maintenance, but report auto-open is no longer a question: action-required reports open automatically and successful reports stay closed.

The canonical Codex question is `Codex helper agents` and recommends root-only because the strict managed launch contract is unsupported, with one-helper manual backstop, keep-current, and direct custom-number outcomes listed separately when the detected runtime supports them. Its controls, effective current behavior, recommendation and reason, choice consequences, and post-approval effects come from the same structured model used by terminal, piped, plan, JSON, approval-summary, and generated-documentation output. A generic advanced submenu is never shown. Exact Toolkit-owned removal appears only when removable controls are present. When an exact existing Toolkit setting requires an update before ordinary capacity choices can apply, the bank shows only keep-current and the exact update outcome; empty input and `--yes-recommended` preserve the existing setting. Existing unsafe capacity carries a visible memory-risk label. Unknown or unsupported runtimes show no capacity choices that would require unsupported writes. Runtime-specific keys and root-inclusive capacity arithmetic appear only in the technical proposal. Structurally complete user-owned controls that already match the selected effective helper outcome remain byte-for-byte unchanged without `apply`, editor, backup, replacement, or Toolkit markers. When different replaceable user-owned effective controls require replacement, setup immediately prints the exact runtime, target file, before/after behavior, affected keys, structural block, backup generation metadata, and shell-safe PowerShell/POSIX restore commands, then requests one `apply` confirmation. Unsupported MultiAgentV2 child tables and explicit false or non-boolean V2 enablement are never approvable and stop before setup mutation. Approval is bound to that exact preview-time config snapshot and proposal identity. If the config changes before the final operation, setup stops before editor invocation or backup, says the helper selection remains unapplied, and requires a fresh proposal; unrelated setup operations may already have completed and are not falsely reported as rolled back. Verification after managed setup uses the managed checkout verifier. Codex agents verify and refresh only the Codex native Toolkit plugin cache installed by the supported plugin flow, and hook trust guidance identifies the executing SessionStart bridge in that installed cache, while the managed checkout is only its refresh source. Claude Code verifies `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json`, then follows the equivalent isolated Claude cache path. Routine setup uses `repo/tests/toolkit-local-bridge-hook-light.test.cjs`; the full bridge suite remains reserved for bridge changes, PR review, and release validation.

Official Codex source at commit `2f7d89b1419bf7064346855b0acde23514b1ebc5` confirms effective runtime selection through `multi_agent_v2` before `multi_agent`, MultiAgentV2 table activation through `enabled = true`, session capacity at `[features.multi_agent_v2].max_concurrent_threads_per_session`, and root-inclusive total-thread semantics. V2 rejects legacy `agents.max_threads` when enabled. MultiAgentV2 also supports root and helper usage hints, which Toolkit uses for compact root-only-by-default policy. Helpers still receive spawn capability, so recursive-helper prevention is policy-only rather than a verified hard block. No documented Codex Security scan-scoped capacity activation exists in that source. Toolkit therefore never raises normal capacity automatically; alternatives include a lower-capacity ordinary or sequential review, Deep Scan on another sufficiently provisioned machine, or an explicitly approved temporary global increase with backup and restoration.

The Codex helper count is a conservative memory backstop, not an active topology profile or launch permission. Current Codex plugin packaging has no custom-agent component, `SubagentStart` cannot stop a launch, and parent live runtime overrides are reapplied to children. Toolkit therefore cannot prove adaptive pre-spawn admission or a child-only standard-speed override for built-in, plugin, Security, third-party, or nested Codex paths. Those paths remain unsupported under the strict medium/non-fast contract rather than receiving a false enforcement claim.

Claude Code 2.1.198 exposes the required external-session CLI controls, but CLI controls and installed bytes alone do not establish a strict Toolkit profile. Strict direct/root-only state additionally requires supported native plugin inspection to report both trust and active hook execution for the exact current plugin version/cache. The persisted proof binds installed-cache identity, hook bytes, controller bytes, and plugin version. Setup cannot create this proof, and install/update/restart/trust instructions are pending actions rather than proof. Missing, false, stale, malformed, wrong-version, or wrong-cache proof leaves strict state root-only/unapplied and invalidates a kept strict profile.

This is Toolkit-controlled launch enforcement, not global Claude enforcement. Native agent teams, built-in paths, user-created agents, third-party/plugin agents, Security or named workflows, and direct user CLI invocations outside the controller remain outside Toolkit admission. `SubagentStart` is observable but too late to block; plugin agent definitions alone are lowest-precedence definition enforcement and are not used as proof of effective mode. Broader-native mode deliberately permits those outside paths without claiming coverage. Codex and Claude limitations and profile files are separate; neither host's state proves or mutates the other's behavior.

### Claude Toolkit-Managed Direct Admission

Setup exposes separate canonical Claude topology and capacity rows from one capability result used by flags, plans, JSON, TTY, piped input, defaults, and execution. Toolkit-direct automatic/manual admission appears only when exact CLI controls, native trust/active proof, installed bytes, and a supported validated resource counter all verify. Every direct admission also revalidates current enabled/trusted/hook-active state and the exact cache, hook, and controller identity before reservation. Root-only and broader-native use root-only/not-applicable Toolkit admission capacity, but topology remains independent: broader-native is persisted as broader-native and permits native `Agent`/`Task` outside Toolkit admission; root-only and direct deny native bypass. Keep-current resolves a supported topology before capacity reconciliation, so root-only capacity preserves valid broader-native state while unsupported or stale state still fails safely to root-only.

Before launch, the controller validates distinct meaningful child and parent responsibilities, root-owned integration and validation, material benefit, and depth 1. It rejects delegating all substantive work, duplicate parent/child scope, waiting/polling/narration-only parent work, nested launches, unverifiable effort, and unjustified higher effort. The root must begin the declared retained work immediately after `start`; semantic compliance after process return remains observable behavior rather than an operating-system primitive, while the declaration and non-overlap gate are enforced before launch.

The automatic controller reads physical memory availability plus commit/pagefile headroom from Win32 operating-system counters on Windows or `/proc/meminfo` on Linux. Setup treats this resource-admission capability separately from CLI launch capability. Unsupported platforms and malformed, non-integer, overflowed, contradictory, or unavailable counters omit/refuse automatic and manual direct profiles; manual capacity never bypasses resource safety. At launch, unknown or critical-pressure state returns `refuse-root-only`. The controller retains substantial physical and commit reserves, subtracts active reservations and the requested worker estimate, and queues only bounded temporary pressure.

Before admission, the controller produces the exact UTF-8 prompt bytes once and enforces the 1 MiB bound. An oversized prompt returns a synchronous safe refusal and creates no reservation, queue entry, job specification, output/error artifact, or detached supervisor. Accepted bytes are serialized losslessly for the supervisor and sent only through stdin. Managed children use `--no-session-persistence`, and the detached supervisor inherits the exact preflight environment without serializing environment values into Toolkit artifacts or argv. The child adds only the existing non-fast, no-background, and child-marker overrides. One atomic directory lock then protects stale recovery, queue insertion, and reservation creation. A detached Toolkit supervisor owns only its reservation/child and releases on launch, stdin transport, or child-exit failure.

Launch a reviewed specification with:

```powershell
node repo/scripts/toolkit-agent-control.cjs launch --spec path/to/launch-spec.json
```

The result is exactly `start`, `queue`, or `refuse-root-only`. `queue` entries expire after ten minutes and are visible through `node repo/scripts/toolkit-agent-control.cjs status`. Retry the same reviewed specification with the returned `queue_id`; only the oldest live entry can start, so later parents cannot leapfrog it. Refusal reports only the safe root-only action and no private process details.

Toolkit snapshots original bytes, topology, mode, and available identity metadata, validates TOML structure with Python 3.11+ standard-library `tomllib`, and binds the displayed proposal to that snapshot plus target path, runtime, helper count, affected keys, proposal digest, and backup generation. The final writer first proves the current target still matches the approved snapshot and retains that snapshot as its initial transaction baseline; it cannot silently replace consent with a fresh baseline. Only then may it ask official Codex app-server `config/batchWrite` to produce a proposal inside an isolated temporary `CODEX_HOME`. Runtime detection accepts V1-only or V2-only supported feature rows, gives enabled V2 precedence, otherwise uses enabled V1, and treats supported boolean-disabled rows as disabled; malformed, duplicate, contradictory, or unusable responses remain unknown. MultiAgentV2 uses independent exact markers for Toolkit-owned enablement, capacity, root guidance, and helper guidance. Pre-existing table enablement stays unmarked and byte-preserved; migrated boolean enablement remains unmarked user intent; fresh Toolkit enablement is independently marked and removed with Toolkit capacity. Exact proposal-delta validation rejects unrelated changes before atomic commitment. The complete exact PR #237 Toolkit-managed V1 block retains its existing explicit migration path. A malformed historical Toolkit marker region has a separate repair path only when the regular active Codex user config is valid UTF-8/TOML, the effective runtime has exactly one explicit supported table, every affected marker and canonical assignment is isolated inside it, and exact affected byte ranges can be proven. For each malformed category, classification derives one implied span from its matching marker, the nearest structurally valid neighbouring category in canonical family order, or the enclosing table boundary. The category's exact canonical assignment must occur inside that span, every other line must be a recognised marker in the one deterministic repair region or blank, and all category spans must be contained, deterministic, and non-overlapping. The visible proposal binds those spans, removal ranges and their hash, marker/assignment categories, affected keys, legacy/current replacement decision, proposal digest, full snapshot, filesystem identity/mode, runtime, helper count, and backup generation. Snapshot drift is rejected before editor invocation, backup, and atomic replacement; final semantic failure restores the exact original. An isolated marker-only repair may preserve compatible user-owned values byte-for-byte and writes no ownership markers. Inspection, planning, SessionStart, and ordinary reads never repair. Exact managed ownership still allows safe removal even when effective runtime detection is disabled or unknown. Temporary editor cleanup waits for actual child exit, uses bounded process-tree termination when EOF is insufficient, retries transient Windows locks with bounded backoff, and reports persistent residue honestly. Existing files receive exact-byte backups; missing files receive restore metadata. Restore validates generation-local paths, topology, modes, sizes, and hashes before mutation. Setup prints the verified absolute setup script and safely quoted PowerShell/POSIX restore commands that work outside the Toolkit checkout. Plugin, validation, preference, target, and final bridge-audit operations complete before config commitment, which remains the final fallible setup operation.

Malformed delegation classification is intentionally narrow:

| Synthetic class | Result | Reason |
| --- | --- | --- |
| Recognised begin without end | Repairable only when its full implied span through the next valid category boundary or table end contains its exact canonical assignment, recognised repair markers, and blanks | A trailing user line cannot escape validation after the assignment. |
| Recognised end without begin | Repairable only when its full implied span back to the previous valid category boundary or table start contains its exact canonical assignment, recognised repair markers, and blanks; a boundary-isolated marker-only case may preserve compatible user values | A leading user line cannot escape validation before the assignment. |
| Duplicate recognised marker | Repairable only for one malformed category with exactly one extra begin or end marker and one deterministic isolated span | Two duplicated categories, duplicates on both boundaries, and multiple candidate spans remain invalid/ambiguous. |
| Reversed marker order | Repairable only when the two same-category boundaries produce one deterministic exact span containing only that category's canonical material | The span cannot overlap another malformed category or absorb another category's assignment. |
| Incomplete legacy PR #237 block | Repairable only for the effective V1 `[agents]` table with exact `max_threads` and `max_depth = 1` material | Cross-runtime inference is not allowed. |
| Legacy and MultiAgentV2 markers coexist | Fail closed | Mixed ownership families are ambiguous. |
| Unsupported assignment inside recognised markers | Fail closed | Toolkit ownership of the extra key is unproven. |
| Exact owned assignments beside malformed markers | Repairable only when the complete required assignment set is canonical and content-isolated | The assignment bytes and ranges are proven Toolkit material. |
| Marker outside the expected table | Fail closed | A marker may not cross or target another table. |
| Unknown or obsolete marker | Fail closed | Ownership semantics are unknown. |
| User-owned assignment or comment interleaved | Fail closed | Removing the region could capture user content. |
| Multiple target tables or unsupported child tables | Fail closed | There is no unique supported structural target. |

Invalid UTF-8/TOML, dotted/inline target tables, explicit conflicting user enablement, symlinks, junctions, reparse points, special files, multiple candidate regions, and any approval or transaction drift also remain fail closed. Decline, stale approval, or any pre-commit failure creates no configuration write; committed replacement failures roll back exactly.

Before reporting `setup toolkit` complete, run:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --verify
```

If the plugin is missing, disabled, stale, points at another source path, has same-version cache content that does not match this repo, or its installed plugin cache does not contain the current Toolkit manifest version with `.codex-plugin/hooks/hooks.json` and a Codex `SessionStart` hook, install or update it with:

```powershell
node repo/scripts/setup-codex-toolkit-plugin.cjs --write
```

The verifier uses only supported Codex plugin commands. If no usable Codex CLI with `plugin marketplace` support is available, or if local marketplace installation fails, setup must fail clearly instead of pretending native plugin activation completed.

Claude Code has the same three behavior choices in the setup question bank: `keep`, `instructions`, and recommended `install`. Installation freshness requires the reported identity, version, enabled state, exact source path, exact installed-cache path, and byte-for-byte current manifest, hooks, controller, process-launch helper, and native-agent hook. Strict enforcement is a separate result requiring host-reported `trusted: true` plus active hook execution. Activation-proof schema 3 binds the exact cache identity and SHA-256 hashes for hooks, controller, process-launch helper, and native-agent hook; every bound installed path must be a non-symlink regular file, and schema-2 proof fails closed as stale. If the host does not expose a supported active indication, setup reports strict enforcement unavailable rather than inferring it from bytes or enabled state. Setup uses supported marketplace/install/update commands and `--scope user`; it never writes trust state or treats restart guidance as activation proof. Codex must not install or update Claude Code, and Claude Code must not install or update Codex.

Every Claude invocation path uses `repo/scripts/claude-process-launch.cjs`: plugin list/install/update, bounded capability and version probes, and direct workers share identical executable validation and argument boundaries. Relative path-like values are rejected on every platform. Direct launch refuses known-missing bare or explicit executables before admission. Availability preflight resolves symlinks only to require a regular executable target; broken, cyclic, directory, special-file, or non-executable targets refuse. POSIX bare `claude` remains unpinned so the official launcher can update its symlink target. Windows bare names exclude cwd and relative PATH entries, resolve to one absolute PATH candidate during preflight, and carry that candidate into execution; project-local `.cmd`, `.bat`, or `.exe` shadows cannot run. `.js`/`.cjs`/`.mjs` and explicit `.exe` paths run without a shell; explicit `.cmd`/`.bat` paths use `cmd.exe /d /s /v:off /c` with command and argument metacharacters escaped. Empty, quoted, control-character, ambiguous, or known-missing executable inputs are rejected. Children deny both `Agent` and legacy `Task`; prompts remain stdin-only.

Admission lock ownership is published in a private `state.lock` directory. The `state.lock.recovery` marker publishes the same private PID, creation-time, and acquisition-token contract. Fresh ownerless/malformed locks or recovery markers are preserved through publication, and valid live owners are never reclaimed. Stale dead, ownerless, or malformed primary locks and recovery markers recover only after the bounded TTL; an interrupted recovery can therefore not wedge admission permanently, and contenders remain serialized. Reservation update/release first validates the complete state and leaves malformed JSON, future schemas, contradictory identities, invalid reservations, or invalid queue entries byte-for-byte unchanged.

Claude plugin mutations (`plugin update` and `plugin install`) are verification-driven, mirroring the Codex `plugin add` behavior. The helper launches the mutating CLI command asynchronously with ignored stdio, then polls `claude plugin list --json` through the state evaluator until the installed, enabled, current, source-correct state verifies. Success means the supported plugin state verified, not that the mutation process exited:

- If the state verifies while the mutation process is still running or did not exit cleanly, setup succeeds and emits a precise `did not exit cleanly, but installed-state verification passed` warning, then terminates or detaches only that direct child.
- A verified in-place update never falls back to an unnecessary uninstall plus reinstall.
- If the update mutation fails or its deadline expires without a verified state, setup keeps the reviewed fallback: uninstall, marketplace add, then a verification-driven install.
- Transient `plugin list` failures during polling are tolerated until the deadline; the final failure carries the last state errors and the last list error.
- A non-zero exit or a timeout is never treated as success unless the final supported state verification passes, and downgrade refusal is unchanged.

Polling is bounded by `CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS` (default 120000, capped at one hour) with poll interval `CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS` (default 500, minimum 25). Every polling wait is capped to the remaining deadline, and one final verification poll runs at the deadline, so an oversized poll interval can never keep the helper asleep past its advertised deadline. Overrides are parsed strictly: only a trimmed string of decimal digits within the documented bounds is accepted; partial-number forms (`100junk`, `100.5`, `1e3`), signs, empty or whitespace-only input, zero, negative, and above-maximum values fall back to the defaults. The setup orchestrator derives its outer timeouts for the Claude helper from the helper's exported `verifyBudgetMs()` and `writeBudgetMs()` worst-case budgets, so the outer `spawnSync` timeout can no longer kill a helper that is still inside its own supported verification deadlines; the outer timeout remains a finite backstop, and per-command CLI calls keep `CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS` (default 120000). Both budgets account for the full CLI candidate-resolution sequence: every distinct candidate the resolver can try (the explicit `--claude-cli` argument, `CLAUDE_TOOLKIT_CLAUDE_CLI`, `CLAUDE_CLI_PATH`, and bare `claude`, deduplicated exactly as the resolver deduplicates) is budgeted at one full probe timeout (`CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS`, default 10000, strict-parsed). The orchestrator computes the budgets with the exact explicit CLI argument and environment the child helper receives, and its static fallback constants match the default worst case of four distinct candidates. Known limitation: `plugin uninstall` and `plugin marketplace add` remain synchronous single commands with per-command timeouts because the plugin list cannot verify marketplace registration; their failures surface as warnings before the verification-driven install decides the final outcome.

The setup helper checks `codex plugin list --available --json` after `codex plugin marketplace add` before invoking `codex plugin add`. CLI list verification remains the preferred path. If the CLI list is empty or unreliable, the helper may use config/cache fallback verification only when Codex config enables `[plugins."ai-agent-toolkit@ai-agent-toolkit-local"]`, Codex config includes `[marketplaces.ai-agent-toolkit-local]` with `path` or `source` resolving to this repo root, optional `source_type` or `type` is absent or `local`, the installed cache exists under the Codex home plugin cache at `plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/<version>`, the cache manifest has the expected Toolkit name/version, and the cache hook file contains the Toolkit `SessionStart` hook. The fallback normalizes Windows paths and strips a leading `\\?\` before comparing the marketplace source path. Report this as config/cache fallback verification, not normal CLI verification.

If an installed same-version cache is stale, the helper removes `ai-agent-toolkit@ai-agent-toolkit-local` before reinstalling from the local marketplace. If plugin add is needed, the helper starts `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json` and polls `codex plugin list --available --json` plus the expected cache until verification passes. Treat setup as successful only when the verifier confirms the enabled current Toolkit manifest version, `authPolicy` `ON_USE` when available from the CLI list, the cached `SessionStart` hook, and package-critical cache files matching this repo; terminate or ignore a lingering add process and emit a warning when `codex plugin add` did not exit cleanly. If CLI and fallback verification never pass before the add deadline, report setup failure.

The portable Codex source manifest calls `toolkit-codex-session-start.cjs` instead of calling the bridge directly. During supported Windows setup, the helper atomically publishes and verifies cache-local `.codex-plugin/session-start-runtime.json` before replacing the portable installed-cache command with the exact PowerShell launcher. Interruption therefore leaves the previous source hook active, or valid runtime metadata plus that previous hook, until the final atomic hook switch. The PowerShell command uses the verified Windows PowerShell executable, `$env:PLUGIN_ROOT`, and `toolkit-codex-session-start.ps1`; it does not search interactive-shell `PATH`, use WSL, or depend on shell-style `${PLUGIN_ROOT}` expansion. Spaces and supported shell metacharacters remain data through `Join-Path` and PowerShell's call operator. The launcher inherits hook stdin/stdout/stderr. A missing runtime, unavailable Node executable, launcher exception, or returned non-zero hook outcome emits one concise repair warning and exits zero because this maintenance is optional. Direct manual bridge commands retain non-zero failures. Setup verifies the actual installed command, runtime metadata, and launcher bytes, and rejects the old direct bridge shape.

After install, update, or verify, the helper prints or returns a `**Next Steps:**` section. It tells the user to restart Codex if installation changed anything, open `/hooks` in Codex, and trust the current Codex `SessionStart` hook only when its installed command matches the host-specific verified shape. On supported Windows installs, the executing cache command is the normalized PowerShell form below (with the actual verified Windows directory); the portable Node form remains authoritative source for non-Windows installs only:

```powershell
"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& { & (Join-Path $env:PLUGIN_ROOT 'repo/scripts/toolkit-codex-session-start.ps1') '--hook' '--sync-enabled' '--write' '--sync-source' 'codex-plugin' }"
```

Portable non-Windows source shape:

```text
node "${PLUGIN_ROOT}/repo/scripts/toolkit-codex-session-start.cjs" --hook --sync-enabled --write --sync-source codex-plugin
```

Supported non-interactive Codex plugin inspection verifies whether the Toolkit plugin is installed, enabled, current, and contains the expected hook definition. It does not expose the current hook-hash trust decision. Do not infer trust by reading or editing Codex config files. JSON and human-readable helper output use the same final reported state. When trust cannot be verified, report `verification unavailable`, tell the user to open `/hooks` in Codex, and ask them to review and trust the current Toolkit `SessionStart` hook. If the hook changed during the current setup run, report it as `pending review` and `skipped until trusted`; Codex skips new or changed plugin hooks until their current definition is reviewed and trusted. This approval step applies to Codex only. Claude Code does not need Codex hook approval. Codex must not install or update Claude Code, and Claude Code must not install or update Codex.

After a fresh Codex plugin install or update, the user must manually approve or trust the startup hook through `/hooks`. Verification can confirm the installed cache contains a `SessionStart` hook, but it cannot approve that hook on the user's behalf.

Codex setup must never install or update Claude Code. Claude Code setup must never install or update Codex. The shared `setup-toolkit.cjs` orchestrator selects the correct native step with `--host`.

### Manual Isolated CODEX_HOME Acceptance

Before merging changes that affect Codex local plugin install, run this smoke test with a fresh isolated Codex home. In the example, `CODEX_HOME=<temp>` means a newly created temporary directory, not the user's normal Codex home.

```powershell
$env:CODEX_HOME = "<temp>"
node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json
codex plugin list --available --json
```

Acceptance criteria:

- `node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json` exits successfully. If the underlying `codex plugin add ai-agent-toolkit@ai-agent-toolkit-local --json` process keeps running after verification passes, setup output includes a warning that the command did not exit cleanly.
- `codex plugin list --available --json` shows `ai-agent-toolkit@ai-agent-toolkit-local` installed and enabled with `authPolicy` `ON_USE`.
- The final cache exists at `CODEX_HOME/plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/<version>`.
- The final cache `.codex-plugin/plugin.json` reports the current Toolkit manifest version.
- The final cache `.codex-plugin/hooks/hooks.json` includes a `SessionStart` hook.
- Package-critical cache files match the local repo, including Codex plugin metadata, Toolkit bridge/setup scripts, hook-light validation test, assets, and `skills/`.

## Repo-Backed Auto-Update

Repo auto-update uses the configured local Toolkit Git repo as source of truth. The default setup configures the managed clean `main` checkout under the user-local `.ai-agent-toolkit/source/ai-agent-toolkit` path. Native Codex and Claude Code plugin hooks remain launchers only; they do not become source of truth and do not update each other.

Enable or refresh the managed-main setup with:

```powershell
node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main
```

Advanced bridge-only configuration can still point at an explicit trusted checkout:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit" --repo-branch main --enable-auto-sync --write
```

Use `--repo-remote <url>` only when intentionally testing or maintaining a non-default remote. The expected production remote is `https://github.com/weijunswj/ai-agent-toolkit`.

Release-branch auto-update consideration: the current default setup uses `main`. If the repo later adopts a stable `release` branch for user-facing Toolkit updates, configure `--repo-branch release` only after that branch exists and has a clear CI/merge policy. The bridge remains pull-on-session-start: GitHub pushes to the configured branch are picked up by the next native hook run or explicit `--repo-update-now`; the Toolkit does not run a GitHub webhook listener or background push daemon.

When a native SessionStart hook runs and repo auto-update is enabled, the bridge:

1. Acquires the Toolkit bridge lock.
2. Validates `repo_path` exists and is a Git worktree.
3. Reads the current branch and validates `origin` matches `repo_remote`.
4. Refuses to continue when the working tree is dirty, leaving the current branch and local changes untouched.
5. If the clean worktree is on a different branch, switches to `repo_branch` with `git switch <repo_branch>` and records that auto-switch in the update report.
6. Fetches `origin <repo_branch>`.
7. Updates only with `git merge --ff-only FETCH_HEAD`.
8. Runs hook-light validation:

```powershell
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs
```

9. Checks the running host's native plugin cache state against the configured repo source. When Codex is the running host and `codex_plugin_auto_refresh_enabled` is true, the trusted `main` hook refreshes only the Codex Toolkit plugin cache through `repo/scripts/setup-codex-toolkit-plugin.cjs --write --json --repo-root <repo_path>` after repo validation and before delegated target sync completes, so a stale Codex cache can still be refreshed when a later target sync step fails safely. On Codex/Windows, the same opt-in then audits installed non-Toolkit Codex plugin caches with `hooks/hooks.json`; if a cache directly invokes `.sh` hooks or uses bare/WSL bash, it rewrites those commands through the Toolkit PowerShell/Git Bash wrapper and records the result in the update report. Claude Code hooks report check-only/manual native refresh status and do not mutate Codex or Claude plugin caches from the opposite host.
10. Delegates enabled-target sync to the freshly updated repo script with `--skip-repo-auto-update`.

Before the repo-update and target-sync work, the same startup hook also runs a passive repo-local instruction preflight against the current working directory. For Codex it checks `AGENTS.md`; for Claude Code it checks `AGENTS.md` and `CLAUDE.md`. The preflight reads only the expected files and bundled repo-local templates, verifies `AI-AGENT-TOOLKIT` managed marker structure, compares expected managed block content, prints a concise warning for missing, broken, or stale content, and never writes files, creates backups, or performs repair. When findings exist, the agent should pause and ask whether to run `ai-coding-agent-rules` check/repair/refresh now or proceed with the current task despite the warning.

The delegated repo script builds the target payload from the updated local Toolkit repo `skills/` tree plus the small `ai-agent-toolkit` adapter skill. It must not use Codex or Claude private plugin caches as the skill payload source.

The delegated command shape is:

```powershell
node <repo_path>/repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write --sync-source repo --hub <same-hub> --skip-repo-auto-update
```

The hook validation is intentionally lighter than `npm run validate:all` so SessionStart stays short. Run full validation manually before release, merge, or broad maintenance changes:

```powershell
npm run validate:all
node --test repo/tests/toolkit-local-bridge.test.cjs
```

Repo auto-update never runs `git pull`, merge commits, rebase, package installs, marketplace installs, credential writes, `n8n_live` actions, or arbitrary project-repo mutations. Codex native Toolkit cache refresh and installed third-party hook repair run only after the user enables Codex plugin cache auto-refresh. If validation, fetch, fast-forward, delegation, native cache refresh, or third-party hook repair fails in hook mode, the hook prints or reports a concise warning, records the last status when possible, and exits successfully so agent startup is not blocked.

## Update Reports

When a hook run performs meaningful work or safely skips a risky update, the bridge writes a markdown report under the user temp directory:

```text
%TEMP%\ai-agent-toolkit\update-reports\toolkit-update-YYYYMMDD-HHMMSS.md
```

Meaningful work means at least one of:

- The configured Toolkit repo fast-forwarded.
- The configured Toolkit repo was already advanced before the hook run compared with the last recorded bridge update state. This is reported as an inference, likely from a manual pull or another local Git update, not as proof of a manual action.
- An enabled OpenCode or Antigravity 2 target was synced.
- A stale Toolkit-managed skill folder was removed from a managed target.
- Delegated repo sync failed.
- Hook-light validation failed after a repo update.
- Repo auto-update auto-switched a clean non-configured branch back to the configured branch.
- Repo auto-update skipped safely because the tree was dirty, the remote did not match, branch switching failed, fetch failed, or the fetched commit was not a fast-forward. Dirty-checkout reports should name the configured Toolkit source path and suggest finishing or stashing those changes, or rerunning `setup toolkit` to use the dedicated clean managed `main` checkout for startup updates.
- The Codex native plugin cache is stale relative to the configured repo source, was auto-refreshed, or failed auto-refresh.
- A non-Toolkit installed Codex plugin cache had unsafe Windows hook launchers repaired, or third-party hook repair failed.

Normal no-op hook runs with the same observed repo commit and no target sync, stale plugin cache, skip, or validation issue do not write or open a report. Meaningful reports are also deduplicated by event signature: if a later hook sees the same repo status, target-sync result, native plugin cache status, and checksum, it does not create or open another timestamped report. In hook mode, the bridge prints only:

```text
Toolkit updated: <report path>
```

The report starts with a short `TL;DR` section for the triggering source (Codex plugin hook, Claude Code plugin hook, or manual/repo run), repo status, target sync status, and any action needed. Details include the new and previous observed commits, sync source, Singapore time (`SGT`), a Repo Update section with configured branch and configured remote, changed files from the fast-forward or already-advanced observed range when available, synced target paths, copied/updated skill counts, removed stale managed skill folders, the explicit live n8n skip note, repo update status, hook-light validation result, target sync status, Codex native plugin cache status when checked, third-party Codex hook repair status when checked, checksum, and any warning/error. If auto-update finds a clean local Toolkit repo on the wrong branch, the report says it auto-switched back to the configured branch. If the repo is dirty, the report explains that dirty local changes prevent auto-update and the hook leaves the current branch and changes untouched. For the default production configuration, this shows configured branch `main` and configured remote `https://github.com/weijunswj/ai-agent-toolkit` so users can see whether updates are coming from GitHub `main`. The latest report path is stored in hub state as `last_update_report_path` and appears in `--audit`.

For first-restart compatibility after a bridge update, an older installed native hook may fast-forward the configured local Toolkit repo and then delegate into the newly updated repo script without passing `--hook`. An unsuppressed delegated command with `--sync-enabled --write --sync-source repo --hub <same-hub> --skip-repo-auto-update` is report-eligible. When hub state contains `last_repo_update_from_commit`, `last_repo_update_to_commit`, and `last_repo_update_status`, the delegated repo script uses that stored metadata plus a local `git diff --name-only` over `repo_path` to populate the update report. New parent hooks pass `--suppress-update-report` to delegated sync so the parent hook remains the single report writer and duplicate reports are avoided.

Meaningful update reports are enabled by default and can be persisted with `--enable-update-reports` or disabled with `--disable-update-reports`. A central deterministic classifier marks each report as `action-required`, `successful-activity`, or `no-op`. Action-required reports open automatically; successful reports remain closed; true no-ops create no report. `--open-update-report` remains an explicit one-run request for the current report. Legacy `--enable-update-report-open` and `--disable-update-report-open` are compatibility aliases for failure-only behavior and cannot restore all-success opening. On Windows, opening uses only `notepad.exe <reportPath>` and only for files created under the Toolkit temp update-report folder.

During `setup toolkit`, report creation and retention remain in the upfront wizard. Existing `update_report_open_enabled=true` is explicitly migrated to action-required-only behavior, and the setup proposal states that failures open while successes stay closed.

Toolkit-managed update reports/logs older than the configured retention window are cleaned up best-effort on setup and hook/update runs. Default retention is 7 days and can be configured with `--update-report-retention-days <positive-integer>`. Cleanup also caps retained files to the newest 200 Toolkit reports inside the retention window. Cleanup only considers Toolkit report filenames under the Toolkit-managed update report/log directory, never arbitrary user files, and never treats cleanup failure as a setup or startup blocker. Setup and audit summaries include retention days, max retained reports, deleted count, skipped/error count, and the report/log directory path.

Codex plugin cache auto-refresh is included in the setup checklist. Codex may refresh only the Codex Toolkit native plugin cache from the managed `main` checkout. On Windows, that opt-in also permits repair of unsafe hook launchers in installed third-party Codex plugin caches. Claude Code reports check-only/manual native refresh state and does not let Codex mutate Claude Code cache.

## Windows Codex Plugin Hook Repair

Windows hook repair is a separate post-install maintenance utility. Use [repair-codex-plugin-windows-hooks.cjs](../scripts/repair-codex-plugin-windows-hooks.cjs) after a requested Codex plugin install or update when an installed plugin root contains `hooks/hooks.json`. The Local Bridge updater may also call this utility from a trusted Codex startup hook when Codex plugin cache auto-refresh is enabled, limited to installed non-Toolkit Codex plugin caches under `CODEX_HOME/plugins/cache`.

The repair utility:

- Parses the installed plugin's `hooks/hooks.json` as JSON.
- Rewrites generic `.sh` hook commands to `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.ps1" "<relative-hook-script>"`.
- Writes a Toolkit-managed `hooks/run-hook.ps1` wrapper that invokes explicit Git Bash from `C:\Program Files\Git\bin\bash.exe` or `C:\Program Files\Git\usr\bin\bash.exe`.
- Rejects bare `bash`, `bash.exe`, and `C:\WINDOWS\system32\bash.exe` when the command cannot be safely normalized.
- Applies the n8n-specific Node JSON fallback patch for `n8n-skills@n8n-io`.
- Fails with an actionable error when a hook cannot be repaired safely.

The automatic repair path is generic for third-party Codex plugin hook launchers but deliberately narrow:

- It scans installed cache roots only, never temporary marketplace checkouts.
- It skips the Toolkit native plugin cache so Toolkit updates remain source-owned by the managed checkout.
- It writes only `hooks/hooks.json` launcher rewrites and the Toolkit-managed `hooks/run-hook.ps1` wrapper for generic plugins.
- It applies n8n hook internals patches only when the installed plugin is identified as `n8n-skills`.
- It writes details to the Toolkit update report and keeps hook stdout compact.

Example:

```powershell
node repo/scripts/repair-codex-plugin-windows-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --write --plugin-id n8n-skills@n8n-io
node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --verify-output
```

This utility may repair the installed plugin root named by the user or install flow. The audit command verifies repaired hook JSON output before hook approval. It must not use private plugin cache paths as source for Toolkit publishing, copy third-party plugin content into this repo, touch `n8n_live` MCP config, or modify unrelated plugins except when the current install/update flow explicitly targets that plugin root for generic Windows hook wrapping.

## Target Discovery

OpenCode detection signals:

- `opencode --version` succeeds.
- `OPENCODE_CONFIG_DIR` is set.
- `~/.config/opencode` or an explicit OpenCode config dir exists.
- The managed OpenCode target exists.
- The user explicitly enabled the target.
- Persisted bridge target state exists.

OpenCode target path:

- POSIX: `~/.config/opencode/skills/`.
- Windows: `%USERPROFILE%\.config\opencode\skills\`.

OpenCode loads one folder per skill under that root, for example `~/.config/opencode/skills/toolkit-setup/SKILL.md`. The bridge writes every current Toolkit skill folder plus the `ai-agent-toolkit` adapter skill there after the user explicitly enables OpenCode. Old bridge state that points at `skills/ai-agent-toolkit` is migrated to the parent `skills/` root.

The bridge intentionally does not use `.agents/skills` for OpenCode output, avoiding duplicate Codex skill discovery.

Antigravity 2 detection signals:

- Antigravity user config exists, such as `%USERPROFILE%\.antigravity`.
- Gemini/Antigravity plugin config exists, such as `%USERPROFILE%\.gemini\config` or `%USERPROFILE%\.gemini\config\plugins`.
- The managed Toolkit AG2 adapter exists under the Toolkit Local Bridge Hub.
- The managed Antigravity 2 plugin-scoped target exists under `%USERPROFILE%\.gemini\config\plugins\ai-agent-toolkit`.
- The user explicitly enabled the target.
- Persisted bridge target state exists, such as `target_path`, `synced_version`, `synced_checksum`, or `last_sync`.
- Saved AG2 Python command, when configured.
- Explicit `--python-command`, for one run.
- `python`, `python3`, and `py`.
- Safe read-only user-local candidates such as Windows user Python locations, `UV_PYTHON`, `VIRTUAL_ENV`, and `CONDA_PREFIX`.
- Optional package signal: a candidate Python command exists, returns a version, and `python -m pip show ag2` succeeds.

Antigravity 2 target path:

- POSIX: `~/.gemini/config/plugins/ai-agent-toolkit/`.
- Windows: `%USERPROFILE%\.gemini\config\plugins\ai-agent-toolkit\`.
- Required app-facing skills: every current Toolkit skill under `skills/<skill-name>/SKILL.md`, plus the `skills/ai-agent-toolkit/SKILL.md` adapter skill inside that plugin root.

Persist a known non-PATH Antigravity 2/AG2 Python command with:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --set-ag2-python-command "<python.exe>" --write
```

Future audit and hook runs reuse the saved command. If the Python `ag2` package is not detected, audit output must list the exact Python commands tried and keep `python_command` empty unless a command actually has the package. Detection must never install Python, AG2, Antigravity 2, OpenCode, npm packages, or pip packages.

Audit separates Antigravity 2 app/bridge relevance from the optional Python package signal:

- `detected` means the Antigravity 2 bridge target is present or relevant.
- `ag2_package_detected` means the Python package `ag2` was found.
- `python_command` is set only when `ag2_package_detected` is true.
- `signals.tried_python_commands` records package misses such as `Package(s) not found: ag2`.

Audit also separates internal hub metadata from app-facing target sync:

- `internal_adapter_path` points under the Toolkit Local Bridge Hub.
- `target_path` points at the app-facing OpenCode skills root or Antigravity 2 plugin root.
- `target_exists` reports whether the app-facing managed output files exist.
- `synced` is true only when the enabled target state and the real app-facing output match the current full Toolkit skill payload and no previously managed Toolkit skill folder is stale. Hub metadata alone is not enough.

## Auto-Check, Auto-Setup, And Auto-Sync

Autocheck is allowed. Autosetup is forbidden.

- Detected but never-enabled target: no target writes.
- Not detected and never-enabled target: skip.
- Enabled target: sync only that target when stale.
- Explicitly disabled target: never touch.
- Auto-sync enabled: native hooks may sync enabled stale targets.
- Auto-sync disabled: hooks may print a concise reminder or do nothing.

## Setup Command Surface

The bridge is Toolkit setup and maintenance infrastructure. It may have one compact `toolkit-setup` discoverability skill, but it must not become a family of reusable command skills.

Audit:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Dry-run OpenCode setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode
```

Apply OpenCode setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write
```

Dry-run Antigravity 2 setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2
```

Apply Antigravity 2 setup:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write
```

Sync enabled targets:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
```

Disable a target:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
node repo/scripts/toolkit-local-bridge.cjs --disable-target ag2 --write
```

Do not add one bridge skill per command. Keep `toolkit-setup` as the only bridge/setup discoverability skill, and keep setup guidance in this doc, the updater help, validators, and tests.

## Hook Policy

Hooks are optional automation. They must not contain unique critical policy.

The packaged hooks only call the shared updater:

- Codex hook source: `.codex-plugin/hooks/hooks.json`.
- Claude Code hook source: `.claude-plugin/hooks/hooks.json`.
- Shared policy source: this doc, `AGENTS.md`, Toolkit docs, and validators.
- Deterministic enforcement: `repo/scripts/toolkit-local-bridge.cjs` and tests.

The shared updater may run a passive repo-local instruction preflight from the hook path. That preflight is a warning-only freshness check for expected `AI-AGENT-TOOLKIT` managed blocks; it does not install, repair, back up, create, refresh, or rewrite repo-local instruction files. When findings exist, the agent should pause and ask whether to run `ai-coding-agent-rules` check/repair/refresh now or proceed with the current task despite the warning.

OpenCode and Antigravity 2 do not need Codex or Claude hooks to receive core policy because the policy remains in portable docs, validators, and generated adapter content.

The packaged Toolkit hooks remain startup-only. The bridge uses `SessionStart` because update and sync work is most useful before the agent starts relying on local skills. Claude Code documents a `SessionEnd` event, but the Toolkit does not add a Claude-only exit hook because app exit hooks can be skipped or killed and Codex plugin `SessionEnd` support is not validated in this repo. Do not add unsupported hook event names such as `Stop` or `SessionEnd` to the packaged Codex or Claude plugin manifests without a current platform-supported, safe, fast implementation and matching tests.

## Codex SessionStart Output Contract

The current official [Codex hooks documentation](https://developers.openai.com/codex/hooks) is the behavior source of truth:

- Plain text written to `stdout` by a `SessionStart` hook is added as extra developer context.
- JSON `stdout` may instead use `hookSpecificOutput.hookEventName: "SessionStart"` plus `hookSpecificOutput.additionalContext`. Do not mix JSON and plain text.
- `systemMessage` is surfaced as a UI or event-stream warning; it is not a substitute for model-visible `additionalContext` or plain-text `stdout`.
- Command hooks receive one JSON object on `stdin`, including `cwd`, and run with the session `cwd` as their working directory.
- Plugin hooks use the normal hook trust flow. Installing or enabling a plugin does not trust its hooks; new or changed hook definitions are skipped until reviewed and trusted through `/hooks`.
- Only command handlers run today. Async command hooks and prompt/agent handlers are parsed but skipped, and `suppressOutput` is parsed but not implemented.

The Toolkit bridge already emits concise bridge status text on hook `stdout`, so its passive agent-rules preflight uses documented plain-text `stdout` rather than trying to combine status text with a JSON response. The preflight runs before bridge no-op handling, resolves the nearest Git root from the documented session working directory, and never creates, repairs, backs up, or writes repo-local instruction files.

## Real Codex Host UAT

Run this acceptance test only in a disposable Git repo outside the Toolkit checkout. Do not alter a real downstream repo.

1. Create a temporary Git repo with no `AGENTS.md` and at least one harmless branch.
2. Run the normal approved `setup toolkit` flow so the current Toolkit plugin cache is installed, enabled, and current. Confirm setup reports the corrected package version. Do not treat the presence of `hooks.json` as proof that the hook can run.
3. In Codex, open `/hooks`. Locate the exact Toolkit `SessionStart` command, review its current definition, and trust it. If trust verification remains unavailable, stop and record that UAT is pending.
4. Open a fresh Codex task in the temporary repo and submit `list the branches`.
5. Verify Codex asks whether to install/repair Toolkit repo-local rules or proceed without Toolkit repo-local rules before it lists branches or performs other repository work.
6. Choose `proceed without Toolkit repo-local rules`. Verify Codex continues with the harmless request and does not create `AGENTS.md`, `docs/agent-playbooks/`, `.agent-toolkit-backups/`, or any other repo file.
7. Install the correct repo-local instructions through the normal user-approved `ai-coding-agent-rules` flow. Open another fresh task and verify the missing-rule warning no longer appears.
8. In another disposable copy, alter a managed block in `AGENTS.md`. Open a fresh task and verify Codex asks whether to repair/refresh or proceed without current Toolkit repo-local rules, and does not repair or create a backup before the user decides.

Record the Toolkit plugin version, exact hook command, `/hooks` trust result, whether each fresh task asked before work, and whether the repo tree remained unchanged before the user's decision. If an actual Codex host cannot be exercised with the corrected plugin build, mark real-host UAT as pending and include these exact steps in the PR body; do not claim end-to-end verification.

## Portable Policy-First Layering

Layering:

1. `AGENTS.md` is compact cross-platform context and routing.
2. Portable skills and docs contain detailed cross-platform workflows; bridge setup specifics stay in docs and the shared updater.
3. Validators and schema checks enforce deterministic rules where practical.
4. Hooks provide optional native automation around validators and the shared updater.

Rules that affect agent judgement must remain available outside hooks. Deterministic rules should be script-validated where practical. Hooks should call those scripts.

## AGENTS.md Slimming Plan

Keep in root `AGENTS.md`:

- Instruction priority and repo routing.
- Compact source-of-truth hierarchy.
- Compact native plugin/update architecture summary.
- Approval and user/global write safety rules.
- Generated-output rule.
- Skill routing rules and pointers.
- Validation and final report expectations.

Move or mirror outside root `AGENTS.md`:

- Long bridge setup procedures: this doc and the shared updater help.
- Exact bridge state schema: updater validation and tests.
- Exact command implementations: [toolkit-local-bridge.cjs](../scripts/toolkit-local-bridge.cjs).
- Hook behavior details: this doc, plugin hook manifests, and tests.
- Mechanical validation logic: `repo/tests/toolkit-local-bridge-hook-light.test.cjs` for hook-light startup behavior, `repo/scripts/validate-toolkit.cjs`, and full manual bridge validation in `repo/tests/toolkit-local-bridge.test.cjs`.

Do not move exclusively into hooks:

- Source-of-truth policy.
- Approval gates.
- Generated-output ownership.
- OpenCode and Antigravity 2 opt-in requirement.
- Native plugin cross-update prohibition.
- No package installs by default.
- No project repo mutation by default.

Root `AGENTS.md` changed in this PR only to add compact Architecture context and synced source-of-truth wording. No critical shared policy exists only in hooks.

## Disable And Rollback

Disable auto-sync:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-auto-sync --write
```

Disable a target without deleting files:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write
node repo/scripts/toolkit-local-bridge.cjs --disable-target ag2 --write
```

The bridge does not delete user files unless a separate future command explicitly asks for deletion and the user approves it.
