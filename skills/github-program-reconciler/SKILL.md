---
name: github-program-reconciler
description: Reconcile programme state on github.com where .github/toolkit-programme.json exists, at significant events (the binding is added; a child issue changes; a merge; a PR opens or its head moves; an issue closes or reopens; outcomes reorder; a release; a controller changes). Any session may run the dry-run reconcile or show and report it. Only the appointed controller writes programme state: it holds the parent document and runs every writing command itself, including gates, returns, UAT, review and completion. Executors (G0, G1, G2) and helpers never write. Every programme.cjs command refuses without the binding; the binding does not change governed issue records. Never closes, deletes or merges.
---

# GitHub Program Reconciler

This skill loads on its own (its OpenAI metadata sets `allow_implicit_invocation: true`). The reconciler, its state documents, managed blocks and sub-issue links act only where `.github/toolkit-programme.json` exists; every `programme.cjs` command refuses without it. Ordinary GitHub reads, coding, reviews and the separate read-only decision-trace audit do not need that binding. Loading on its own grants no extra authority: every write still needs the fence and checks below.

**Who uses it.** The owner opts into the reconciler by adding `.github/toolkit-programme.json`, binding the parent issue and its private state store. It supports github.com only, and its state store supports `kind: github` only. The binding does not change the Toolkit-governed rules (the `TOOLKIT-GOVERNED-RULES` block in `AGENTS.md`) or their issue records. Company or third-party repositories without that block get no governed issue writes, only the coding-governance gates, subagents and portable skills; global rules still apply, including PRs after requested edits and task issues when the user asks to add one.

## When to run

Any session may run the dry-run `reconcile` (or `show`) at these significant events and report it to the controller. Only the appointed controller writes programme state; see "Who records what" below.

- The binding is added (the repository opts into the reconciler).
- A task (child issue) is added, deleted or modified.
- A merge completes.
- A PR is opened or its head moves.
- An issue is closed or reopened.
- Outcomes are reordered or reprioritised.
- A release ships.
- A controller is appointed or rebinds.

Check for the binding first at each event; without it, do not run `programme.cjs`. Governed issue records are unchanged. The reconciler never closes, deletes or merges.

## What ships

- `scripts/programme.cjs`: the command line. Run it from a checkout of the governed repository.
- `scripts/programme-state.cjs`: the owners it uses (`GitHubTransport`, `StateStore`, `ProgrammeGraphReader`, `Reconciler`, the renderer and the managed-block helpers).
- `scripts/decision-trace-audit.cjs`: the read-only decision-trace audit.
- `scripts/resolve-executable.cjs`: shared executable resolution and its error type; `programme-state.cjs` keeps the public exports.
- The document schemas live in the Toolkit repository under `repo/contracts/programme-state/`.

Everything runs through `gh` (resolved to a full `.exe` path, never from the working folder) as the signed-in account. There is no scheduler, webhook or background loop: a pass runs when someone asks for it.

## Binding

The governed repository holds `.github/toolkit-programme.json` (no secrets):

```json
{
  "schema": "toolkit.programme-binding.v1",
  "repository": "owner/name",
  "parent_issue": 421,
  "record_prefix": "INT-TK421-",
  "writer_prefix": "INT-TK421-",
  "store": { "kind": "github", "repository": "owner/private-store", "branch": "main", "path": "state/owner/name/" },
  "required_checks": ["validate"]
}
```

- The repository is the `origin` remote as GitHub names it; the file must agree and cannot override it (`REPO_IDENTITY_MISMATCH`).
- `store.kind` names the backend. The only kind is `github`: a separate repository that exists, is private and is writable, checked before every pass (`STATE_STORE_UNVERIFIED`). Another kind (a different store) is added in code with the same compare-and-swap contract; an unknown kind stops at setup. There is no fallback store.
- `required_checks` adds check names to the ones GitHub marks required. With neither, checks are never `GREEN`. (Toolkit's `main` has no required status checks configured, so its binding names them.)
- `projection` (optional) places the Programme Graph on the parent page: `replace_section` names a hand-kept section the graph replaces while it is still there (removed in the same body write), and `after_section` names the status section the graph follows. Toolkit uses `"after_section": "CURRENT", "replace_section": "Programme index"`.

## State documents

One private JSON document per outcome (`issue-<n>.json`) and one for the parent (`parent-<n>.json`) under the store path.

- **Parent:** fence, release-plan pointer and the **outcome catalogue** (issue, label, class `CORE`/`HARDENING`/`LATER`/`OPTIONAL`/`COMPLETED`/`RETIRED`, expected native parent, order within its class, lane, owner prefix, and an optional task `name` and one-line `description` for the Programme Graph). The catalogue is data: nothing is hard-coded to one programme.
- **Child:** lifecycle, release, gate (role, state, session, route, returns), candidate (full 40-character SHAs), PR (number, state, head, required checks at that head), UAT, review verdicts, blockers, exactly one next action, pending effects and a `private` field that is never rendered.
- Writes use Contents API compare-and-swap on the blob sha with readback. Unchanged state is never written (GitHub would still make an empty commit). The revision moves only when content changes; timestamps and pending effects do not count.
- On a 409 the change is re-applied only when the other writer touched different top-level fields and the fence did not move; otherwise `STATE_CONFLICT` or `STALE_WRITER`.

**Fence.** A document is held by one session and record prefix. Every write comes from the session that holds the parent document. `claim --takeover` increments the epoch in one compare-and-swap. A running pass re-reads the parent fence immediately before every state write and every GitHub change, so after a takeover the old pass stops at its next effect (`STALE_WRITER`); an intent it leaves `IN_FLIGHT` is settled by the successor's readback. The fence orders cooperating Toolkit writers under one account; it authenticates nobody and does not stop a person or another tool editing.

**Who records what.** Only the appointed controller writes programme state. Give the controller a stable writer name (for example `toolkit-421-controller`) and pass it as `--session`: coordinator sessions are replaced from time to time, and a fence held by one session would need a takeover after every replacement. Every coordinator and the reconcile workflow then write under that one name; a different controller takes over on purpose with its own name. The controller creates the parent document (`init-parent --apply`) and holds it, and runs every writing command with `--controller`: `reconcile --apply`, `update-parent`, `claim`, `update` and `return`. It records each gate (`claim --issue <n> --role <gate>`), submits and consumes returns, records UAT and G2 review verdicts, and sets `DONE` or `RETIRED`. Without `--controller` a writing command is refused before it reads anything, and with it a session that does not hold the parent is refused by the fence. Every other session, including G0, G1 and G2 executors and helpers, runs only the dry-run `reconcile` and `show` and reports to the controller. A controller stopped by a takeover stops and reports to the owner; only a controller appointed after that takeover verifies that the previous writer stopped, posts its takeover record, then runs `claim --parent --takeover --controller`.

**Returns (LIFE-1).** A gate return is consumed by its return ID, never by session. `REOPEN` puts the gate back to `ACTIVE` in the same session, a new submission takes a new ID, and `ACCEPT` retires the gate. Claiming an accepted gate again starts a new activation for a correction, which removes that acceptance until the new return is accepted. Consuming the same ID again with the same verdict does nothing; a different verdict is `RETURN_CONFLICT`; a return from before a takeover is `STALE_RETURN`.

**Evidence at a head.** UAT `PASSED`, `UAT_RETAINED` and `UAT_PARTIAL_REQUIRED` must carry `at_head` (the full SHA), and a decided review must carry at least one verdict with its head; otherwise the write is refused. Evidence at an older head than the live PR head renders as `STALE_HEAD`.

## Commands

| Command | Writes |
|---|---|
| `reconcile [--issue <n>]` | Nothing: prints findings and the effect plan |
| `reconcile --apply [--issue <n>]` | State documents and GitHub, as planned; controller only |
| `show [--parent \| --issue <n>] [--include-private]` | Nothing; sessions and `private` are redacted unless asked |
| `init-parent --catalogue <file> [--apply]` | Without `--apply`, nothing (validates the catalogue). Only the appointed controller runs `init-parent --apply`, which creates the parent document held by that controller |
| `update-parent --patch <file>` | Catalogue, release plan or `private` (merge patch); controller only |
| `claim (--parent \| --issue <n>) [--role G0\|G1\|G2] [--model <m> --effort <e> [--route-read-back]] [--takeover]` | The fence and gate; controller only |
| `update --issue <n> --patch <file>` | Lifecycle, release, candidate, UAT, review, blockers, next action or `private`; controller only |
| `return --issue <n> (--submit <id> \| --consume <id> --verdict ACCEPT\|REOPEN)` | Gate returns; controller only |

Every write needs `--controller` and `--session <id>` (an environment variable never supplies a session), and every write except `init-parent --apply` and a parent takeover needs that session to hold the parent document; the record prefix defaults to the binding's writer prefix. Every `--issue` is 1 or more. `--json` prints machine-readable output. `reconcile --parent-file <file>` dry-runs a proposed catalogue before `init-parent`. The PR for a child is found from `candidate.branch` and then kept by number.

## The reconcile pass

1. **Bind** repository identity, the store and the binding; read the parent and every catalogued child document.
2. **Observe** (read-only): issues, native parents, each expected parent's sub-issues in order, `blocked_by` edges, and for each child PR its head and required checks at that head.
3. **Recover first:** each pending effect from an earlier pass is settled by reading its target. Done or not done leaves the document; an unreadable target stays `UNKNOWN` and holds that target. Nothing is replayed without that read.
4. **Diff** into findings: `NATIVE_PARENT_MISSING`, `NATIVE_PARENT_WRONG`, `NATIVE_ORDER_DRIFT`, `PR_HEAD_MOVED` (review and UAT at the old head show `STALE_HEAD`), `CHECKS_PENDING`/`RED`/`UNKNOWN`/`GREEN_AT_HEAD`, `PROJECTION_STALE`, `CHILD_STATE_CONFLICT` (for example `DONE` on an open issue, or a merged PR where the current gate is not accepted, or only G0 is accepted), and report-only `READY_TO_CLOSE`, `NATIVE_PARENT_UNEXPECTED`, `NATIVE_CHILD_UNKNOWN`, `DEPENDENCY_IMPLIES_PARENT`, `TRACE_STALE` (the comment trace is missing or behind the comments), `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED` (the decision-trace audit), and `PR_UNTRACKED` (an open PR whose body says `Refs`, `Completes`, `Closes`, `Fixes` or `Resolves` `#n` for an open outcome whose state records no PR or branch; the controller confirms and records it with `update`). Native siblings sort like the Programme Graph rows.
5. **Plan** only these effects: create or update a child document, attach a sub-issue, reparent (`replace_parent`), reorder (fewest moves), replace the managed blocks, post an index comment for an overflowing trace. Closing, deleting, merging and detaching never appear. Dependencies never set a parent.
6. **Apply** (only with `--apply`), one effect at a time: write an `IN_FLIGHT` intent into the owning document, mutate, read back (both the child's parent and the parent's list for links; the whole body for blocks), then clear the intent or mark it `UNKNOWN` and hold.
7. **Report** the repository, store and parent revision, findings, effects with outcomes, holds, write counts and one next action. The `READY_TO_CLOSE` close list names open issues whose PR is merged with required checks `GREEN` at its head, with the PR, head, current gate, UAT and review states. `gate_accepted` records whether the current gate is `RETIRED` with its latest return consumed as `ACCEPT`; `accepted` counts completion only for G1 or G2. The controller decides; nothing is closed automatically, and a missing G1-or-later current-gate acceptance still reports `CHILD_STATE_CONFLICT`. A pass with nothing to do says `No changes` and writes nothing.

GitHub details the code relies on (checked against the REST docs and a private sandbox): `sub_issue_id` is the issue's database `id`, not its number; a second parent without `replace_parent` and a duplicate attach both return 422; a reorder needs exactly one of `before_id`/`after_id`; a stale Contents sha returns 409 and a create over an existing file 422.

## Managed blocks

Each catalogued issue body carries two blocks in the Toolkit marker format (`<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `END <NAME>`): `STATE` and `TRACE`.

- **The Programme Graph** is the parent's `STATE` block, under a `## Programme Graph` heading. It replaces the binding's `replace_section` while that section is on the page, else follows its `after_section` (the status section), else sits under the title. One table with the columns `Task | Child # | PR # | Class | Status | Lane | Task Description`:
  - Task is the catalogue `name`, else the issue title without a leading code ("R1 — ") or release ("Toolkit 3.11.0: ").
  - Class is `CORE`, `HARDENING` or `LATER` (`OPTIONAL` shows as `LATER`).
  - Status is `QUEUED` (planned, no open PR), `IN PROGRESS` (active, waiting on the owner, held, or planned with an open PR) or `COMPLETED` (done or retired; a retired task's description starts "Retired:").
  - Lane is the gate the work is in now (`G0`, `G1` or `G2`), `-` otherwise. Task Description is the catalogue's one-line `description`.
  - Rows sort `CORE`, then `HARDENING`, then `LATER`, each by catalogue `order` and issue, then every `COMPLETED` row by completion time with the most recent last. Nested children sort like any other row. Native sub-issues follow the same order.
- **A child's `STATE` block** sits under the title and a marked note directly under it (for example the current-direction note) and shows status, class, lane, release, task description, PR with its head as a 7-character link plus the full SHA as text, CI at the head, UAT, review, next action and blockers, with its document revision.
- **The `TRACE` block** closes every catalogued body, the parent's included: one line per comment on that issue in comment order (`- <date> · <record or comment> · [<summary>](#issuecomment-<id>)`, with `SUPERSEDES=` and `superseded by` where they apply), under a note that the body comes first and, where comments disagree, the latest one wins. When the body would reach the threshold, the whole list moves into one new index comment (marked `<!-- decision-trace-index -->`) and the body keeps a link to it; newer comments are listed directly again until the next overflow. Bot comments are left out.
- A `STATE` block already in place is updated in place; a block above its place (for example at the very top) or a `replace_section` still on the page moves it once, reported as "Move the state block". A hidden line in the parent block lists every child revision, so parent and child can be checked against each other.

Issue `PATCH` has no compare-and-swap, so the pass builds the new body from a fresh read, re-reads just before writing and refuses on change (`BODY_MOVED`, re-planned next pass), changes only the bytes between its markers, proves the whole body read back exactly, and refuses a body that would still reach 60,000 characters with its trace in an index comment (`BODY_TOO_LARGE`). An index comment is posted under an intent and read back; a later pass settles an interrupted one by reading the comments, never by posting again. The renderer reads an allow-list of public fields: never `private`, sessions or routes.

## Decision traces

The programme issue body is the canonical record, and the reconcile pass keeps its `TRACE` block current from the issue's comments, so every non-bot comment is one link away. Records that replace others carry `SUPERSEDES=<record ID>`; the trace marks the replaced record "superseded by".

Audit with `node scripts/decision-trace-audit.cjs --repo <owner/name> --issue <n> --record-prefix <prefix>` (for Toolkit #421: `INT-TK421-`). It fails on any unlinked comment, unknown `SUPERSEDES=` target, a superseded record not marked "superseded by" (in its own comment or on an index line that links it), or a body at the threshold, and lists comments without a record ID. The reconcile pass runs it on every issue whose trace it does not rewrite in that pass and reports `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED`. `--repair --out <file>` writes a proposed body with the missing index lines in the same shape, and `--ledger <file>` (a `toolkit.decision-ledger.v1` file) adds each comment's topic tag after its link; publishing it is a separately authorised write followed by readback and a clean re-audit.

## Review truth

- Inventory the PR's submitted reviews and inline conversations completely (all pages) before classifying findings. An empty, stale, unavailable or incomplete inventory is not green.
- The controller records review verdicts with the reviewer and the exact full head SHA they reviewed (`update --patch` on `review.verdicts`). A verdict at an older head is stale once the PR head moves.
- Classify materiality against the agreed acceptance (ship blocker, Hardening, Later or optional, unsupported or duplicate). A finding is not final because an executor calls it blocking; a disposition needs closing evidence at the exact head and a controller reference.
- An initial nonblocking finding is recorded where the controller keeps deferred findings, with enough public-safe evidence to revalidate it before work on the same component, before that PR's finality and in the final programme sweep. Converge same-root findings instead of opening micro-issues.
- Executors inspect and recommend. They never reply to or resolve threads, dismiss reviews, mark Ready, merge or claim finality; the controller and owner do.

## Safety

- Dry runs and `show` write nothing. `--apply` and the other writing commands change only the bound repository's issue links and managed blocks and the bound store path.
- The reconciler may report a stale PR or issue but never closes, deletes, merges, detaches or removes branches; those stay controller steps with the owner's approval. Removing a sub-issue link by hand is the rollback for a wrong attach.
- No labels, Projects boards, milestones or assignees are changed.
- Never put secrets or tokens anywhere in a state document, `private` included (it lives in the store's git history); secret-shaped values are refused. Keep local paths and session details in `private`, never in public fields.
- Return a compact report: binding, store revision, findings, effects and outcomes, holds and exactly one next action.
