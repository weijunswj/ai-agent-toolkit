# Native Codex UAT Remediation Audit

Date: 2026-07-15
Status: Implementation and PR CI validated; native UAT pending

## Scope

This is a scoped post-PR #258 audit and remediation for Toolkit issues #241 and #247. It covers only:

- Root-first delegation qualification for generic helper and speed wording.
- Native Codex `SessionStart` launcher and hook-safe exit behavior on Windows.
- Setup question-bank choice semantics and presentation.

Repository type: mixed data/tooling and native plugin metadata.

Branch: `fix/241-native-uat-remediation`

Base: `771af1c1191d8a31d3d0cacfc2253421b6c18b59`

## Evidence Reviewed

- Issue #241 and its latest post-PR #258 native-UAT comment.
- Issue #247 and its latest Batch C `REMEDIATION REQUIRED` comment.
- PR #258 reviewed head `23193e06d1bea8623a1dff709dd616dfa1aa76c1` and squash merge `771af1c1191d8a31d3d0cacfc2253421b6c18b59`.
- Authoritative agent-rule partials, Toolkit Local Bridge project sources, native plugin manifests, setup scripts, validators, tests, and generated-output declarations.

## Findings

| Severity | Domain | Finding | Release gate |
| --- | --- | --- | --- |
| P1 | Delegation | Existing rules reject generic parallelism but do not explicitly classify a direct generic helper request as a non-conflicting preference or require present-task evaluation in a fixed order. Native C2 delegated after acknowledging that no criterion was met. | Repair authoritative shared policy, regenerate host surfaces, and add exact C2 contract coverage. Native C2 remains required after merge. |
| P1 | SessionStart | The packaged Codex command uses bare `node` plus shell-style `${PLUGIN_ROOT}` expansion. Either can fail before `toolkit-local-bridge.cjs` starts, outside its hook-safe catch. The exact native red-exit cause is not yet attributable from screenshot evidence alone. | Reproduce a materially equivalent pre-JavaScript failure, add a Windows-safe launcher boundary and strict installed-cache verification, and prove safe hook skips exit zero. Native startup/resume/clear/compact remain required after merge. |
| P1 | Question bank | The canonical helper row exposes a generic `Advanced` outcome and the renderer compresses choices into one pipe-separated line. Runtime-invalid helper choices can remain visible. | Replace the generic submenu with direct state-valid outcomes and list rendering while preserving one canonical question specification and strict input ordering. |

## Remediation Disposition

- Delegation: repaired in the authoritative shared execution partial and regenerated surfaces. Generic helper, delegation, parallelism, and speed wording is explicitly non-conflicting; present-task qualification is ordered and all six facts remain mandatory. The exact failed C2 wording has contract coverage. Defined bounded specialist and multi-worker workflows remain available when they qualify.
- SessionStart: repaired through a hook-safe Node launcher plus a Windows PowerShell boundary. Supported Windows setup writes one exact installed-cache command and exact Node runtime metadata, verifies matcher coverage and launcher bytes, rejects the old direct bridge shape, preserves hook streams, and converts optional hook startup or bridge failures to one privacy-safe exit-zero skip. Manual bridge failures remain non-zero.
- Question bank: repaired through one canonical structured specification with direct conditional choices, explicit recommended/selected/empty-input values, Markdown and terminal list renderers, and no generic advanced submenu. Exact Toolkit-owned limit removal is conditional and uses preview-bound approval, stale-byte rejection, one exact backup generation, and restore commands before mutation.
- Scoped deterministic release finding status: no unresolved P1 finding. Native host behavior remains a post-merge gate rather than implementation proof.

## Security Readiness

Codex Security is not available through the current OpenCode tool surface. The approved standard review therefore uses manual launcher, process, filesystem-boundary, privacy, and failure-path inspection plus isolated fixtures. No deep scan is approved or planned.

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

The complete `repo/tests/validate-toolkit.test.cjs` process exceeded 15 minutes twice without output and left no owned orphan. Its directly affected packaged-version case and the direct Toolkit validator both pass. CI remains the full read-only gate; local `npm run validate:all` was not run per repository policy.

PR #259 exact-head CI passed on commit `cd6b32dde6377436ea7e46573bd2b00789d4d843`, including both validation jobs, package checks, generated-surface sync, and CodeQL. The documentation-only follow-up that records this result must also pass exact-head CI before final completion.

Native Codex C1/C2 and startup/resume/clear/compact were not run and are explicitly excluded from implementation proof.

## Release Gates

- No unresolved P1 finding in the scoped implementation and deterministic tests.
- Exact-head CI inspected and green before calling the PR implementation-complete.
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
