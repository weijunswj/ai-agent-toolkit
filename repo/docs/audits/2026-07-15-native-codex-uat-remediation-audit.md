# Native Codex UAT Remediation Audit

Date: 2026-07-15
Status: Enforceable Claude amendment and review-thread verification complete; native UAT pending

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
- Scoped deterministic release finding status: local deterministic coverage now exercises the enforceable Claude boundary and both current P2 review regressions. Exact-head CI, current-head review verification, and native host UAT remain pending.

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

Implementation-head PR CI passed on `3943c28c5c6ccbba81cc00c992067ec5f59fddb4`, and the audit-only follow-up `f3e44a681e22e74c16d40b1dda31c22b2eae51bd` also passed: both validation workflows, generated-surface sync, both package checks, the CodeQL workflow gate, and all three material CodeQL analyses passed. All six review threads are resolved after current-head verification; unresolved-current count is zero. Any later closure-note head must independently pass exact-head CI before completion. Native Codex C1/C2, startup/resume/clear/compact, and Claude native UAT remain pending.

## Release Gates

- The P1 topology/admission finding is implemented; its review thread and both current P2 threads were resolved only after fixing-SHA evidence and exact-head verification. All six PR review threads are resolved.
- Implementation-head CI passed on `3943c28c5c6ccbba81cc00c992067ec5f59fddb4`, and audit-only head `f3e44a681e22e74c16d40b1dda31c22b2eae51bd` also passed. Any subsequent closure-note head remains subject to the same exact-head gate.
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
