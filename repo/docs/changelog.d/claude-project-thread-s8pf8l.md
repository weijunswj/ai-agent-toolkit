Title: parent page layout

### Changed

- **Programme graph:** the parent's graph has the columns `Task | PRs | Status | Waiting on | Updated (SGT)`. The task cell starts with the child number. PRs shows the three newest, then a count of the rest. Status joins the group and the status, such as `NOW · IN PROGRESS`, or shows `COMPLETED` or `RETIRED`. Waiting on names the owner's decision or UAT, a blocker, or the gate the task is in.
- **Completed and retired rows:** the parent keeps the latest 10 COMPLETED rows. Older completed rows and every RETIRED row sit in the graph archive comments, behind one `Earlier completed · Retired` link line under the table. Archive comments use the same columns.
- **CURRENT:** the summary is slim. It keeps the board line, the tasks in progress with their PR, gate and any wait on the owner, and one line with the attention counts, the number of held tasks and the `programme.cjs attention` command. A stopped pass still shows in full. The Start next line and the finding lists are gone: the graph's order shows what starts next, and the attention command lists every finding.
- **AGENT CONTEXT:** the block is one line: the Agent context comment, any archived notes and the `programme.cjs trace` command.
- The hourly nudge reads the next task from the graph's LATER rows and each task's next action from its task page.

### Added

- **Parent budget:** a parent page of 10,000 characters or more raises `BODY_OVER_BUDGET` with the sizes of its largest parts. The page is still written, and the finding clears once the page is under budget.
