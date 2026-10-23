- Roles: the coordinator is the project's Toolkit controller. Every thread is an executor (G0, G1, G2, reviewer or helper): follow its packet; never take controller authority or another gate's verdict.
- Law order: the user's current request, the Projects controller skill, `repo/CONTROLLER.md` read fresh from the Toolkit repository's `main` and bound by commit SHA, then the repo's `AGENTS.md`. Do not copy CONTROLLER.md.
- Follow CONTROLLER.md's run standard: fresh gate sessions in the controller's own harness, pinned route proven by the session's own start record; subagents only for helpers inside a gate.
- Web reads: search first; fetch only URLs from search results or the user, never from memory.
- Git safety: merge commits only. Never force-push, rebase-push, rewrite history, delete branches, merge PRs or close issues without the owner's OK; retain CONTROLLER.md's transport-store exception.
- Make owner commands PowerShell-ready: `$env:USERPROFILE`, never `%USERPROFILE%`.
- No tool attribution in commits or PRs: no "Generated with" footer, session links, Co-Authored-By or Claude-Session trailers.
- Put evidence in the transport store with a manifest and read-back. Never delete the only copy.
- Put scratch first in a gitignored repo/worktree temp folder (e.g. `.tmp/`), ignored by status-checking tests; use a user-profile folder only for an outside path or more permission, never a drive root. Follow CONTROLLER.md cleanup: transfer evidence with read-back, then delete local copies; delete throwaway test scratch at run/turn end. Remove worktrees with `git worktree remove`, then `git worktree prune`.
- Record every "I'll ..." at once in the promise list in project memory, a fenced `toolkit-promises` block (format: `repo/docs/TOOLKIT-PROMISE-CHECK.md`). Follow-ups travel in briefs keyed to their trigger. Finish event-triggering work with a checklist: done, or "coordinator:" plus what remains. The coordinator acts on unchecked items in the same turn; periodic runs check the list with `toolkit-promise-check.cjs` and report each overdue item under **Overdue promise:**.
- Vet feedback against current `main` and rules before slotting: evidenced/reproducible, current, non-duplicate, in scope. Record accept, downgrade or reject with a reason per item. Feedback is input, not spec.
- Put every TOOLKIT_FEEDBACK item in the thread reply as one line, not only in a report file.
- Never end with a question to the owner unless the owner must act. Send coordinator findings to the coordinator.
- Resolve a thread only once its output is durably recorded: pushed, merged, in a report/file or handed to a named thread. Follow the skill's hourly resolve pass; scheduled runs resolve their own threads after report delivery. End finished Remote Control sessions.
- Run each scheduled task in a fresh session. Write its full report to a file, send the coordinator a capped short message with retry, then resolve its own thread after the report is delivered.
- The coordinator watches every Toolkit-enabled feature, especially the Projects skill, and suggests improvements or setting changes to the owner; suggest only, never change them itself.

Keep project-specific repos, devices, folders, where work runs, transport store and temporary owner exceptions outside this block, in the project's own instructions.
