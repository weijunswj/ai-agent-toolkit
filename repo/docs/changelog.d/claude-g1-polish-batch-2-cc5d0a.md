Title: polish bundle 2

### Fixed

- **A stopped check says why on its controller check row.** A check that stops with nothing on its output, such as a handoff `--check` that cannot read the snapshot, now shows its `Stopped:` line instead of a bare ATTENTION row.
- **The PR body pre-flight reads the programme file as the sweep does.** A repository whose `.github/toolkit-programme.json` turns governance off no longer gets the page budget, and the success line names only the checks that ran there.
- **The governance App `--save` says when it could not read back.** When the names cannot be read again after the Enter, the stop says so instead of saying the repository changed; nothing is saved either way.
- **Remove takes the update lock and moving marker too.** `update.lock` and `update.tree-moving` are removed with the rest of Toolkit's own files instead of being kept as "not a Toolkit file".
- **Owner closes wait for every open gate.** A task whose gate is submitted, interrupted or waiting on the owner is no longer offered to the owner as a close (`gate_live` counts every gate state but retired).
- **The parent state schema knows every finding code.** `AGENT_UAT_UNSTARTED` and `QUEUED_BUT_MOVING` are in its code list, and a test keeps the list in step with the code.

### Changed

- **A hand-made task's refresh refusal says what to save.** The refusal and the recurring-tasks reference say to write the task's project lines word for word in `project-additions.md`, or the line `- none` when it has none.
- **Gate rules: agent UAT start.** A landed PR's owed agent UAT starts at once, and an `OWNER_TEST_NEEDED` PR still needs its `Agent UAT: PASSED` line before merge.
- **Agent UAT lane check:** a UAT with no head is never flagged, and each of the lane check's paths has its own test.
