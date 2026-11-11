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
- **Owner tests:** use `OWNER_TEST_NEEDED` only for a step the owner runs on the finished product. Only the owner's own answer turns it into `PASSED`; the controller makes that edit and puts the owner's OK in the brackets. A builder never writes `PASSED`.
- **No line is not a verdict.** A missing or invalid line is never read as `NOT_REQUIRED`, and neither is a risk tier, a label or a green check. It goes back to whoever owns the pull request to add or correct, and it is never turned into a question for the owner.
- **The check:** before a merge, save the body as GitHub has it now and run `node <Toolkit>/repo/scripts/toolkit-auto-merge-eligible.cjs --base <base SHA> --head <head SHA> --body-file <file>` from the repository's folder (`<Toolkit>` is the installed Toolkit copy; `-` reads the body from standard input). Exit 0 needs `NOT_REQUIRED` or `PASSED`. Any other state exits 1 and names the reason: `Missing UAT verdict`, `UAT verdict invalid` or `Owner test needed`.
- **Rebumps:** a version-only rebump never edits the body, so the line stays. A source change after the verdict gets the usual delta review, which confirms the line again.
- **What is not read:** lines inside code fences, quotes, HTML comments and Toolkit's generated blocks. The generated status block may show a UAT state of its own; only the hand-written line counts for the check.
- The line is evidence for the check. It grants no merge authority.
