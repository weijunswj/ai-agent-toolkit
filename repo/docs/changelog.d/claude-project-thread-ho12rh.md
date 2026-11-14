Title: findings keep asking until they clear

### Changed

- **An action-required update report keeps asking:** while it is open, every bridge hook run prints `Toolkit: action needed (...)` with the cause, how many session starts in a row have seen it and the report's file name, and says to tell the owner before other work. A repeat of the same result writes no new report but still prints the line; a run that needs no action clears it, and cleanup never deletes the open report.
- **Rule-drift notes repeat:** the repository-rules note shows at every session start while the finding holds, with its count, and names the step as due before the current task ends instead of "when convenient". It still never halts work.
- **Held programme refreshes are counted:** held runs keep `held_streak` and `held_since` like skips, an incomplete inventory is held rather than done, the session line shows the count, and TASK HEALTH flags three held runs in a row.
- **Task health shows age and peers:** a flag that has stood a day or more shows its age in days, and the session line names other computers' flags for the same repository.
- **Unverified is not conformant:** an online `toolkit governance check` that could not confirm a setting reports `unverified`, exits 3 and names the repository admin's step. Offline runs keep exit 0.
- **Merge-train ejections are listed:** the build prints a next step for each ejected member and the train body gets an `Ejected` section.
- **Plain-text check:** unreadable settings or baseline are drift in `--check`, and a stale baseline allowance fails a full run until `--prune-baseline` lowers it.
- **Hook pack:** a known-bad row over 30 days old fails the run unless it names its tracking issue in `issue`.
- **Bridge hook errors are counted:** a hook that keeps stopping on an error says how many session starts in a row and to tell the owner.
- **Work-queue-only attention:** when every open finding is on the work queue, the session-start action names the queue step and no longer offers an ack, which a work-queue finding refuses.
