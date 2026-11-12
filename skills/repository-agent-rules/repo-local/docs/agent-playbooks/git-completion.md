# Git Completion

Use this for requested repo edits that should be committed, pushed, opened as a PR, or checked in CI.

## Procedure

- Work on a non-main branch for task/product source changes.
- Run the smallest relevant local validation before committing.
- Do not push task/product source to `main`.
- Evidence custody follows the managed `AGENTS.md` evidence-store line: the user-selected private store, separate from the task repository, is agent-managed once its identity and privacy are verified, with the secret scan, read-back, the sole-copy rule and all safety, privacy and native denial limits. A repository name or prefix alone grants no authority.
- Keep commits scoped to the requested change.
- Push and open or update the PR unless the user asked for local-only or no-push work.
- Check PR CI/status when accessible.
- Never claim tests, validation, or CI passed unless actually checked.
- If checks are pending, failed, or inaccessible, report the exact state and next useful command.

Keep the PR body aligned with the full branch diff when you can update it directly.

## UAT Line

Every pull request body carries exactly one line that says whether the owner has to test the change. It starts at the beginning of a line, with no bullet, bold or quote:

```text
UAT: NOT_REQUIRED (why the owner has nothing to try)
UAT: OWNER_TEST_NEEDED (the one thing the owner tries, in plain words)
UAT: PASSED (the owner's OK: a link or a date)
```

- **Who writes it:** the plan proposes the verdict, the builder writes the line when the pull request opens, and the reviewer confirms it against the change. A wrong verdict is a blocking review finding.
- **Owner tests:** use `OWNER_TEST_NEEDED` only for a step the owner runs on the finished product. It does not hold the merge: the pull request merges on its review and green CI, and the owner tests the installed build afterwards. At that merge the controller records UAT `PENDING` on every task the pull request links with `Refs` (in Toolkit, `programme.cjs update --issue <n> --patch <file>`, a controller-only write), so a later pull request's closing word for that task is refused until the owner passes it. A failed test gets a fix-forward or revert pull request. Only the owner's own answer turns it into `PASSED`; the controller makes that edit and puts the owner's OK in the brackets. A builder never writes `PASSED`.
- **No closing words while UAT is owed:** a closing word (`Closes`, `Fixes` or `Resolves` in any form) closes its issue when the pull request merges. While the line is `OWNER_TEST_NEEDED` or invalid, link every issue with `Refs`. Toolkit's issue closure check refuses the write and fails CI when the title, body or a commit message uses a closing word. After the owner's OK, the controller sets `UAT: PASSED` and then closes the issue. The same refusal applies to any pull request whose closing word names an open issue whose programme status records an owed UAT. GitHub reads closing words inside quotes and quoted error text too, so write `Refs` there as well.
- **No line is not a verdict.** A missing or invalid line is never read as `NOT_REQUIRED`, and neither is a risk tier, a label or a green check. It goes back to whoever owns the pull request to add or correct, and it is never turned into a question for the owner.
- **The check:** before a merge, save the body as GitHub has it now and run `node <Toolkit>/repo/scripts/toolkit-auto-merge-eligible.cjs --base <base SHA> --head <head SHA> --body-file <file>` from the repository's folder (`<Toolkit>` is the installed Toolkit copy; `-` reads the body from standard input). Exit 0 needs `NOT_REQUIRED`, `PASSED` or `OWNER_TEST_NEEDED`; for an owner test it also says the test comes after the merge and the issues stay open on `Refs`. A missing or invalid line exits 1 and names the reason: `Missing UAT verdict` or `UAT verdict invalid`. Exit 2 means the body or the commits could not be read, so there is no answer yet.
- **Saving the body on Windows:** pipe it straight in, `gh pr view <number> --json body --jq .body | node <Toolkit>/repo/scripts/toolkit-auto-merge-eligible.cjs --base <base SHA> --head <head SHA> --body-file -`, or save it as UTF-8. Windows PowerShell 5.1 saves `> file` as UTF-16 with a byte order mark; the check reads that too. A file in any other encoding exits 2 and is saved again; it is never treated as a missing line.
- **A yes counts only when it names the verdict:** the answer reads `Auto-merge: yes` and names the UAT verdict it read. A copy of the check from before this rule ignores `--body-file` and says yes on the merge scope alone; that answer proves nothing, so update the Toolkit copy and run it again.
- **Rebumps:** a version-only rebump never edits the body, so the line stays. A source change after the verdict gets the usual delta review, which confirms the line again.
- **What is not read:** lines inside code fences, quotes and HTML comments that start a line. Toolkit's generated status line (`- UAT: <state>; review: <state>`) inside a generated block is set aside too; only the hand-written line counts for the check.
- **What makes the line invalid:** anything else that looks like a UAT line counts as one, so a second one makes the verdict invalid. That covers a line dressed as a bullet, a numbered item, a heading, bold or italic, a line with invisible characters, unusual spaces or look-alike letters, and a line beside an HTML comment that starts in the middle of a line. Retype the line with plain characters on a line of its own.
- The line is evidence for the check. It grants no merge authority.
