# Repo-Scoped Scheduled Auto-Code Protocol: Architecture

## 1. Purpose, scope, and non-goals

This design defines a future explicit repository-scoped capability invoked by wording equivalent to:

```text
setup auto code for this repo
```

The capability coordinates a web controller, a scheduled executor, GitHub authority surfaces, and a coding-agent harness. It is disabled by default, requires repository-specific governance consent, and applies only to the exact repository that the user names and the setup command verifies.

The protocol preserves the controlling gate sequence:

```text
G1 architecture -> G2 controller Design Lock -> G3 implementation or amendment -> fresh exact-head G4
```

The web controller exclusively owns architecture, Design Locks, provider/model routing, escalation, queue and lane selection, issue and review-thread mutation, exact-head acceptance, and merge authority. An executor acts only on one complete explicit assignment. It does not self-grade, reinterpret the Design Lock, mutate issues or reviews, change the evaluation ledger, merge, or enable auto-merge.

This design does not implement the skill, controller, executor launcher, GitHub mutation runtime, scheduler integration, claim store, workflow, or managed block installation. GitHub Actions must not launch the coding agent in v1. The templates and fixtures are inert source material.

## 2. Repository setup algorithm

The future setup operation may perform safe repository preparation after explicit repository-level authority. It must never be enabled by global Toolkit installation or refresh.

1. Resolve the selected workspace to one exact repository identity: canonical owner/name, remote origin, default branch, and current commit. Reject missing, conflicting, redirected, detached-from-repository, or uninspectable identity. A repository name supplied only by a branch or PR is insufficient.
2. Verify repository-specific Toolkit governance consent. Consent must name this repository and permit this capability. A global Toolkit install, a previous consent for another repository, or an inferred owner relationship is not enough.
3. Locate and inspect the `repo-auto-code` skill from the selected source/install location. Read the whole skill and verify its version, source ownership, safety contract, and required references. If it is missing, unreadable, malformed, or not inspectable, fail the complete setup with `AUTO_CODE_SETUP_INVALID`; do not imitate it from memory.
4. Inspect the existing root `AGENTS.md`, its managed-marker topology, and repository-local ownership. Add or update only one source-owned auto-code block after a preview and explicit repository setup authority. A malformed, duplicated, interleaved, or ambiguous block is a hard stop; do not replace user content by guesswork.
5. Reconcile the rolling parent. There is exactly one controlling parent for the repository. Find it by explicit governed identity, not title similarity. A missing parent may be created only when repository-level setup authority allows safe preparation and active material work exists; two plausible parents, conflicting queue bodies, or an unexplained closure is a controller/user repair case.
6. Reconcile direct children. Every material task is a direct child of the rolling parent. Repair only unambiguous parent/child links. Do not create nested children, merge siblings, duplicate a task, or close a parent while active children, UAT, review, ledger, or user obligations remain.
7. Inspect relevant open, closed, and merged PRs, commits, complete diffs, exact heads, checks, issue links, and review conversations. A closed or merged PR can retain unresolved review obligations. An open state, author, branch prefix, age, or recency never grants authority.
8. Reconcile review obligations across the relevant PR set. The web controller owns replies, resolution, reopening, and dismissal. Keep valid unfixed or unverified findings open while remediation or verification is active, and include every applicable finding in the next worker assignment.
9. Classify every existing candidate PR using the complete evidence:
   - **Adoption eligible:** exact repository/child binding, explicit user/controller adoption authority, complete diff and commits inspected, current gate and Design Lock applicable, no forbidden overlap, no contradictory body, and all required enrolment surfaces can be bound atomically.
   - **Manual only:** observable and useful for dependencies or review obligations, but not explicitly enrolled or not proven safe for automated mutation.
   - **Held:** potentially relevant but blocked by ambiguous authority, stale head, pending checks, user action, review remediation, model capacity, or a possible unpushed worktree.
   - **Historical:** closed/unmerged, superseded, or explicitly retained as evidence only; never reopen, salvage, or use as authority without a new controller decision.
   - **Excluded:** another repository, unrelated lane, forbidden scope, untrusted source, or an identity that cannot be proven.
10. Prepare the parent queue entry, child body, and PR body only when the current authority is unambiguous. The parent remains lean, the child contains complete current authority, and the PR body records exact implementation state. The setup operation must not rewrite history or erase audit chronology.
11. Generate the controller and executor scheduled-task prompts from the source-owned templates. Prompts must be complete, standalone, fresh-chat safe, public-safe, and include one editable Provider/Model/Reasoning entry for every routing profile.
12. Require the user to edit and confirm every routing profile. The user must supply Provider, Model, and Reasoning for the scheduled dispatcher, G1/G2 support, normal G3, named G3 escalation, fresh G4, and exceptional final review. Missing or unavailable profiles block; L0 cannot substitute, downgrade, or self-escalate.
13. Show the exact two task definitions, repository identity, parent/children, enrolled PRs, capacity, and remaining actions. The user creates the schedules manually. Setup does not create, replace, pause, resume, delete, or activate scheduled tasks.
14. Re-read the managed block, parent, child, PR body, generated prompts, and local source ownership after preparation. Any partial write, duplicate marker, split packet, or body/comment disagreement remains unready and fails closed.
15. Report a safe disabled/enabled preparation state. "Prepared" never means "scheduled," "claimed," "enrolled," "running," or "merge-authorised."

## 3. Managed repository instruction block

The future installed block is one compact source-owned section. It identifies state, protocol version, canonical skill, rolling parent, both complete handoff marker names, fresh-chat reconstruction, explicit PR enrolment, controller-owned routing and review mutation, public-safe GitHub requirements, and exact fail-closed repair behavior. It does not contain full prompts, historical packets, executor evidence, or a duplicate child issue. The design PR provides [`templates/AGENTS.auto-code.managed.md`](templates/AGENTS.auto-code.managed.md) but does not install it.

If the skill, managed block, or routing configuration is missing, malformed, duplicated, or contradictory, the future repair result is exactly `AUTO_CODE_SETUP_INVALID`. The operation must preserve bounded user work and user-owned content, write no fallback block, and ask the controller/user to repair the source-of-truth structure.

## 4. Durable authority surfaces

| Surface | Canonical responsibility | Required contents | Explicit exclusion |
| --- | --- | --- | --- |
| Parent body | Lean ordered queue and control state | Checklist order, active child/lane, current turn, packet or none, enrolled PRs, material parallel work, review/user action, immediate next action | Full prompts, executor evidence archive, historical packets |
| Child body | Complete current authority for one material task | Status, parent/PR/head, gate and Design Lock, enrolment, live packet/turn, completed and remaining work, findings, blockers, acceptance criteria, next mutation | A second queue, hidden authority, stale copied history |
| Child comments | Full audit and handoff chronology | Observation, independent verification, executor evidence, checks, head changes, review dispositions, verdict, remaining work, and the live marked prompt when issued | Deleting durable evidence after processing |
| PR body | Exact implementation state | Parent/child links, enrolment marker, base/head, checks, review state, gate/verdict, packet, next authorised mutation | Authority inferred from author, branch, open state, or recency |
| PR comments | Discoverability by default | Compact pointer to the canonical child comment | Full mirrored prompt unless explicit compatibility mode is enabled and tested |

The parent, child, and PR body must agree before automated mutation. Child comments are the canonical full copy. A compatibility mode may mirror a prompt into a PR comment only when the harness cannot follow the child comment; the child remains canonical and dual-redaction tests must prove that exactly one canonical copy controls the lifecycle.

Manual controller prompts, including G1/G2, Design Lock, user-choice, and exceptional-review prompts, remain in the active web conversation. They are not copied into GitHub bodies or comments or into scheduled-task payloads. GitHub stores only protocol-governed audit and handoff packets, executor evidence, and discoverability pointers; a controller must not reconstruct a manual prompt from partial audit records.

The exact three-surface binding grammar is defined in [`protocol.md`](protocol.md). Each parent queue entry, child body, and PR body has one `[ AUTO-CODE ENROLMENT: START ]` / `[ AUTO-CODE ENROLMENT: END ]` block with the same protocol version, repository, parent, child, PR, Packet ID, turn, and `ENROLLED` value. Only the expected `Surface` value differs (`PARENT`, `CHILD`, or `PR`). Missing, duplicated, extra-field, malformed, or disagreeing blocks fail the lane closed.

## 5. Explicit enrolment and queue selection

Automated mutation requires matching enrolment across three surfaces:

1. The parent checklist entry names the child, PR, and enrolled state.
2. The child body names the same implementation PR and enrolled state.
3. The PR body contains the managed enrolment marker naming the same child and repository.

The controller must re-read all three. Any missing, duplicate, malformed, stale, or contradictory binding fails the affected lane. Enrolment is never inferred from author, branch prefix, recency, open state, user ownership, or agent ownership. Unenrolled PRs remain observable for dependencies and review obligations but are manual-only.

Parent checklist order is the v1 queue. Selection never uses PR recency, lowest PR number, branch prefix, or author. The controller reconciles results, unexpected state, checks, reviews, and dependencies first, then continues active lanes in checklist order, then selects the first eligible ready lane within capacity.

## 6. Manual work, exact heads, and non-destructive integration

User work on another PR is preserved unless it changes a dependency, canonical `main`, controlling architecture, or a forbidden shared surface. A same-PR fast-forward may be adopted only after complete intervening commit inspection and line-by-line diff inspection prove that the assignment remains applicable and within the Design Lock. A change during execution requires a fresh read of the live head, local status, worktree, commits, and diff; compatible work is integrated non-destructively, and ambiguous or conflicting work is held.

Canonical `main` movement, conflicting architecture, forbidden-scope overlap, ambiguous user intent, worktree contamination, and possible unpushed executor work fail closed for the affected lane. Preserve bounded local work. Never force-push, reset, rewrite history, silently overwrite, or discard user/executor changes. Rerun every affected validation and obtain fresh exact-head G4 after every PR-head movement.

## 7. Review-thread ownership

Every controller cycle sweeps relevant open review conversations across open, closed, and merged PRs. The controller must truthfully disposition each finding:

- fixed and independently verified: reply with evidence and resolve;
- already satisfied: explain the evidence and resolve;
- incorrect assumption: explain the facts and resolve;
- intended design: cite the controlling authority and resolve;
- superseded or duplicate: link the controlling evidence and resolve;
- valid but unfixed or unverified: keep open only while active remediation or verification is pending, and include the complete finding in the next applicable worker prompt.

The final sweep is mandatory before every next worker prompt, G4, acceptance, merge, child closure, next-task selection, or parent closure. The executor is read/report-only for issue and review state.

## 8. Sensitive context and completion boundary

GitHub may receive secret names, presence/absence, and privacy-safe verification results only. It must never receive secret values, credentials, environment dumps, authorization headers, private endpoints, or raw executor-only context. If a controller needs sensitive context, the executor packet uses `PRIVATE USER FOLLOW-UP REQUIRED` with a safe question and `[REDACTED]` values; the web controller asks the user in private chat. A raw secret requirement invalidates the affected run.

Final completion requires no live unconsumed next-worker prompt, no unprocessed executor result, no unresolved valid review obligation, no pending child/UAT/ledger/user obligation, no contradictory parent/child/PR state, and explicit user instruction to remove both scheduled tasks. Teardown must verify that only this repository's two tasks were removed or disabled; another repository must remain untouched.
