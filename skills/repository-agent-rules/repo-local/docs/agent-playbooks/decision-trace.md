# Decision Trace Playbook

Use this before G0 plans a programme child, when governance is first enabled on a repository with a programme, and when writing a decision comment on a programme issue.

## Why

Decisions pile up in issue comments, and old ones get replaced without anyone saying so. If G0 plans from the newest comment it happens to see, it builds an outdated spec. The decision records are the tagged comments on each issue; the trace command lists them by topic with the latest per topic live, and the owner confirms what is still live before it becomes the spec. Page bodies carry no trace: each keeps a short DECISIONS block with one link, to the issue's newest tagged comment.

## Writing a decision comment

- Start the comment with its topic on the first line, then a line with only `---`, then the comment:

  ```text
  Codex host support
  ---
  The installer now writes the helper agents itself.
  ```

- The topic is the task's name exactly as the Programme Graph shows it. A comment about the whole programme, such as a rule for every repository, gets a short subject instead, for example `Plain-text check`. Never use a category such as `RELEASE` or `BACKLOG`: comments about different things would then land on one line and seem to replace each other.
- A topic is up to 80 letters, digits, spaces and simple punctuation, compared in upper case. Reuse the exact topic already on that issue, so the new comment joins its line. On a task page, a comment without a topic already falls under the task's name.
- Within one topic the latest comment wins where comments disagree. To replace a record, add `SUPERSEDES=<record ID>`; the trace command lists the old one as replaced.
- A comment without a tag goes under "Other comments". It still counts, but nothing infers what it replaces.
- Post on the issue the decision belongs to: programme-wide on the parent, task-level on the child. The parent's and a child's traces never mix.

## G0 reads before planning

1. Read only the child being planned, never every child. List its decisions with the reconciler, from a checkout of the repository:

   ```text
   node <toolkit>/skills/github-program-reconciler/scripts/programme.cjs trace <n> --edits
   ```

   It runs the read-only decision history (the same as `decision-history.cjs --repo <owner/name> --child <n>`). It reads the parent's and the child's comments separately, takes the latest comment per tag as live, marks earlier ones replaced (explicit, inferred, or confirmed by the owner), and lists untagged comments, untagged records, and untagged comments that name a tag after its latest decision. Long lists end with a count; `--full` lists everything.
2. Open the live comments and the uncertain ones. Skip replaced ones unless a live comment depends on them. Read the child's body and, when the history reports body revisions that matter, its edit history. Index and directory comments an older Toolkit posted (they carry `<!-- decision-trace-index -->`) are skipped: the history reads the original comments.
3. If the history cannot read an issue's comments, read them directly, report the gap to the controller, and say how many comments were read. Never skip a long history silently.
4. Show the owner a live-scope summary of at most 15 lines: the live decisions per tag, the inferred replacements, the uncertain comments, and anything that looks outdated.
5. The summary becomes the spec only after the owner confirms it. The controller then posts a comment tagged `SCOPE-CONFIRMED` on the child. Each correction is its own tagged comment, so it wins as the latest in its tag.

## When governance is first enabled

The first reconcile pass writes each catalogued issue's DECISIONS block; no decision list goes into a body. Older comments without tags all go under "Other comments" in the history.

Then run `decision-history.cjs` once for the whole programme, with `--programme` instead of `--child <n>`. It reports how many comments each issue has and the parent's live decisions. Show the owner that report before any of it is used. An existing full crawl in the `toolkit.decision-ledger.v1` format can be read with `--ledger <file>` instead of reading GitHub again.

## Never

- Treat an inferred replacement or a backfill result as the spec before the owner confirms it.
- Edit or delete someone else's comment to change the history. Post a new tagged comment instead. Changing only the topic line of your own comment is fine.
- Copy a list of decisions into an issue body. The body keeps its one DECISIONS link.
- Combine two topics under one topic line, or mix the parent's decisions with a child's.
