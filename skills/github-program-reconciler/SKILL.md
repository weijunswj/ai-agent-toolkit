---
name: github-program-reconciler
description: Toolkit GitHub tracking for repositories that opted in with .github/toolkit-programme.json - use it on its own at significant events (governance setup; a task (child issue) added, deleted or modified; after a merge; a PR opened or its head moved; an issue closed or reopened; outcomes reordered or reprioritised; a release shipped; a controller appointed or rebinding) to keep private per-child state documents, native sub-issue links, PR heads, required checks, state blocks, decision traces and review records in step. Without the binding it does nothing. Never closes, deletes or merges.
---

# GitHub Program Reconciler

This skill loads on its own (its OpenAI metadata sets `allow_implicit_invocation: true`), but only acts in a repository that has opted into Toolkit GitHub tracking. Check for `.github/toolkit-programme.json` first; without it, stop. Ordinary GitHub reads, coding and reviews do not need it, and loading on its own grants no extra authority: every write still needs the fence and checks below.

**Who uses it.** Toolkit GitHub tracking (issue tracking, parent and child tasks, records, comments and this reconciler) is off by default and opt-in per repository: the owner adds `.github/toolkit-programme.json`, binding the parent issue and the private store, on purpose. It needs GitHub (or a GitHub-like host with repositories and parent/child issues). Every other repository, including ones the owner does not control such as a company or someone else's repository, gets only the coding-governance gates, subagents and portable skills; Toolkit writes no issues, comments or records there, the reconciler refuses to run, and tasks are tracked the way that repository decides.

## When to run

Run a dry-run `reconcile` at these significant events, then use `--apply` within the fences when it plans effects:

- The binding is added (the repository opts into Toolkit GitHub tracking).
- A task (child issue) is added, deleted or modified.
- A merge completes.
- A PR is opened or its head moves.
- An issue is closed or reopened.
- Outcomes are reordered or reprioritised.
- A release ships.
- A controller is appointed or rebinds.

Check for the binding first at each event; without it, do nothing. It never closes, deletes or merges.

## What ships

- `scripts/programme.cjs`: the command line. Run it from a checkout of the governed repository.
- `scripts/programme-state.cjs`: the owners it uses (`GitHubTransport`, `StateStore`, `ProgrammeGraphReader`, `Reconciler`, the renderer and the managed-block helpers).
- `scripts/decision-trace-audit.cjs`: the read-only decision-trace audit.
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
- `store.kind` names the backend. This version ships `github`: a separate repository that exists, is private and is writable, checked before every pass (`STATE_STORE_UNVERIFIED`). Another kind (a different store) is added in code with the same compare-and-swap contract; an unknown kind stops at setup. There is no fallback store.
- `required_checks` adds check names to the ones GitHub marks required. With neither, checks are never `GREEN`. (Toolkit's `main` has no required status checks configured, so its binding names them.)

## State documents

One private JSON document per outcome (`issue-<n>.json`) and one for the parent (`parent-<n>.json`) under the store path.

- **Parent:** fence, release-plan pointer and the **outcome catalogue** (issue, label, class `CORE`/`HARDENING`/`LATER`/`OPTIONAL`/`COMPLETED`/`RETIRED`, expected native parent, order within its class, lane, owner prefix). The catalogue is data: nothing is hard-coded to one programme.
- **Child:** lifecycle, release, gate (role, state, session, route, returns), candidate (full 40-character SHAs), PR (number, state, head, required checks at that head), UAT, review verdicts, blockers, exactly one next action, pending effects and a `private` field that is never rendered.
- Writes use Contents API compare-and-swap on the blob sha with readback. Unchanged state is never written (GitHub would still make an empty commit). The revision moves only when content changes; timestamps and pending effects do not count.
- On a 409 the change is re-applied only when the other writer touched different top-level fields and the fence did not move; otherwise `STATE_CONFLICT` or `STALE_WRITER`.

**Fence.** A document is held by one session and record prefix. A child may be written by its holder or by the parent's holder. `claim --takeover` increments the epoch in one compare-and-swap. A running pass re-reads the parent fence immediately before every state write and every GitHub change, so after a takeover the old pass stops at its next effect (`STALE_WRITER`); an intent it leaves `IN_FLIGHT` is settled by the successor's readback. The fence orders cooperating Toolkit writers under one account; it authenticates nobody and does not stop a person or another tool editing.

**Who records what.** The child's holder (for example the G1 builder) may set release, candidate, blockers, next action, `private`, a non-final lifecycle, and submit a return. Only the parent's holder (the controller) consumes a return, records UAT and review, or sets `DONE` or `RETIRED` (`ROLE_REFUSED` otherwise), so no executor records its own acceptance.

**Returns (LIFE-1).** A gate return is consumed by its return ID, never by session. `REOPEN` puts the gate back to `ACTIVE` in the same session, a new submission takes a new ID, and `ACCEPT` retires the gate. Consuming the same ID again with the same verdict does nothing; a different verdict is `RETURN_CONFLICT`; a return from before a takeover is `STALE_RETURN`.

**Evidence at a head.** UAT `PASSED`, `UAT_RETAINED` and `UAT_PARTIAL_REQUIRED` must carry `at_head` (the full SHA), and a decided review must carry at least one verdict with its head; otherwise the write is refused. Evidence at an older head than the live PR head renders as `STALE_HEAD`.

## Commands

| Command | Writes |
|---|---|
| `reconcile [--issue <n>]` | Nothing: prints findings and the effect plan |
| `reconcile --apply [--issue <n>]` | State documents and GitHub, as planned; needs the parent fence |
| `show [--parent \| --issue <n>] [--include-private]` | Nothing; sessions and `private` are redacted unless asked |
| `init-parent --catalogue <file> [--apply]` | Creates the parent document, held by this session |
| `update-parent --patch <file>` | Catalogue, release plan or `private` (merge patch) |
| `claim (--parent \| --issue <n>) [--role G0\|G1\|G2] [--model <m> --effort <e> [--route-read-back]] [--takeover]` | The fence and gate |
| `update --issue <n> --patch <file>` | Release, candidate, blockers, next action, `private` or a non-final lifecycle; UAT, review and `DONE`/`RETIRED` only from the controller |
| `return --issue <n> (--submit <id> \| --consume <id> --verdict ACCEPT\|REOPEN)` | Gate returns; consuming is the controller's |

Writes need `--session <id>` (or `TOOLKIT_PROGRAMME_SESSION`); the record prefix defaults to the binding's writer prefix. `--json` prints machine-readable output. `reconcile --parent-file <file>` dry-runs a proposed catalogue before `init-parent`. The PR for a child is found from `candidate.branch` and then kept by number.

## The reconcile pass

1. **Bind** repository identity, the store and the binding; read the parent and every catalogued child document.
2. **Observe** (read-only): issues, native parents, each expected parent's sub-issues in order, `blocked_by` edges, and for each child PR its head and required checks at that head.
3. **Recover first:** each pending effect from an earlier pass is settled by reading its target. Done or not done leaves the document; an unreadable target stays `UNKNOWN` and holds that target. Nothing is replayed without that read.
4. **Diff** into findings: `NATIVE_PARENT_MISSING`, `NATIVE_PARENT_WRONG`, `NATIVE_ORDER_DRIFT`, `PR_HEAD_MOVED` (review and UAT at the old head show `STALE_HEAD`), `CHECKS_PENDING`/`RED`/`UNKNOWN`/`GREEN_AT_HEAD`, `PROJECTION_STALE`, `CHILD_STATE_CONFLICT` (for example `DONE` on an open issue, or a merged PR with no accepted return), and report-only `READY_TO_CLOSE`, `NATIVE_PARENT_UNEXPECTED`, `NATIVE_CHILD_UNKNOWN`, `DEPENDENCY_IMPLIES_PARENT`. Outcomes sort by class (`CORE`, `HARDENING`, `LATER`, `OPTIONAL`, `COMPLETED`, `RETIRED`), then by `order` within the class, then issue number, for both native siblings and rendered siblings (including nested children and the parentless tail).
5. **Plan** only these effects: create or update a child document, attach a sub-issue, reparent (`replace_parent`), reorder (fewest moves), replace a managed block. Closing, deleting, merging and detaching never appear. Dependencies never set a parent.
6. **Apply** (only with `--apply`), one effect at a time: write an `IN_FLIGHT` intent into the owning document, mutate, read back (both the child's parent and the parent's list for links; the whole body for blocks), then clear the intent or mark it `UNKNOWN` and hold.
7. **Report** the repository, store and parent revision, findings, effects with outcomes, holds, write counts and one next action. The `READY_TO_CLOSE` close list names open issues whose PR is merged with required checks `GREEN` at its head, with the PR, head and whether an accepted return is recorded. The controller decides; nothing is closed automatically, and a missing accepted return still reports `CHILD_STATE_CONFLICT`. A pass with nothing to do says `No changes` and writes nothing.

GitHub details the code relies on (checked against the REST docs and a private sandbox): `sub_issue_id` is the issue's database `id`, not its number; a second parent without `replace_parent` and a duplicate attach both return 422; a reorder needs exactly one of `before_id`/`after_id`; a stale Contents sha returns 409 and a create over an existing file 422.

## Managed blocks

Each catalogued issue body gets one block in the Toolkit marker format (`<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=<version> sha256=<12 hex> -->` ... `END STATE`), inserted at the top the first time:

- the parent block is the generated outcome table (tree order, gate, PR, head as a 7-character link plus the full SHA as text, CI at head, UAT, next action); the controller's prose and the decision index stay hand-written outside it;
- each child block shows that child's state and its document revision;
- a hidden line in the parent block lists every child revision, so parent and child can be checked against each other.

Issue `PATCH` has no compare-and-swap, so the pass builds the new body from a fresh read, re-reads just before writing and refuses on change (`BODY_MOVED`, re-planned next pass), changes only the bytes between its markers, proves the whole body read back exactly, and refuses a body that would reach 60,000 characters (`BODY_TOO_LARGE`, the decision-trace threshold). The renderer reads an allow-list of public fields: never `private`, sessions or routes.

## Decision traces

The programme issue body is the canonical record: every non-bot comment must be linked from the body's collapsed decision index by fragment link (`#issuecomment-<id>`), directly or through an index comment the body links (one hop). Records that replace others carry `SUPERSEDES=<record ID>`. Keep the body under 60,000 characters (GitHub's limit is 65,536) by moving older index lines into an index comment marked `<!-- decision-trace-index -->`.

Audit with `node scripts/decision-trace-audit.cjs --repo <owner/name> --issue <n> --record-prefix <prefix>` (for Toolkit #421: `INT-TK421-`). It fails on any unlinked comment, unknown `SUPERSEDES=` target or a body at the threshold, and lists comments without a record ID. `--repair --out <file>` writes a proposed body with the missing index lines; publishing it is a separately authorised write followed by readback and a clean re-audit.

## Review truth

- Inventory the PR's submitted reviews and inline conversations completely (all pages) before classifying findings. An empty, stale, unavailable or incomplete inventory is not green.
- Record review verdicts with the reviewer and the exact full head SHA they reviewed (`update --patch` on `review.verdicts`). A verdict at an older head is stale once the PR head moves.
- Classify materiality against the agreed acceptance (ship blocker, Hardening, Later or optional, unsupported or duplicate). A finding is not final because an executor calls it blocking; a disposition needs closing evidence at the exact head and a controller reference.
- An initial nonblocking finding is recorded where the controller keeps deferred findings, with enough public-safe evidence to revalidate it before work on the same component, before that PR's finality and in the final programme sweep. Converge same-root findings instead of opening micro-issues.
- Executors inspect and recommend. They never reply to or resolve threads, dismiss reviews, mark Ready, merge or claim finality; the controller and owner do.

## Safety

- Dry runs and `show` write nothing. `--apply` and the other writing commands change only the bound repository's issue links and managed blocks and the bound store path.
- The reconciler may report a stale PR or issue but never closes, deletes, merges, detaches or removes branches; those stay controller steps with the owner's approval. Removing a sub-issue link by hand is the rollback for a wrong attach.
- No labels, Projects boards, milestones or assignees are changed.
- Never put secrets or tokens anywhere in a state document, `private` included (it lives in the store's git history); secret-shaped values are refused. Keep local paths and session details in `private`, never in public fields.
- Return a compact report: binding, store revision, findings, effects and outcomes, holds and exactly one next action.
