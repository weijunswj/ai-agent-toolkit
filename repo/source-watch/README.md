# Source Watch

Source-watch is review-notification-only. It may open or refresh a stable PR with a report, but it must not copy upstream files, update pins or advisory records, execute upstream code, delete toolkit components, auto-merge, or push to `main`.

## Review Lanes

| Lane | Input | Review trigger | Output |
| --- | --- | --- | --- |
| Active third-party source updates | `_projects/**/SOURCE-LOCK.json` | Latest GitHub commit differs from the pinned `source_commit`. | `repo/source-watch/reviews/active-third-party-updates.md` notification PR. |
| Advisory targets | `repo/source-watch/advisory-targets.json` | GitHub advisory target moved, baseline is missing, or a manual target is pending. | Same notification PR; advisory document changes happen separately. |
| Host Harness Capability Drift Review | `repo/source-watch/advisory-targets.json` target `host-harness-capability-drift-review` plus [template](templates/host-harness-capability-drift-review.md). | `review_cadence_days` has elapsed or no `last_reviewed_at` is recorded. | Same notification PR; any shrink/move/delete work must be a separate evidence-backed PR. |

## Host Harness Capability Drift Review

Use this lane to check whether Codex, Claude Code, OpenCode, Antigravity 2, or another supported host gained native behavior that duplicates, supersedes, or conflicts with toolkit instructions, skills, hooks, memory guidance, repo-map guidance, or documentation-cleanup guidance.

Required evidence sources:

- OpenAI Codex docs and changelog, including AGENTS.md, memories, hooks, and rules.
- Claude Code docs and changelog, including CLAUDE.md, memory/rules, hooks, and scheduled/automation behavior.
- Toolkit-owned `skills/**`, root instructions, hook/plugin metadata, repo-map guidance, `MEMORY.md` guidance, and documentation-cleanup guidance.

Allowed classifications are `Keep`, `Shrink`, `Move to hook`, `Move to host-native feature`, `Delete`, and `Needs benchmark/eval before decision`.

If no meaningful drift is found, update only the advisory review status in a separate PR. If meaningful drift is found, open a separate PR with evidence, rationale, exact proposed modifications, validation, and any generated-output status.
