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
