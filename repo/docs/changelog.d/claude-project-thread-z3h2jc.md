Title: task and PR page layout

### Changed

- **Task pages:** an open task page is laid out as PATH, then `# TASK` with `## WHAT`, `## WHY` (the problem, the fix and what happens if we skip it as bold labels), `## DONE WHEN` (with an optional not-in-scope label) and `## PLAN`, then the generated PR GRAPH and a one-line STATUS, then one AGENT CONTEXT line, then More. Older pages convert on their next lay-out without changing a word; a heading written inside a part stays in it, and text added under the blocks goes to More.
- **PR GRAPH:** a task's PRs show as a table of PR, status, gate and merge commit: every open PR, the latest ten finished ones, then one `Earlier:` line. STATUS is one line with the status, gate, what waits on you, UAT and review (marked `STALE_HEAD` at an older head), the next action and the release. CI and head SHAs are left to the PR itself.
- **PR pages:** an open PR that names a task keeps PATH at the top and gets STATUS (one line per task) and AGENT CONTEXT under the author's description. A description that ends inside an open code block, HTML block or details section keeps the status block under PATH.
- **Frozen closed tasks:** a closed task page whose status already shows `COMPLETED` or `RETIRED` is never drawn again, so a pass writes only open tasks and the parent. A reopened task is drawn again.

### Fixed

- Whether a task page can be laid out is checked on its hand-written text with the blocks cut out, so a block marker that closes a comment left open above it no longer lets a held page flip into a new layout on the next pass.
