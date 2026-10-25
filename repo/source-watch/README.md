# Source Watch

Source-watch is review-notification-only. It may open or refresh a stable PR with a report, but it must not copy upstream files, update pins or advisory records, execute upstream code, delete toolkit components, auto-merge, or push to `main`.

`review-state.json` stores human-advanced, per-target reviewed-through cursors. A cursor records the exact upstream state that was reviewed and dispositioned; it never adopts a source pin, changes an advisory baseline, or records the latest observation. The detector uses an identity-matching cursor first, then the adopted SOURCE-LOCK pin or advisory compatibility baseline as the migration fallback. The scheduled workflow never writes review state.

## Review Lanes

| Lane | Input | Review trigger | Output |
| --- | --- | --- | --- |
| Active third-party source updates | `repo/source-watch/provenance/**/SOURCE-LOCK.json` plus `review-state.json` | Latest GitHub commit differs from the identity-matching reviewed-through cursor, or from the adopted `source_commit` when no cursor exists. | `repo/source-watch/reviews/active-third-party-updates.md` notification PR. |
| Advisory targets | `repo/source-watch/advisory-targets.json` plus `review-state.json` | GitHub advisory target differs from its reviewed-through cursor, falls back to a compatibility baseline, has no baseline, or is explicitly pending. | Same notification PR; advisory document and review-state changes happen separately. |
| Host Harness Capability Drift Review | `repo/source-watch/advisory-targets.json` target `host-harness-capability-drift-review` plus [template](templates/host-harness-capability-drift-review.md). | `review_cadence_days` has elapsed or no `last_reviewed_at` is recorded. | Same notification PR; any shrink/move/delete work must be a separate evidence-backed PR. |

## Host Harness Capability Drift Review

Use this lane to check whether a supported host (Codex or Claude Code) gained native behavior that duplicates, supersedes, or conflicts with toolkit instructions, skills, hooks, repo-map guidance, or documentation-cleanup guidance.

Required evidence sources:

- OpenAI Codex docs and changelog, including AGENTS.md, hooks, and rules.
- OpenAI Codex skills, plugins and subagents docs.
- Claude Code docs and changelog, including CLAUDE.md, rules, hooks, and scheduled/automation behavior.
- Claude Code settings, permissions, plugins, subagents and skills docs.
- Toolkit-owned `skills/**`, root instructions, hook/plugin metadata, repo-map guidance, and documentation-cleanup guidance.

Antigravity receives a portable skills copy only, so the review covers it only where that copy depends on host behaviour. Add another host to the review once Toolkit qualifies it as supported.

The reviewed-through cursors in `review-state.json` keep the tracker that was current when each review happened. That is history, not ownership: reports label it as the tracker at last review, and triage finds the current owner before acting.

Allowed classifications are `Keep`, `Shrink`, `Move to hook`, `Move to host-native feature`, `Delete`, and `Needs benchmark/eval before decision`.

If no meaningful drift is found, update only the advisory review status in a separate PR. If meaningful drift is found, open a separate PR with evidence, rationale, exact proposed modifications, validation, and any generated-output status.
