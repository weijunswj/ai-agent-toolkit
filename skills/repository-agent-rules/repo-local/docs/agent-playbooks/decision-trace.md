# Decision Trace Playbook

Use this before G0 plans a programme child, when governance is first enabled on a repository with a programme, and when writing a decision comment on a programme issue.

## Why

Decisions pile up in issue comments, and old ones get replaced without anyone saying so. If G0 plans from the newest comment it happens to see, it builds an outdated spec. The comment trace on each issue body is the ledger, so G0 reads that instead of crawling every comment, and the owner confirms what is still live before it becomes the spec.

## Writing a decision comment

- Start the comment with its topic on the first line, then a line with only `---`, then the comment:

  ```text
  Codex host support
  ---
  The installer now writes the helper agents itself.
  ```

- The topic is the task's name exactly as the Programme Graph shows it. A comment about the whole programme, such as a rule for every repository, gets a short subject instead, for example `Plain-text check`. Never use a category such as `RELEASE` or `BACKLOG`: comments about different things would then land on one line and seem to replace each other.
- A topic is up to 80 letters, digits, spaces and simple punctuation, compared in upper case. Reuse the exact topic already on that issue, so the new comment joins its line. On a task page, a comment without a topic already falls under the task's name.
- Within one topic the latest comment wins where comments disagree. To replace a record, add `SUPERSEDES=<record ID>`; the trace marks the old one "replaced by".
- A comment without a tag goes under "Other comments". It still counts, but nothing infers what it replaces.
- Post on the issue the decision belongs to: programme-wide on the parent, task-level on the child. The parent's and a child's traces never mix.

## G0 reads before planning

1. Read only the child being planned, never every child. Run the read-only decision history for it:

   ```text
   node <toolkit>/skills/github-program-reconciler/scripts/decision-history.cjs --repo <owner/name> --child <n> --edits
   ```

   It reads the parent's and the child's comments separately, takes the latest comment per tag as live, marks earlier ones replaced (explicit, inferred, or confirmed by the owner), and lists untagged comments, untagged records, and untagged comments that name a tag after its latest decision. Long lists end with a count; `--full` lists everything.
2. Open the live comments and the uncertain ones. Skip replaced ones unless a live comment depends on them. Read the child's body and, when the history reports body revisions that matter, its edit history.
3. If the trace is missing or incomplete (the reconciler's audit fails for that issue), read the child's comments directly, report the gap to the controller, and say how many comments were read. Never skip a long history silently.
4. Show the owner a live-scope summary of at most 15 lines: the live decisions per tag, the inferred replacements, the uncertain comments, and anything that looks outdated.
5. The summary becomes the spec only after the owner confirms it. The controller then posts a comment tagged `SCOPE-CONFIRMED` on the child. Each correction is its own tagged comment, so it wins as the latest in its tag.

## When governance is first enabled

The first reconcile pass writes every catalogued issue's comment trace from all of its comments. That is the backfill, and later passes keep it current. Older comments without tags all go under "Other comments".

Then run the decision history once for the whole programme, `--programme` instead of `--child <n>`. It reports how many comments each issue has and the parent's live decisions. Show the owner that report before any of it is used. An existing full crawl in the `toolkit.decision-ledger.v1` format can be read with `--ledger <file>` instead of reading GitHub again.

## Never

- Treat an inferred replacement or a backfill result as the spec before the owner confirms it.
- Edit or delete someone else's comment to change the trace. Post a new tagged comment instead. Changing only the topic line of your own comment is fine.
- Combine two tags into one list, or mix the parent's trace with a child's.
