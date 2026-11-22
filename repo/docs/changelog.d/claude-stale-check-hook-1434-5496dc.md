Title: stale check from the session-start hook

### Changed

- The stale check (missed closes, duplicate children, closed children holding open work, a full polish child) now runs from the governance session-start hook instead of the Claude Projects daily check-in. Where governance is on, a session start shows one `Stale check` line for the controller when there are rows to answer, starts the check in the background at most once a day per repository, and says which read failed when the check keeps failing. A day with nothing to answer shows nothing.
- The stale check's rows are for the controller: it closes children it judges done itself, and puts a close that needs the owner's OK (an `OWNER OK?` row after agent UAT passed, a duplicate or an obsolete child) in its next ask to the owner. The `CLOSE LIST` owner post and its empty-day line are gone.
- A child whose gate is still live (at work on a task waiting on the owner, or blocked) is never offered to the owner to close: programme owner waits now carry `gate_live`, and only a wait with no live gate becomes an `OWNER OK?` row.
- A cloud session never reads the programme store at session start. Inside a governed repository it shows the attention and stale-check lines from its own cache, or else says plainly that both run at the next session start on the owner's computer.
- The Projects daily check-in no longer runs the stale sweep, and no longer posts a "nothing changed" line to the owner: a quiet run posts nothing, and the hourly nudge still catches a missed run.
