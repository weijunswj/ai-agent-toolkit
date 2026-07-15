# Native Codex UAT Remediation Audit

Date: 2026-07-15
Status: Amendment locally validated; exact-head PR CI and native UAT pending

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
- Official Claude Code subagent, hooks, plugin, fast-mode, model, settings, and environment documentation.

## Findings

| Severity | Domain | Finding | Release gate |
| --- | --- | --- | --- |
| P1 | Delegation | Existing rules reject generic parallelism but do not explicitly classify a direct generic helper request as a non-conflicting preference or require present-task evaluation in a fixed order. Native C2 delegated after acknowledging that no criterion was met. | Repair authoritative shared policy, regenerate host surfaces, and add exact C2 contract coverage. Native C2 remains required after merge. |
| P1 | SessionStart | The packaged Codex command uses bare `node` plus shell-style `${PLUGIN_ROOT}` expansion. Either can fail before `toolkit-local-bridge.cjs` starts, outside its hook-safe catch. The exact native red-exit cause is not yet attributable from screenshot evidence alone. | Reproduce a materially equivalent pre-JavaScript failure, add a Windows-safe launcher boundary and strict installed-cache verification, and prove safe hook skips exit zero. Native startup/resume/clear/compact remain required after merge. |
| P1 | Question bank | The canonical helper row exposes a generic `Advanced` outcome and the renderer compresses choices into one pipe-separated line. Runtime-invalid helper choices can remain visible. | Replace the generic submenu with direct state-valid outcomes and list rendering while preserving one canonical question specification and strict input ordering. |
| P1 | Installed hook freshness | Windows verification normalized only the command shape and did not compare the complete normalized hook file, allowing unrelated stale hook entries to survive. | Validate both hook shapes, normalize only the intentional Windows command, then require exact source/cache bytes. |
| P1 | Launcher privacy | Bridge output could be emitted before a later optional-maintenance failure, exposing partial diagnostics despite the final privacy-safe warning. | Capture stream, console, and module-load output within a fixed bound; replay only after complete success. |
| P1 | Setup recommendation | Unsupported and disabled runtime states exposed only `keep` but could still describe a one-helper recommendation. | Derive choices and recommendation text from the same runtime-support state. |
| P2 | Native enforcement capability | Current native Codex and Claude surfaces cannot verify strict child-only non-fast execution and all required admission controls for every built-in, plugin, Security, third-party, and nested path. | Do not ship decorative profiles or claim hard enforcement. Keep unsupported paths root-only and describe configured capacity as a backstop. |

## Remediation Disposition

- Delegation: repaired in the authoritative shared execution partial and regenerated surfaces. Generic helper, delegation, parallelism, and speed wording is explicitly non-conflicting; present-task qualification is ordered and all six facts remain mandatory. The exact failed C2 wording has contract coverage. Defined bounded specialist and multi-worker workflows remain available when they qualify.
- SessionStart: repaired through a hook-safe Node launcher plus a Windows PowerShell boundary. Supported Windows setup writes one exact installed-cache command and exact Node runtime metadata, verifies matcher coverage and launcher bytes, rejects the old direct bridge shape, preserves hook streams, and converts optional hook startup or bridge failures to one privacy-safe exit-zero skip. Manual bridge failures remain non-zero.
- Question bank: repaired through one canonical structured specification with direct conditional choices, explicit recommended/selected/empty-input values, Markdown and terminal list renderers, and no generic advanced submenu. Exact Toolkit-owned limit removal is conditional and uses preview-bound approval, stale-byte rejection, one exact backup generation, and restore commands before mutation.
- Installed hook freshness: repaired by validating source and installed hook shapes first, normalizing only the installed Windows `SessionStart` command, and comparing the complete normalized bytes. Extra or stale hook entries now fail verification.
- Launcher privacy: repaired with a 1 MiB bounded transactional capture for stdout, stderr, console methods, and dependency-load output. Output is replayed only after successful bridge completion; failures emit only the existing support-safe warning and exit zero.
- Setup recommendation: repaired so disabled, unknown, and unsupported runtimes expose and recommend only `keep`; visible recommendation text uses the same runtime-supported state as the choices.
- Productive parallelism: the portable policy now requires a declared bounded launch gate, active topology and resource admission, verified medium non-fast child execution, immediate meaningful root-owned work, and root-owned integration. Generic requests, capacity, task count, speed, or later UAT cannot qualify delegation alone.
- Native capability: no Codex or Claude profile was added because the reviewed native surfaces do not provide verifiable strict enforcement for all required paths. Codex helper capacity remains a conservative memory backstop, not launch permission; unsupported paths remain root-only.
- Scoped deterministic release finding status: no unresolved P1 finding. Native host behavior remains a post-merge gate rather than implementation proof.

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

PR #259 CI passed on earlier commit `cd6b32dde6377436ea7e46573bd2b00789d4d843`, including both validation jobs, package checks, generated-surface sync, and CodeQL. That result does not validate the current amendment; the new exact head must pass before final completion.

The first amendment CI run on `e4bb4388b4fe7b83c52ea8b37adfe0ef5f2c9f2f` failed three portable instruction phrase-contract assertions. The targeted repair restored the compact application-error, fallback, and optional-memory contracts and aligned Git Completion assertions with the compressed equivalent wording. The five-test observability suite, two affected validator tests, 18 instruction-shim tests, direct validator, and both generated checks pass locally; replacement exact-head CI remains required.

Native Codex C1/C2 and startup/resume/clear/compact were not run and are explicitly excluded from implementation proof.

## Release Gates

- No unresolved P1 finding in the scoped implementation and deterministic tests.
- Current amendment exact-head CI remains required before calling the PR implementation-complete.
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
