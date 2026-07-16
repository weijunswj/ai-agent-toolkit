# Native Codex UAT Remediation Audit

Date: 2026-07-15
Status: Current exact-head validation and review evidence is tracked in PR #259; native UAT pending

## Scope

This is a scoped post-PR #258 audit and remediation for Toolkit issues #241 and #247. It covers only:

- Root-first delegation qualification for generic helper and speed wording.
- Native Codex `SessionStart` launcher and hook-safe exit behavior on Windows.
- Setup question-bank choice semantics and presentation.
- Installed Codex hook-cache freshness, transactional launcher diagnostics, and state-aligned setup recommendations raised during PR #259 review.
- Native Codex and Claude topology, admission, reasoning-effort, and non-fast enforcement capability review.

Repository type: mixed data/tooling and native plugin metadata.

Branch: `fix/241-native-uat-remediation`

Base: `771af1c1191d8a31d3d0cacfc2253421b6c18b59`

## Evidence Reviewed

- Issue #241 and its latest post-PR #258 native-UAT comment.
- Issue #247 and its latest Batch C `REMEDIATION REQUIRED` comment.
- PR #258 reviewed head `23193e06d1bea8623a1dff709dd616dfa1aa76c1` and squash merge `771af1c1191d8a31d3d0cacfc2253421b6c18b59`.
- Authoritative agent-rule partials, Toolkit Local Bridge project sources, native plugin manifests, setup scripts, validators, tests, and generated-output declarations.
- Official Codex multi-agent, configuration, speed, hooks, and plugin documentation.
- Official Claude Code subagent, hooks, plugin, fast-mode, model, settings, and environment documentation:
  - https://code.claude.com/docs/en/sub-agents
  - https://code.claude.com/docs/en/hooks
  - https://code.claude.com/docs/en/fast-mode
  - https://code.claude.com/docs/en/plugins
  - https://code.claude.com/docs/en/agent-teams
- Current local host surfaces: Codex CLI/app-server 0.144.2 schemas and help; Claude Code 2.1.198 `--help` and `--version`.
- Current official Codex manual sections for multi-agent, configuration, hooks, speed/fast mode, plugins, and app-server protocol, generated from the installed OpenAI documentation corpus:
  - https://developers.openai.com/codex/multi-agent
  - https://developers.openai.com/codex/config-reference
  - https://developers.openai.com/codex/hooks
  - https://developers.openai.com/codex/fast-mode
  - https://developers.openai.com/codex/plugins

## Host Capability Decision

| Host | Supported and enforceable | Observable but not enforceable | Policy-only | Unsupported | Outside Toolkit control |
| --- | --- | --- | --- | --- | --- |
| Codex 0.144.2 | Native concurrency/depth backstops can be written for a verified runtime; root-only can be selected as a capacity outcome. | App-server collaboration events expose requested child model/reasoning and lifecycle; `SubagentStart` reports a launch after it begins. | Productive-root wording, medium/non-fast intent, and no-recursion guidance for native workers. | Plugin-provided custom agents; pre-launch blocking; child-only fast override/verification; adaptive admission for native, Security, plugin, built-in, third-party, or nested launches. | User configuration and launches not performed through Toolkit; host UI/session concurrency and Security internals. |
| Claude Code 2.1.198 | Trusted `PreToolUse` can deny native `Agent`/legacy `Task`; a fresh Toolkit external session can force medium effort by default, `CLAUDE_CODE_DISABLE_FAST_MODE=1`, `Agent` denial, direct-only depth, pre-launch admission, and supervisor-owned release. | `SubagentStart` and lifecycle output can observe native workers after launch; semantic parent activity after controller return is observable rather than an OS-level primitive. | Productive-root behavior after the enforced declaration gate and broader-native behavior. | Toolkit-managed nesting beyond depth 1; complete interception of agent teams or every built-in/named worker path. | Native teams, built-in, Security, user-created, third-party/plugin, and direct CLI launches outside `toolkit-agent-control.cjs`; host-wide concurrent sessions. |

The only implemented Toolkit-managed topology is Claude direct-only. Capacity never grants launch by itself. Codex has no strict managed topology and remains root-only for the #240/#241/#247 contract.

## Findings

| Severity | Domain | Finding | Release gate |
| --- | --- | --- | --- |
| P1 | Delegation | Existing rules reject generic parallelism but do not explicitly classify a direct generic helper request as a non-conflicting preference or require present-task evaluation in a fixed order. Native C2 delegated after acknowledging that no criterion was met. | Repair authoritative shared policy, regenerate host surfaces, and add exact C2 contract coverage. Native C2 remains required after merge. |
| P1 | SessionStart | The packaged Codex command uses bare `node` plus shell-style `${PLUGIN_ROOT}` expansion. Either can fail before `toolkit-local-bridge.cjs` starts, outside its hook-safe catch. The exact native red-exit cause is not yet attributable from screenshot evidence alone. | Reproduce a materially equivalent pre-JavaScript failure, add a Windows-safe launcher boundary and strict installed-cache verification, and prove safe hook skips exit zero. Native startup/resume/clear/compact remain required after merge. |
| P1 | Question bank | The canonical helper row exposes a generic `Advanced` outcome and the renderer compresses choices into one pipe-separated line. Runtime-invalid helper choices can remain visible. | Replace the generic submenu with direct state-valid outcomes and list rendering while preserving one canonical question specification and strict input ordering. |
| P1 | Installed hook freshness | Windows verification normalized only the command shape and did not compare the complete normalized hook file, allowing unrelated stale hook entries to survive. | Validate both hook shapes, normalize only the intentional Windows command, then require exact source/cache bytes. |
| P1 | Launcher privacy | Bridge output could be emitted before a later optional-maintenance failure, exposing partial diagnostics despite the final privacy-safe warning. | Capture stream, console, and module-load output within a fixed bound; replay only after complete success. |
| P1 | Setup recommendation | Unsupported and disabled runtime states exposed only `keep` but could still describe a one-helper recommendation. | Derive choices and recommendation text from the same runtime-support state. |
| P1 | Native enforcement capability | The previous head shipped only policy plus a Codex capacity backstop and no enforceable adaptive launch path. | Implement one truthful Toolkit-controlled path where every admitted launch crosses resource, effort, non-fast, topology, and productive-parent gates; keep all bypass paths explicitly outside coverage. |

## Remediation Disposition

- Delegation: repaired in the authoritative shared execution partial and regenerated surfaces. Generic helper, delegation, parallelism, and speed wording is explicitly non-conflicting; present-task qualification is ordered and all six facts remain mandatory. The exact failed C2 wording has contract coverage. Defined bounded specialist and multi-worker workflows remain available when they qualify.
- SessionStart: repaired through a hook-safe Node launcher plus a Windows PowerShell boundary. Supported Windows setup writes one exact installed-cache command and exact Node runtime metadata, verifies matcher coverage and launcher bytes, rejects the old direct bridge shape, preserves hook streams, and converts optional hook startup or bridge failures to one privacy-safe exit-zero skip. Manual bridge failures remain non-zero.
- Question bank: repaired through one canonical structured specification with direct conditional choices, explicit recommended/selected/empty-input values, Markdown and terminal list renderers, and no generic advanced submenu. Exact Toolkit-owned limit removal is conditional and uses preview-bound approval, stale-byte rejection, one exact backup generation, and restore commands before mutation.
- Installed hook freshness: repaired by validating source and installed hook shapes first, normalizing only the installed Windows `SessionStart` command, and comparing the complete normalized bytes. Extra or stale hook entries now fail verification.
- Launcher privacy: repaired with a 1 MiB bounded transactional capture for stdout, stderr, console methods, and dependency-load output. Output is replayed only after successful bridge completion; failures emit only the existing support-safe warning and exit zero.
- Setup recommendation: repaired so disabled, unknown, and unsupported runtimes expose and recommend only `keep`; visible recommendation text uses the same runtime-supported state as the choices.
- Productive parallelism: the portable policy now requires a declared bounded launch gate, active topology and resource admission, verified medium non-fast child execution, immediate meaningful root-owned work, and root-owned integration. Generic requests, capacity, task count, speed, or later UAT cannot qualify delegation alone.
- Native capability: Codex remains root-only under the strict contract because native hooks cannot block spawn or establish child-only non-fast mode and Codex plugins do not package custom agents. Claude now has one separate `claude-toolkit-direct` profile: trusted `PreToolUse` blocks native Agent/Task bypass, and the Toolkit controller admits only fresh direct external sessions with explicit effort, fast disabled, nesting disabled, atomic reservations, and productive-parent declarations. Native teams, built-in, Security, plugin, user-created, third-party, and direct CLI bypasses remain outside Toolkit coverage.
- Scoped deterministic release finding status: local deterministic coverage exercises the enforceable Claude boundary and all eight current review regressions. Exact-head CI and current-head review-thread verification passed; native host UAT remains pending.

## Security Readiness

Codex Security is not available through the current OpenCode tool surface. The approved standard review therefore used manual launcher, module-load, process, filesystem-boundary, privacy, output-bound, hook-normalization, setup-state, and failure-path inspection plus isolated fixtures. No deep scan was approved or run.

Security coverage is limited to this declared scope. Native host behavior remains unverified until the documented post-merge UAT runs.

## Validation

Passed source, generated-output, and contract checks:

- `node repo/scripts/sync-agent-instruction-shims.cjs --check`
- `node repo/scripts/sync-toolkit-projects.cjs --check`
- `node repo/scripts/sync-repo-doc-contract.cjs --check`
- `node repo/scripts/audit-project-source-locks.cjs`
- `node repo/scripts/audit-published-surfaces.cjs --check`
- `node repo/scripts/audit-fallback-risk.cjs`
- `node repo/scripts/audit-skill-portability.cjs`
- `node repo/scripts/package-skills.cjs --check`
- `node repo/scripts/package-packs.cjs --check`
- `node repo/scripts/validate-toolkit.cjs`
- `git diff --check`

Passed focused and integration suites:

- Agent instruction shims: 18 passed.
- Codex delegation V2: 34 passed, 1 platform skip.
- Codex SessionStart launcher: 7 passed on Windows.
- Codex native plugin setup: 24 passed.
- Setup orchestrator shards: 41 passed across all three shards.
- Toolkit staging generations: 14 passed.
- Hook-light validation: 2 passed.
- Toolkit Local Bridge: 133 passed with `--test-force-exit`; the ordinary Windows invocation retained a post-summary handle, and no owned Node process remained after the forced exit.
- Packaged-version validator regression: 1 targeted test passed.

PR #259 amendment validation on the current worktree:

- Agent instruction shims: 18 passed.
- Codex delegation V2: 34 passed, 1 platform skip.
- Codex SessionStart launcher: 12 passed, including bounded transactional output, dependency-load privacy, and real-bridge concurrency.
- Codex native plugin setup: 25 passed, including complete normalized hook-cache comparison.
- Setup orchestrator shards: 41 passed across all three shards.
- Toolkit staging generations: 14 passed.
- Hook-light validation: 2 passed.
- Toolkit validator, generated instruction check, project sync check, repo doc contract, source-lock audit, published-surface audit, fallback-risk audit, skill portability audit, skill package check, pack package check, and `git diff --check`: passed.
- Portable managed template: 13,425 characters, below the 14,000-character limit.
- Packaged-version validator regression: 1 targeted test passed.
- Toolkit Local Bridge directly affected concurrent-writer case: 1 passed. A current full-suite rerun timed out after 32 reported passes at 15 minutes; no owned orphan remained. The earlier full 133-test evidence above remains pre-amendment evidence, and exact-head CI is required for the amendment.

The complete `repo/tests/validate-toolkit.test.cjs` process exceeded 15 minutes twice without output and left no owned orphan. Its directly affected packaged-version case and the direct Toolkit validator both pass. CI remains the full read-only gate; local `npm run validate:all` was not run per repository policy.

PR #259 CI passed on earlier commit `cd6b32dde6377436ea7e46573bd2b00789d4d843`, including both validation jobs, package checks, generated-surface sync, and CodeQL. That result preceded the current amendment.

The first amendment CI run on `e4bb4388b4fe7b83c52ea8b37adfe0ef5f2c9f2f` failed three portable instruction phrase-contract assertions. The targeted repair restored the compact application-error, fallback, and optional-memory contracts and aligned Git Completion assertions with the compressed equivalent wording. The five-test observability suite, two affected validator tests, 18 instruction-shim tests, direct validator, and both generated checks pass locally. Replacement exact-head CI passed on `d5ae876e`, including both validation jobs, generated sync, both package checks, and all CodeQL analyses.

Native Codex C1/C2 and startup/resume/clear/compact were not run and are explicitly excluded from implementation proof.

## Current Topology Amendment Validation

Passed on the current worktree unless qualified:

- Claude admission/productive-root/mode/reservation controller plus detached lifecycle: 15 passed.
- Canonical Claude setup topology/capacity specification and end-to-end isolated profile execution: 5 passed.
- Codex unknown/disabled owned-V2 removal regression: 2 passed.
- Setup orchestrator shards: 41 passed across all three shards after the Codex root-only recommendation update.
- Codex delegation/configuration suites: 56 passed, 1 POSIX-only skip.
- Codex SessionStart launcher: 12 passed.
- Codex and Claude native plugin setup suites: 55 passed.
- Directly affected bridge source-version, concurrent-writer, and native-manifest cases: 3 passed.
- Packaged-version validator regression: 1 passed.
- Project sync, instruction shim sync, repo-doc sync, source-lock audit, published-surface audit, fallback-risk audit, skill portability, skill package, pack package, and `git diff --check`: passed.
- `node repo/scripts/validate-toolkit.cjs --workspace <clean current-diff workspace>`: passed. The ordinary working-directory invocation reports only the ignored `.agent-toolkit-backups` rollback backup created during this session; it is not tracked or included in the validation workspace/PR. Deleting that local backup still requires explicit destructive-cleanup approval.
- Local `npm run validate:all` was not run because repository policy assigns the full gate to CI.

Implementation-head PR CI passed on `3943c28c5c6ccbba81cc00c992067ec5f59fddb4`, and the audit-only follow-up `f3e44a681e22e74c16d40b1dda31c22b2eae51bd` also passed: both validation workflows, generated-surface sync, both package checks, the CodeQL workflow gate, and all three material CodeQL analyses passed. The prior six threads remain historical. All eight current findings were repaired in `8fa84a84bf9d7a39c4f865813617d9d7dc3ea7ce`, independently verified at exact head `6207ba997d9ca1cb111e87a3113cd9be5eff53e4`, replied to with implementation and regression evidence, and resolved. The re-listed review state is 14 total threads, 0 unresolved, and 0 unresolved-current. Native Codex C1/C2, startup/resume/clear/compact, and Claude native UAT remain pending.

## Exact-Head Eight-Finding Amendment

Implemented in `8fa84a84bf9d7a39c4f865813617d9d7dc3ea7ce` and validator-version test alignment completed in `6207ba997d9ca1cb111e87a3113cd9be5eff53e4`:

- Codex owned-block removal uses one affected-key identity through preview, approval, digest, backup metadata, execution, and final verification; unknown and disabled end-to-end removal cases pass.
- Every private job, prompt/output, state/profile, and reservation artifact is created as a verified regular `0600` file independent of umask; permissive-umask coverage passes.
- Topology and capacity resolve canonically before plan, display, approval, or write across flag, JSON, TTY, piped, recommended, and execution surfaces.
- Admission subtracts validated aggregate active-reservation cost from physical and commit/pagefile headroom while holding the same lock; malformed costs fail closed and the concurrent stale-snapshot case permits only one start.
- Strict Claude profiles require the current installed plugin identity/version/source/cache, enabled state, exact `Agent|Task` matcher and Toolkit command, current hook/controller bytes, and current CLI controls. Missing, stale, disabled, wrong-source, malformed/future-profile, and kept-profile capability-loss cases fail closed.
- Child prompt bytes use a bounded private stdin pipe, never argv; transport failure terminates the owned child and releases its reservation.

Successful local amendment evidence includes 88 combined SessionStart/plugin/controller regressions, 42 relevant Toolkit Local Bridge lock/recovery/concurrency regressions, 8 canonical Claude profile/topology regressions after the final enforcement change, the focused packaged-version validator regression, generated/project/doc sync checks, skill and pack package checks, and `git diff --check`. Broader setup/delegation runs identified two stale expectation-only failures; each corrected case passed in its focused rerun. Local `npm run validate:all` was not run per repository policy.

The first implementation-head CI run failed only the stale packaged-version validator assertion. Replacement exact head `6207ba997d9ca1cb111e87a3113cd9be5eff53e4` passed both full validation workflows, generated-surface auto-sync, package skills, package packs, CodeQL workflow gating, and the actions, JavaScript/TypeScript, and Python CodeQL analyses. All eight original threads were then replied to and resolved; re-listing returned 0 unresolved and 0 unresolved-current.

Native Codex C1/C2, startup/resume/clear/compact, and Claude native UAT were not run and remain explicitly pending.

## Five-Blocker Post-Review Amendment

Implementation commit: `57634104b757300ee6bd445b8173ba86b0ba071b`.

The four unresolved current review threads plus the independently verified unthreaded Windows executable defect were remediated together without changing the eight previously accepted repairs:

- Native Claude strict state now separates installed/current, enabled, trusted, hook-active, and strict-enforcement-verified outcomes. Strict profiles require host-reported trust and active hook execution. The proof is bound to Toolkit version `2.7.2`, the exact cache identity, hook bytes, and controller bytes; setup cannot create it. Missing, false, malformed, wrong-version/cache, or capability-loss state fails closed to root-only/unapplied and invalidates kept strict state. Broader-native remains explicitly outside strict Toolkit enforcement.
- Setup treats CLI launch controls and resource admission as independent capabilities. Automatic/manual direct capacity is available only with validated Linux `/proc/meminfo` or Windows operating-system counters. Unsupported, malformed, contradictory, or overflowed counters remove/refuse those choices; recommended defaults resolve root-only, and manual limits do not bypass resource checks.
- Launch computes the exact UTF-8 prompt bytes synchronously, rejects over 1 MiB before admission, and serializes accepted bytes losslessly for supervisor stdin. Rejection creates no queue, reservation, job file, output/error file, or detached supervisor. The prompt remains absent from argv and existing owned-child/reservation cleanup remains intact.
- Topology and Toolkit admission capacity are independent. Broader-native persists as broader-native with root-only/not-applicable Toolkit capacity, allows native `Agent`/`Task`, and survives keep-current. Root-only and direct continue denying native bypass.
- `repo/scripts/claude-process-launch.cjs` is the single process contract for plugin commands, capability probes, and direct workers. Bare Windows `claude` and `.cmd`/`.bat` shims use an explicit escaped `cmd.exe` boundary; JavaScript and `.exe` paths remain shell-free. Unsafe/ambiguous executable strings are rejected, metacharacter arguments retain boundaries, and prompt bytes stay on stdin.

Local evidence before the implementation commit:

- Focused Claude plugin/process, controller/lifecycle, setup topology, trust-loss, and resource-loss suites: 69 passed.
- Setup orchestrator and profile suites: 52 passed.
- Combined Codex/Claude native plugin, Windows executable transport, and SessionStart suites: 74 passed.
- Codex configuration/removal plus Claude admission/lifecycle suites: 58 passed, 1 POSIX-only skip.
- Agent instruction, SessionStart, and staging suites: 44 passed.
- Full Toolkit Local Bridge suite: 133 passed after correcting test-fixture CRLF drift without weakening production byte verification.
- Project sync, instruction sync, repo-doc sync, source-lock audit, published-surface audit, fallback-risk audit, skill portability, skill package, pack package, and `git diff --check`: passed.
- Direct working-tree validation and eight positive validator-fixture cases were blocked only by the pre-existing ignored `.agent-toolkit-backups` directory. That backup was not touched because cleanup is prohibited without separate authorization. A clean detached worktree at `57634104b757300ee6bd445b8173ba86b0ba071b` passed direct Toolkit validation, all 138 runnable validator tests with 2 Windows symlink-capability skips, generated-project freshness, skill packaging, pack packaging, and `git diff --check`. CI remains the full read-only exact-head gate.

No live Codex/Claude config or cache, credential, Docker, n8n, Cloudflare, production, external runtime, historical `.staging-*`, or ignored backup material was touched. Native Codex and Claude UAT remains pending. Issues #240, #241, and #247 remain open.

Exact code head `8ebbfebf6ec2f8042072fc2896796c8186302345` passed both full validation workflows (2m52s and 3m02s), generated-surface sync (4s), skill packaging (9s), pack packaging (4s), the CodeQL workflow gate (2s), and the actions (32s), JavaScript/TypeScript (1m13s), and Python (43s) CodeQL analyses. Setup probe findings were eliminated by centralizing through the shell-free helper. The remaining streaming-worker finding was reviewed as a false positive because validated executable plus separate argv uses no shell; the equivalent regression-only finding was classified as used in tests. All review threads were replied to with exact-head evidence and resolved only after this verification.

## Three-Blocker Final Review Amendment

Starting reviewed head: `2b1726566579f4fcb3f0b173004ac5d7d41fcac3`.

- Before the admission lock, direct launch now performs a bounded read-only native plugin verification through the selected Claude CLI. Current enabled, trusted, and hook-active state must be exact, and the current cache path, hook bytes, controller bytes, and plugin version must match the persisted proof. Missing, malformed, stale, replayed, or unverifiable state refuses before queue, reservation, or job artifacts. Setup proof remains necessary but is no longer sufficient by itself.
- Toolkit-managed children pass the supported variadic `--disallowedTools Agent Task` arguments with separate argv. Medium effort, fast/background disablement, prompt-free argv, and stdin-only prompt transport are unchanged.
- Direct launch resolves executable availability synchronously before enforcement verification and admission. Known-missing bare commands and explicit `.js`/`.cjs`/`.mjs`, `.exe`, `.cmd`, or `.bat` paths refuse without launched status, state, artifacts, or supervisor. If the executable disappears after preflight, the existing supervisor error/finally path terminates safely and releases owned reservation state.
- Toolkit Local Bridge project, native manifests, bridge/client/controller constants, setup expectations, generated outputs, and tests align at `2.7.3`.

Local amendment evidence: focused Claude plugin/process/controller/lifecycle tests passed 62/62; setup/profile/orchestration tests passed 53/53; Codex configuration/plugin/SessionStart regressions passed 94/95 with one expected POSIX-only skip; Toolkit Local Bridge passed 133/133; generated/project/doc/source-lock/published-surface/fallback-risk checks and skill/pack packaging passed. Direct validation in the primary worktree remains contaminated only by the protected ignored `.agent-toolkit-backups` directory. Without touching that material, a clean detached worktree at implementation commit `7dbff71a273b6bb4e80ba0a8b59594b4b341f302` passed Toolkit validation, generated freshness, skill/pack packaging, `git diff --check`, and all 138 runnable validator tests with 2 Windows symlink-capability skips.

## Official Claude Launcher Symlink Amendment

Starting reviewed head: `e342abeb90674f5790ba609fd609974c5b7fca96`.

Anthropic documents that the native macOS/Linux installer manages `~/.local/bin/claude` as a symlink into `~/.local/share/claude/versions/`. Executable preflight now resolves each candidate only for availability validation, requires the resolved target to be a regular file and POSIX-executable unless it is a JavaScript launcher handled by Node, and rejects broken links, cycles, directories, special files, and non-executable targets. The validated original command is returned unchanged, so bare `claude` remains the invocation command and native auto-update can move the launcher target. Shell-free argv, JavaScript-through-Node, Windows `.exe`/`.cmd`/`.bat`, synchronous pre-admission refusal, and post-preflight supervisor cleanup remain unchanged. Toolkit packaged surfaces align at `2.7.4`.

Official behavior source: https://code.claude.com/docs/en/setup#auto-updates

Local amendment evidence: focused Claude process/plugin/controller/lifecycle tests passed 63/67 with 4 symlink-specific skips because the Windows host either does not support the POSIX assertion or denied symlink creation; setup/profile/orchestration passed 53/53; Codex configuration/plugin/SessionStart passed 94/95 with one expected POSIX-only skip; Toolkit Local Bridge passed 133/133; generated/project/doc/source-lock/published-surface/fallback-risk checks and skill/pack packaging passed. A clean detached worktree at implementation commit `ceab4ad076f06bca29e4ffcfb415d54929a0dc06` passed Toolkit validation, generated freshness, skill/pack packaging, `git diff --check`, and all 138 runnable validator tests with 2 Windows symlink-capability skips. Exact-head Linux CI owns execution of the official-style, valid, broken, cyclic, directory, non-executable, and no-residue symlink cases.

## Four Security And Primary-Flow Amendments

Starting reviewed head: `47a7fff82b9f5041fd883715cdd8aeffc15dc4ad`.

- Activation proof schema 2 adds the exact installed `toolkit-claude-agent-hook.cjs` hash alongside plugin version, cache identity, hooks configuration, and controller hash. Runtime recomputes every field; missing, changed, or symlinked hook scripts fail before admission state.
- Strict profiles persist the original verified Claude command. Effective launch precedence is explicit argument, current `AI_AGENT_TOOLKIT_CLAUDE_CLI`, persisted command, then bare `claude`; every effective command repeats availability and native enforcement verification without mutating the profile.
- `AI_AGENT_TOOLKIT_CHILD=1` refuses both launch and admission before validation/probing, lock acquisition, queue/reservation state, artifacts, or supervisor creation. `Agent` and legacy `Task` denial remains defence in depth.
- Fresh ownerless/malformed lock directories remain protected during owner publication. Stale dead, ownerless, or malformed locks recover under an exclusive recovery marker using bounded directory age; live owners remain protected and concurrent contenders remain mutually exclusive.
- Toolkit packaged surfaces align at `2.7.5`.

Implementation commit `69886df37a2c11a0055ce1974ab2246bdcd312da` passed the focused Claude process/plugin/controller/lifecycle suite with 70 passes and 5 Windows/POSIX capability skips before commit; the post-review controller/lifecycle rerun, including missing-profile refusal, passed 31 tests with 2 Windows symlink-capability skips. Setup/profile/topology/orchestration passed 53/53, Codex configuration/plugin/SessionStart passed 94/95 with one expected POSIX-only skip, and Toolkit Local Bridge passed 133/133. Project sync, source-lock, published-surface, fallback-risk, portability, skill package, pack package, instruction/onboarding, and `git diff --check` checks passed.

A clean detached worktree at `69886df37a2c11a0055ce1974ab2246bdcd312da` passed direct Toolkit validation, generated-project freshness, skill packaging, pack packaging, `git diff --check`, and all 138 runnable validator tests with 2 Windows symlink-capability skips. Local `npm run validate:all` was not run because repository policy assigns the full gate to CI. Native Codex and Claude UAT remains pending.

## Five Exact-Head Production Amendments

Starting reviewed head: `480ddcfbfcb8ce87680084803c100ac2b7397118`.

- Relative path-like Claude CLI values are rejected on every platform. Absolute explicit paths remain supported. POSIX bare `claude` remains unpinned for official launcher updates; Windows bare commands resolve only from absolute PATH entries and carry the exact resolved candidate through setup, verification, profile persistence, and worker execution, excluding project-cwd shadows.
- Recovery markers now publish private PID, creation-time, and token ownership. Fresh and live-owner markers remain protected; stale dead, ownerless, or malformed markers recover after `LOCK_TTL_MS`, including interrupted recovery with displaced lock state, while primary-lock protections and contender mutual exclusion remain intact.
- Claude launch capability no longer depends on incomplete help text. Setup runs a bounded empty-input, no-session-persistence probe with the exact print, JSON output, medium effort, `Agent`/`Task` denial, and default permission argument shape. Unsupported syntax is classified separately from authentication/network/quota/model or other runtime failures; indeterminate capability fails closed. This follows the official [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).
- Reservation update/release validates the complete existing state before mutation. Malformed JSON, future schemas, contradictory identities, invalid reservations, and invalid queue entries remain byte-for-byte unchanged; missing targets do not rewrite unrelated valid state; valid mutations affect only the named reservation. Supervisor execution stops when ownership update cannot be verified.
- Toolkit packaged surfaces align at `2.7.6`.

Implementation commit `b61cd350d0ec66838d831e7383818bf6a0981120` passed the focused Claude process/plugin/controller/lifecycle suites with 80 passes and 5 Windows/POSIX capability skips; setup topology/profile/orchestration passed 55/55; Codex configuration/plugin/SessionStart passed 94/95 with one POSIX-only skip; instruction and hook-light checks passed 23/23; Toolkit Local Bridge passed 133/133. Instruction/project/doc sync, source-lock, published-surface, fallback-risk, portability, skill package, pack package, and `git diff --check` checks passed.

A clean detached worktree at `b61cd350d0ec66838d831e7383818bf6a0981120` passed direct Toolkit validation, generated-project freshness, skill packaging, pack packaging, `git diff --check`, and all 138 runnable validator tests with 2 Windows symlink-capability skips. The contaminated primary-worktree validator run was not used as clean evidence because the protected ignored `.agent-toolkit-backups` directory remains present and untouched. Local `npm run validate:all` was not run because repository policy assigns the full gate to CI. Native Codex and Claude UAT remains pending.

## Four Exact-Head Execution And Cache Amendments

Starting reviewed head: `5f24325afe072d8315cd0fde1ccd11fca6258f85`.

- Bare Claude commands now resolve only through absolute PATH components on every platform and return the stable absolute launcher candidate, not the bare command or version-specific realpath target. Controller and supervisor execution carry that candidate, and every spawn revalidates its current regular executable target. Empty, dot, and other relative PATH components cannot substitute a project-local executable; official POSIX launcher symlink target changes remain supported; missing or non-executable candidates fail closed.
- One canonical resolver selects the Claude command for plugin verification/write, setup capability inspection, strict-profile persistence, current enforcement verification, controller launch, and supervisor execution. Precedence is explicit current argument, `AI_AGENT_TOOLKIT_CLAUDE_CLI`, `CLAUDE_TOOLKIT_CLAUDE_CLI`, `CLAUDE_CLI_PATH`, persisted profile command, then bare `claude`. The selected current override fails closed instead of silently falling through to a different command.
- Codex same-version cache freshness now includes the setup core's newly required `toolkit-agent-control.cjs` and `claude-process-launch.cjs` dependencies. Missing or stale bytes fail verification and use the existing remove/reinstall refresh path; unrelated user-owned files remain untouched.
- Claude installed-cache verification now requires exact source bytes and regular-file topology for the SessionStart `toolkit-local-bridge.cjs`. Missing, stale, or replaced bridge files prevent verify/no-op success and trigger the supported native refresh path. This is cache-completeness evidence only; activation-proof schema 2 remains limited to trusted/active strict Agent enforcement identities.
- Toolkit packaged surfaces align at `2.7.7`.

Local amendment evidence: Claude process/plugin tests passed 46 with 8 Windows/POSIX capability skips; Codex cache/setup passed 26/26; setup topology/resolver passed 15/15; controller plus detached lifecycle passed 37 with 2 capability skips; setup profile/topology/orchestration passed 58/58; Codex configuration/removal, SessionStart, and cache setup passed 75 with 1 POSIX-only skip. Project sync, instruction sync, repo-doc sync, source-lock, published-surface, fallback-risk, portability, skill packaging, pack packaging, and `git diff --check` passed.

The full Toolkit Local Bridge run reported 32 passing tests before the known Windows post-summary handle retained the process through the 15-minute bound; no assertion failure was reported and no owned orphan remained. The primary-worktree validator run and eight positive validator fixture cases were contaminated only by the protected ignored `.agent-toolkit-backups` directory and its intentionally incomplete copied links. That material remains untouched. A clean detached worktree at implementation commit `86dc3787438a5f4edbbe970e4b360c6f114d56a8` passed direct Toolkit validation, generated-project freshness, skill packaging, pack packaging, `git diff --check`, and all 138 runnable validator tests with 2 Windows symlink-capability skips. Exact-head CI remains required before thread resolution; native UAT remains a separate post-merge gate.

## Sole Activation-Proof Dependency Amendment

Starting reviewed head: `27d4ff25ca37be023e6fcc9ab5f8065cd57358aa`.

- Activation-proof schema 3 binds the complete native Agent/Task denial runtime. Persisted proof fields are `schema`, `source`, `plugin_version`, `cache_identity`, `hook_sha256`, `controller_sha256`, `process_launch_sha256`, and `agent_hook_sha256`.
- Proof construction and current verification recompute `process_launch_sha256` from the exact installed `repo/scripts/claude-process-launch.cjs` selected by `cache_identity`. Hooks, controller, process launcher, and Agent hook must each be a non-symlink regular file.
- Schema-2, missing-field, malformed-field, missing-file, changed-file, replacement-cache, directory, and symlink states fail closed. Refusal occurs before lock acquisition, admission state, queue/reservation state, jobs, output/error files, or supervisor creation.
- Exact current hooks, controller, process launcher, and Agent hook admit. A correct schema-3 profile persists and revalidates through current native plugin state.
- Toolkit packaged surfaces align at `2.7.8`. SessionStart bridge completeness and every previously accepted executable, command-precedence, cache, resource, lock, state, prompt, Agent/Task, child-reentry, topology, and privacy repair remain unchanged.

Initial focused evidence: Claude process launch passed 11 with 7 platform/capability skips; Claude plugin setup passed 35 with 1 symlink-capability skip; controller/proof/admission passed 37 with 3 platform/capability skips; detached lifecycle passed 1/1; setup profile execution passed 2/2; setup topology passed 15/15. Exact-head CI and surrounding validation remain required before thread resolution.

## Release Gates

- The sole current exact-head finding is repaired locally by activation-proof schema 3 and `process_launch_sha256`. It remains subject to surrounding validation, exact-head CI/CodeQL, evidence reply, and thread resolution.
- The prior four exact-head findings remain repaired: trusted POSIX launcher execution, unified Claude command resolution, complete Codex setup dependency fingerprints, and Claude SessionStart bridge cache verification.
- The eight earlier exact-head findings remain repaired: canonical Codex removal identity, private artifacts, canonical topology/capacity, aggregate reservation memory, installed-hook coupling, complete profile validation, kept-profile capability downgrade, and prompt-free argv.
- Implementation-head CI initially found one stale validator-version expectation on `8fa84a84bf9d7a39c4f865813617d9d7dc3ea7ce`. The one-line repair in `6207ba997d9ca1cb111e87a3113cd9be5eff53e4` passed both validation workflows, generated-surface sync, both package checks, the CodeQL workflow gate, and all material CodeQL analyses. Any subsequent closure-note head remains subject to the same exact-head gate.
- PR remains unmerged.
- Issues #241 and #247 remain open.
- Native Codex C1/C2 and startup/resume/clear/compact reruns remain post-merge gates.
- Claude Code native UAT remains pending after Codex has a stable disposition.

## Instruction Sources Used

- Root `AGENTS.md`.
- `repo/docs/agent-playbooks/INDEX.md` and routed playbooks.
- `repo/docs/FOR_AI_AGENTS.md`.
- `repo/docs/SOURCE-OF-TRUTH.md`.
- `repo/docs/WRITE-SAFETY-MODEL.md`.
- `repo/docs/SAFE-UPDATES.md`.
- `repo/docs/PROJECT-MODULE-STANDARD.md`.
- `repo/docs/SURFACE-FIDELITY-AUDIT.md`.
- `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`.
- Project Completion Audit and Context-Preserving AI Publisher maintenance guidance.

`MEMORY.md` was absent and was not created.
