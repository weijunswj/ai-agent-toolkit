---
name: github-program-reconciler
description: Keep a programme's parent issue, child issues, pull request status and decision history in step on github.com, only where .github/toolkit-programme.json exists and the user has turned Toolkit's GitHub governance on. Use at big moments: the programme file is added, a child issue changes, a pull request opens, moves or merges, an issue closes or reopens, the order changes, a release ships or the controller changes. Any session may run the preview (dry run) and report it. Only the appointed controller writes programme state: it holds the parent document and runs every writing command itself, including handing out work, returns, user testing, review and completion. A planning, build or review session it assigns (G0, G1 or G2) writes only its own checkpoint journal; helpers never write. Every programme.cjs command refuses without the programme file or while governance is off; the file does not change governed issue records. Never closes, deletes or merges.
---

# GitHub Program Reconciler

This skill loads on its own (its OpenAI metadata sets `allow_implicit_invocation: true`). The reconciler, its state documents, managed blocks and sub-issue links act only where `.github/toolkit-programme.json` exists and the repository's GitHub governance is ENABLED; every `programme.cjs` command refuses otherwise (DISABLED covers plain folders and repositories not on github.com). Ordinary GitHub reads, coding, reviews and the separate read-only decision-trace audit do not need that binding. Loading on its own grants no extra authority: every write still needs the fence and checks below.

**Who uses it.** The owner opts into the reconciler by adding `.github/toolkit-programme.json`, binding the parent issue and its private state store. The reconciler supports github.com only, and its state store supports `kind: github` only. The binding does not change the Toolkit-governed rules (the `TOOLKIT-GOVERNED-RULES` block in `AGENTS.md`) or their issue records. Company or third-party repositories without that block get no governed issue writes, only the coding-governance gates, subagents and portable skills; global rules still apply, including PRs after requested edits and task issues when the user asks to add one.

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

## Refresh after every write (required)

The programme pages stay current without any token: the session that changed GitHub brings them up to date with its own `gh` sign-in, and an hourly sweep catches everything else.

- **After any write in a governed repository** (an issue or comment created, edited, closed or reopened, a sub-issue link, a PR opened, edited, reviewed or merged, or a push that moves a PR head), run `node scripts/programme.cjs refresh` from its checkout before ending the turn. Any session may, executors included: `refresh` is the full `reconcile --apply` pass written under the controller that holds the parent now, and it takes no session, patch or verdict, so it records nothing that is a decision.
- **The plugin hook does this for you** in Claude Code and Codex: the after-tool hook marks the session after a GitHub write, and the turn-end hook starts `refresh` in the background once for each governed repository the session wrote for. Its output is appended to a `last-run-<checkout key>.log` file in `~/.ai-agent-toolkit/user-state/programme-refresh/`, one per checkout. Do not also run it by hand when the hook is installed.
- **Where it cannot run** (no plugin hooks, `gh` not signed in, as in cloud containers and Projects threads, which write through the GitHub connector, or no checkout of the repository on that computer, or governance not yet decided there), do nothing extra: the hourly sweep brings the pages up to date within the hour. If the owner is waiting on the page, say it updates at the next sweep.
- **The hourly sweep** runs `refresh` where `gh` is signed in: the Projects hourly nudge's programme step, or the programme sweep task on a computer that has the sign-in. It also catches the owner's own edits on the web, which reach no session.
- One pass per repository runs at a time on a computer. When another pass holds the lock, `refresh` leaves a flag and ends at once, and the running pass runs once more before it lets go; if that pass fails or a long burst reaches its limit of five passes, the next refresh or the hourly sweep picks the change up. `reconcile --apply` refuses instead (`PASS_RUNNING`). The lock is taken over only when its owner's process has ended, its last beat is from before the computer last started, or it has been silent for 6 hours (a killed pass whose process id was reused); a lock from another computer sharing the profile is taken after 15 silent minutes. A pass that loses its lock stops before its next GitHub request. `refresh` refuses when no controller holds the parent (`PARENT_UNHELD`).

## What ships

- `scripts/programme.cjs`: the command line. Run it from a checkout of the governed repository.
- `scripts/programme-state.cjs`: the owners it uses (`GitHubTransport`, `StateStore`, `ProgrammeGraphReader`, `Reconciler`, the renderer and the managed-block helpers).
- `scripts/programme-checkpoint.cjs`: executor checkpoint journals, used by `bind`, `checkpoint` and the plugins' turn-end hook (`repo/scripts/toolkit-programme-checkpoint-hook.cjs`).
- `scripts/programme-refresh-trigger.cjs`: the after-write refresh, run by the same hook script on the after-tool and turn-end events.
- `scripts/decision-trace-audit.cjs`: the read-only decision-trace audit.
- `scripts/decision-tags.cjs`: the one comment-tag parser (pure, no reads or writes).
- `scripts/decision-history.cjs`: the read-only decision history G0 runs before planning a child.
- `scripts/resolve-executable.cjs`: shared executable resolution and its error type; `programme-state.cjs` keeps the public exports.
- The document and journal schemas live in the Toolkit repository under `repo/contracts/programme-state/`; `repo/docs/HOST-CONTRACT.md` says what each host provides.

Everything runs through `gh` (resolved to a full `.exe` path, never from the working folder) as the signed-in account; no token or secret is stored anywhere. A pass runs when someone asks for it, after each GitHub write (see "Refresh after every write") and from the hourly sweep. There is no other scheduler or background loop.

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

One private JSON document per outcome (`issue-<n>.json`) and one for the parent (`parent-<n>.json`) under the store path, plus executor journals under `journal/issue-<n>/`.

- **Parent:** fence, release-plan pointer and the **outcome catalogue** (issue, label, class `COMMITTED`/`OPTIONAL`/`COMPLETED`/`RETIRED`, expected native parent, order within its graph group, lane, owner prefix, and an optional task `name` and one-line `description` for the Programme Graph). Now, Next and Later are never stored: they come from each task's PR and release. The catalogue is data: nothing is hard-coded to one programme.
- **Child:** lifecycle, completion time (`completed_at`), release, gate (role, state, assignment, session, route, returns), candidate (full 40-character SHAs), PR (number, state, head, required checks at that head), UAT, review verdicts, blockers, exactly one next action, pending effects and a `private` field that is never rendered.
- Writes use Contents API compare-and-swap on the blob sha with readback. Unchanged state is never written (GitHub would still make an empty commit). The revision moves only when content changes; timestamps and pending effects do not count.
- On a 409 the change is re-applied only when the other writer touched different top-level fields and the fence did not move; otherwise `STATE_CONFLICT` or `STALE_WRITER`.

**Fence.** A document is held by one session and record prefix. Every write comes from the session that holds the parent document. `claim --takeover` increments the epoch in one compare-and-swap. A running pass re-reads the parent fence immediately before every state write and every GitHub change, so after a takeover the old pass stops at its next effect (`STALE_WRITER`); an intent it leaves `IN_FLIGHT` is settled by the successor's readback. The fence orders cooperating Toolkit writers under one account; it authenticates nobody and does not stop a person or another tool editing.

**Who records what.** Only the appointed controller writes programme state. Give the controller a stable writer name (for example `toolkit-421-controller`) and pass it as `--session`: coordinator sessions are replaced from time to time, and a fence held by one session would need a takeover after every replacement. Every coordinator, and every `refresh`, then writes under that one name; a different controller takes over on purpose with its own name. The controller creates the parent document (`init-parent --apply`) and holds it, and runs every writing command with `--controller`: `reconcile --apply`, `update-parent`, `claim`, `assign`, `reopen`, `interrupt`, `update` and `return`. It assigns each gate (`assign --issue <n> --role <gate> --assignment <id>`), records and consumes returns, records UAT and G2 review verdicts, and sets `DONE` or `RETIRED`. Without `--controller` a writing command is refused before it reads anything, and with it a session that does not hold the parent is refused by the fence. An executor the controller assigned (G0, G1 or G2) writes only its own checkpoint journal (see "Executor checkpoints"); helpers never write; every other session runs only the dry-run `reconcile` and `show` and reports to the controller. The one exception for all of them is `refresh` after their own GitHub writes, which decides nothing (see "Refresh after every write"). A lane controller the catalogue delegates a child to (`owner_prefix`) may hold that child with `claim --issue <n> --lane` and only `assign` and `interrupt` it. A controller stopped by a takeover stops and reports to the owner; only a controller appointed after that takeover verifies that the previous writer stopped, posts its takeover record on the parent issue, then runs `claim --parent --takeover --takeover-record <comment id> --controller`. The tool reads that comment back: on the parent issue, from the same account, with a decision ID carrying the writer prefix, naming the current epoch and posted after the last state write (`TAKEOVER_UNVERIFIED` otherwise). The replaced holder is refused from then on.

**Gates.** `NONE` → `ASSIGNED` (assigned, no journal yet) → `ACTIVE` (the assignment's journal seen) → `SUBMITTED` (a return captured) → `ACTIVE` again (`REOPEN`), `WAITING_OWNER`, or `RETIRED` (`ACCEPT`). `interrupt` marks a live gate `INTERRUPTED`. `assign` is refused while a gate is live (`ASSIGNMENT_LIVE`) unless `--supersede --reason`, and an assignment ID is never reused. `reopen --reason` puts `SUBMITTED` or `WAITING_OWNER` back to `ACTIVE`, and a `RETIRED` gate back to `ASSIGNED` under a new `--assignment`, which removes its acceptance.

**Returns.** A gate return is consumed by its return ID, never by session. The controller records a return reported in a thread or chat with `return --record <id> --assignment <id>`; reconcile captures one from a journal. `REOPEN` puts the gate back to `ACTIVE` with the same assignment, and the next return takes a new ID; `ACCEPT` retires the gate. A G1 `ACCEPT` needs a G2 review `PASSED` at the live PR head (`EVIDENCE_STALE` otherwise). Consuming the same ID again with the same verdict does nothing; a different verdict is `RETURN_CONFLICT`; a return from before a takeover is `STALE_RETURN`; one for another assignment is `STALE_ASSIGNMENT`.

**Executor checkpoints.** The controller tells the executor its issue and assignment. The executor reads its model and effort from session metadata, then runs `bind --issue <n> --assignment <id> --session <its own session ID> [--model <m> --effort <e> --route-read-back]` once (Claude Code: `CLAUDE_CODE_SESSION_ID`). That writes its journal, `journal/issue-<n>/<assignment>--<session hash>.json`, and a local binding under the user's `.ai-agent-toolkit/user-state/programme-sessions/`. After each turn the plugin's turn-end hook refreshes the journal with the branch, head, tree, dirty flag, ahead and behind, and the last fenced `toolkit-return` block in the final message (`return_id`, `verdict_requested` `ACCEPT` or `WAITING_OWNER`, `at_head`, `next_action`, `blockers` separated by `;`). `checkpoint --session <id>` does the same by hand, and `show --session <id>` lists the local binding and recorded errors. The hook never blocks a turn, prints nothing, returns at once for a session that has not bound, and writes nothing when nothing changed. A journal is evidence, not state: nothing changes until the controller's reconcile reads it. Where binding is not available (Codex today, cloud sessions and Projects threads), the executor reports in its thread and the controller uses `return --record`.

**Evidence at a head.** UAT `PASSED`, `UAT_RETAINED` and `UAT_PARTIAL_REQUIRED` must carry `at_head` (the full SHA), and a decided review must carry at least one verdict with its head; otherwise the write is refused. Evidence at an older head than the live PR head renders as `STALE_HEAD`.

## Commands

| Command | Writes |
|---|---|
| `reconcile [--issue <n>]` | Nothing: prints findings and the effect plan |
| `reconcile --apply [--issue <n>]` | State documents and GitHub, as planned; controller only |
| `refresh` | The same full pass, under the parent's current holder; any session in a governed checkout |
| `show [--parent \| --issue <n>] [--include-private]` | Nothing; sessions and `private` are redacted unless asked |
| `init-parent --catalogue <file> [--apply]` | Without `--apply`, nothing (validates the catalogue). Only the appointed controller runs `init-parent --apply`, which creates the parent document held by that controller |
| `update-parent --patch <file>` | Catalogue, release plan or `private` (merge patch); controller only |
| `claim (--parent \| --issue <n> --lane) [--takeover --takeover-record <comment id>]` | The fence; controller (or a lane controller for its delegated child) only |
| `assign --issue <n> --role G0\|G1\|G2 --assignment <id> [--supersede --reason <text>]` | The gate assignment; controller or lane controller |
| `reopen --issue <n> --reason <text> [--assignment <id>]`, `interrupt --issue <n> --reason <text>` | The gate state; `interrupt` also by a lane controller |
| `update --issue <n> --patch <file>` | Lifecycle, release, candidate, UAT, review, blockers, next action or `private`; controller only |
| `return --issue <n> (--record <id> --assignment <id> [--at-head <sha>] \| --consume <id> --verdict ACCEPT\|REOPEN\|WAITING_OWNER)` | Gate returns; controller only |
| `bind --issue <n> --assignment <id> --session <id> [--model <m> --effort <e> [--route-read-back]]` | The executor's own journal and local binding; never `--controller` |
| `checkpoint --session <id> [--message-file <file>]` | The bound executor's own journal |

Every state write needs `--controller` and `--session <id>` (an environment variable never supplies a session, and a blank value is refused), and every state write except `init-parent --apply` and a parent takeover needs that session to hold the parent document (or, for a lane controller, its delegated child); the record prefix defaults to the binding's writer prefix. Every `--issue` is 1 or more. `--json` prints machine-readable output. `reconcile --parent-file <file>` dry-runs a proposed catalogue before `init-parent`. The PR for a child is found from `candidate.branch` and then kept by number.

## The reconcile pass

1. **Bind** repository identity, the store and the binding; read the parent and every catalogued child document.
2. **Observe** (read-only): issues, native parents, each expected parent's sub-issues in order, `blocked_by` edges, and for each child PR its head and required checks at that head.
3. **Recover first:** each pending effect from an earlier pass is settled by reading its target. Done or not done leaves the document; an unreadable target stays `UNKNOWN` and holds that target. Nothing is replayed without that read.
4. **Diff** into findings: `NATIVE_PARENT_MISSING`, `NATIVE_PARENT_WRONG`, `NATIVE_ORDER_DRIFT`, `PR_HEAD_MOVED` (review and UAT at the old head show `STALE_HEAD`), `CHECKS_PENDING`/`RED`/`UNKNOWN`/`GREEN_AT_HEAD`, `PROJECTION_STALE`, `CHILD_STATE_CONFLICT` (for example `DONE` on an open issue, or a merged PR where the current gate is not accepted, or only G0 is accepted), and report-only `READY_TO_CLOSE`, `NATIVE_PARENT_UNEXPECTED`, `NATIVE_CHILD_UNKNOWN`, `DEPENDENCY_IMPLIES_PARENT`, `TRACE_STALE` (the comment trace is missing or behind the comments), `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED` (the decision-trace audit), and `PR_UNTRACKED` (an open PR whose body says `Refs`, `Completes`, `Closes`, `Fixes` or `Resolves` `#n` for an open outcome whose state records no PR or branch; the controller confirms and records it with `update`). `CLASS_LEGACY` (report-only) names catalogue entries still using the older classes `CORE`, `HARDENING` or `LATER`. Until they are migrated they read as `COMMITTED` and sort in their old CORE, HARDENING, LATER sequence (their `order` counted within one old class), so a reconcile or `--apply` before the migration moves nothing. The finding carries a `patch` (see `reconcile --json`): apply it whole with `update-parent`; it sets `COMMITTED` and renumbers every open entry's `order` in that sequence, so the migration moves no task either. No write adds an older class (`PATCH_REFUSED`), and `init-parent` refuses them. Native siblings sort like the Programme Graph rows.
5. **Plan** only these effects: create or update a child document, attach a sub-issue, reparent (`replace_parent`), reorder (fewest moves), replace the managed blocks, post an index comment for an overflowing trace. Closing, deleting, merging and detaching never appear. Dependencies never set a parent.
6. **Apply** (only with `--apply`), one effect at a time: write an `IN_FLIGHT` intent into the owning document, mutate, read back (both the child's parent and the parent's list for links; the whole body for blocks), then clear the intent or mark it `UNKNOWN` and hold.
7. **Report** the repository, store and parent revision, findings, effects with outcomes, holds, write counts and one next action. The `READY_TO_CLOSE` close list names open issues whose PR is merged with required checks `GREEN` at its head, with the PR, head, current gate, UAT and review states. `gate_accepted` records whether the current gate is `RETIRED` with its latest return consumed as `ACCEPT`; `accepted` counts completion only for G1 or G2. The controller decides; nothing is closed automatically, and a missing G1-or-later current-gate acceptance still reports `CHILD_STATE_CONFLICT`. A pass with nothing to do says `No changes` and writes nothing.

GitHub details the code relies on (checked against the REST docs and a private sandbox): `sub_issue_id` is the issue's database `id`, not its number; a second parent without `replace_parent` and a duplicate attach both return 422; a reorder needs exactly one of `before_id`/`after_id`; a stale Contents sha returns 409 and a create over an existing file 422.

## Managed blocks

Each catalogued issue body carries blocks in the Toolkit marker format (`<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `END <NAME>`): `STATE` and `TRACE` on every page, `CURRENT` on the parent, and `NAV` on task pages and their open or draft PRs.

- **The Programme Graph** is the parent's `STATE` block, under a `## Programme Graph` heading. It replaces the binding's `replace_section` while that section is on the page, else follows its `after_section` (the status section), else sits under the title. One table with the columns `Task | Child # | PR # | Class | Status | Lane | Task Description`:
  - Task is the catalogue `name`, else the issue title without a leading short code and dash or a leading "Toolkit <version>:".
  - Class is worked out, never stored: `NOW` when the task is in progress (an open or draft PR, or active, waiting on the owner or held), `NEXT` when it is queued with a planned release (by convention a name, not a version number), else `LATER`, or `OPTIONAL` for an optional task. A finished row shows `-`.
  - Status is `QUEUED` (planned, no open PR), `IN PROGRESS` (active, waiting on the owner, held, or planned with an open PR), `COMPLETED` (done) or `RETIRED`.
  - Lane is the gate the work is in now (`G0`, `G1` or `G2`), `-` otherwise. Task Description is the catalogue's one-line `description`.
  - Rows sort `NOW`, `NEXT`, `LATER`, then `OPTIONAL`, each by catalogue `order` and issue, then every `COMPLETED` row and then every `RETIRED` row, each by completion time with the most recent last. Nested children sort like any other row. Native sub-issues follow the same order.
- **A child's `STATE` block** sits under the title and a marked note directly under it (for example the current-direction note) and shows status, class, lane, release, task description, PR with its head as a 7-character link plus the full SHA as text, CI at the head, UAT, review, next action and blockers, with its document revision.
- **The `CURRENT` block** opens the parent's status section (the binding's `after_section`) with a generated summary from the same state as the graph: **In progress** (task, gate, PR and next action), **Waiting on you** (an owner decision, a UAT, or a blocker) and **Queued** (the first five queued tasks in graph order). Hand-written notes follow it and are never changed.
- **The `NAV` block** opens every task page and every open or draft PR for a task: `**Path:** #<parent> > #<expected parents> > #<task> > PR #<pr>`. A merged or closed PR is not edited.
- **The `TRACE` block** closes every catalogued body, the parent's included, and lists only that issue's own comments: the parent's list and a task's list never mix, and a controller working on a task reads both. A comment's tag is its first line when its second line is exactly `---` (for example `DATA-LEAK-FIX-122`); untagged comments go under "Other comments". Each tag is its own list, in first-seen order with "Other comments" last, one line per comment (`- <date> · <record or comment> · [<summary>](#issuecomment-<id>)`, with `SUPERSEDES=` and `superseded by` where they apply), under a note that the body comes first and, within a tag, where comments disagree the latest one wins. When the body would reach the threshold, tag lists move out largest first, each whole list into its own new index comment (which carries the tag on its first line), and the body keeps a link in that tag's list; newer comments are listed directly again until the next overflow. Tags are never combined. Bot comments are left out.
- A `STATE` block already in place is updated in place; a block above its place (for example at the very top) or a `replace_section` still on the page moves it once, reported as "Move the state block". A hidden line in the parent block lists every child revision, so parent and child can be checked against each other.

Issue `PATCH` has no compare-and-swap, so the pass builds the new body from a fresh read, re-reads just before writing and refuses on change (`BODY_MOVED`, re-planned next pass), changes only the bytes between its markers, proves the whole body read back exactly, and refuses a body that would still reach 60,000 characters with its trace in an index comment (`BODY_TOO_LARGE`). An index comment is posted under an intent and read back; a later pass settles an interrupted one by reading the comments, never by posting again. The renderer reads an allow-list of public fields: never `private`, sessions or routes.

## Decision traces

The programme issue body is the canonical record, and the reconcile pass keeps its `TRACE` block current from the issue's comments, so every non-bot comment is one link away. Only decision comments (a tag on the first line, or a record ID) must be: an owner decision that changes scope, authority or the plan is recorded as one, and other comments need no index entry. Records that replace others carry `SUPERSEDES=<record ID>`; the trace marks the replaced record "superseded by".

Audit with `node scripts/decision-trace-audit.cjs --repo <owner/name> --issue <n> --record-prefix <prefix>` (for Toolkit #421: `INT-TK421-`). It fails on any unlinked decision comment, unknown `SUPERSEDES=` target, a superseded record not marked "superseded by" (in its own comment or on an index line that links it), or a body at the threshold, and lists other unlinked comments and comments without a record ID without failing. The reconcile pass runs it on every issue whose trace it does not rewrite in that pass and reports `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED`. `--repair --out <file>` writes a proposed body with the missing index lines in the same shape, and `--ledger <file>` (a `toolkit.decision-ledger.v1` file) adds each comment's topic tag after its link; publishing it is a separately authorised write followed by readback and a clean re-audit.

## Review truth

- Inventory the PR's submitted reviews and inline conversations completely (all pages) before classifying findings. An empty, stale, unavailable or incomplete inventory is not green.
- The controller records review verdicts with the reviewer and the exact full head SHA they reviewed (`update --patch` on `review.verdicts`). A verdict at an older head is stale once the PR head moves.
- Classify materiality against the agreed acceptance (ship blocker, follow-up, Later or optional, unsupported or duplicate; a follow-up joins an existing or new catalogued outcome, whose release makes it Next or Later). A finding is not final because an executor calls it blocking; a disposition needs closing evidence at the exact head and a controller reference.
- An initial nonblocking finding is recorded where the controller keeps deferred findings, with enough public-safe evidence to revalidate it before work on the same component, before that PR's finality and in the final programme sweep. Converge same-root findings instead of opening micro-issues.
- Executors inspect and recommend. They never reply to or resolve threads, dismiss reviews, mark Ready, merge or claim finality; the controller and owner do.

## Safety

- Dry runs and `show` write nothing. `--apply`, `refresh` and the other writing commands change only the bound repository's issue links and managed blocks and the bound store path.
- The reconciler may report a stale PR or issue but never closes, deletes, merges, detaches or removes branches; those stay controller steps with the owner's approval. Removing a sub-issue link by hand is the rollback for a wrong attach.
- No labels, Projects boards, milestones or assignees are changed.
- Never put secrets or tokens anywhere in a state document, `private` included (it lives in the store's git history); secret-shaped values are refused. Keep local paths and session details in `private`, never in public fields.
- Return a compact report: binding, store revision, findings, effects and outcomes, holds and exactly one next action.

## Decision history

A decision comment starts with its tag on the first line and a `---` line after it. `scripts/decision-tags.cjs` is the only parser: the tag is 1-80 letters, digits, dots, underscores or hyphens, compared in upper case, with CRLF and leading blank lines accepted. A comment without one belongs to "Other comments". Each tag is its own list, and within a tag the latest comment wins.

Before planning a child, G0 runs `node scripts/decision-history.cjs --repo <owner/name> --child <n> [--edits]`. The parent and the record prefix come from the binding, or from `--parent` and `--record-prefix`. It is read-only and needs no fence: it reads the parent's and the child's comments separately and never mixes them. It takes the latest comment per tag as live. A record named by an explicit `SUPERSEDES=` anywhere in the two traces is replaced outright. Earlier comments in a tag are replaced by inference, or confirmed once a later comment tagged `SCOPE-CONFIRMED` exists on that issue. It also lists untagged comments, untagged records, and untagged comments that name a tag after its latest decision. It prints a live-scope summary: lists are capped with a count (`--max`, `--full` lists everything), `--json` gives the structure, and `--edits` adds the child body's revision count through GraphQL, or says it could not read it. The summary becomes the spec only after the owner confirms it; see the decision-trace playbook (`skills/repository-agent-rules/repo-local/docs/agent-playbooks/decision-trace.md`).

`--programme` reads the parent and every sub-issue once, for the report shown to the owner when governance is first enabled; G0 never uses it. `--ledger <file>` reads a `toolkit.decision-ledger.v1` crawl instead of GitHub. Its entries are untagged, its keyword topics are only hints, and issues it does not hold are reported as not read.
