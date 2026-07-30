# Source Watch

Source-watch is review-notification-only. Its hourly deterministic lane may open
or refresh a stable PR with a report, but it must not copy upstream files,
update pins or advisory records, download or execute upstream code, delete
toolkit components, auto-merge, or push to `main`. A source or metadata failure
is `UNVERIFIED`; it is never reported as no change.

## Review Lanes

| Lane | Input | Review trigger | Output |
| --- | --- | --- | --- |
| Active third-party source updates | `_projects/**/SOURCE-LOCK.json` | Latest GitHub commit differs from the pinned `source_commit`. | `repo/source-watch/reviews/active-third-party-updates.md` notification PR. |
| Advisory targets | `repo/source-watch/advisory-targets.json` | GitHub advisory target moved, baseline is missing, or a manual target is pending. | Same notification PR; advisory document changes happen separately. |
| Host Harness Capability Drift Review | `repo/source-watch/advisory-targets.json` target `host-harness-capability-drift-review` plus [template](templates/host-harness-capability-drift-review.md). | `review_cadence_days` has elapsed or no `last_reviewed_at` is recorded. | Same notification PR; any shrink/move/delete work must be a separate evidence-backed PR. |
| Security tool provenance | `skills/repository-security-gate/config/tool-lock.json` | Release/ref, asset identity/checksum, licence digest, publisher maintenance state, or pinned commit changed. | Same notification PR; the lock is never updated by source-watch. |

## Security candidate validation

Candidate execution is a separate trust boundary in
`.github/workflows/security-candidate-validation.yml`. It is manual-only, reads
trusted `main`, accepts only an active reviewed lock record, downloads the exact
official asset, verifies its checksum, runs the synthetic corpus, and uploads a
bounded recommendation. It cannot write a branch, PR, issue, lock, or `main`.

To validate a new upstream candidate, first prepare a reviewed PR that updates
the lock metadata and evidence. Only after that PR is independently reviewed
may the manual lane execute the exact candidate from trusted `main`. Newest and
best means the newest stable candidate that passes provenance, licence,
compatibility, privacy, platform, and regression checks.

A confirmed compromised, revoked, critically vulnerable, maliciously updated,
or newly prohibited record must be changed to `blocked` in an urgent reviewed
PR. The hourly lane reports evidence but never performs that mutation itself.

## Host Harness Capability Drift Review

Use this lane to check whether Codex, Claude Code, OpenCode, Antigravity 2, or another supported host gained native behavior that duplicates, supersedes, or conflicts with toolkit instructions, skills, hooks, memory guidance, repo-map guidance, or documentation-cleanup guidance.

Required evidence sources:

- OpenAI Codex docs and changelog, including AGENTS.md, memories, hooks, and rules.
- Claude Code docs and changelog, including CLAUDE.md, memory/rules, hooks, and scheduled/automation behavior.
- Toolkit-owned `skills/**`, root instructions, hook/plugin metadata, repo-map guidance, `MEMORY.md` guidance, and documentation-cleanup guidance.

Allowed classifications are `Keep`, `Shrink`, `Move to hook`, `Move to host-native feature`, `Delete`, and `Needs benchmark/eval before decision`.

If no meaningful drift is found, update only the advisory review status in a separate PR. If meaningful drift is found, open a separate PR with evidence, rationale, exact proposed modifications, validation, and any generated-output status.
