Title: per-repository task auto-merge

### Added

- Task auto-merge, a per-repository answer that is off unless the owner says yes. `toolkit governance check` asks once in each governed repository whose merged binding has no answer, with No recommended, so "all recommended" never turns it on, and only once every Toolkit copy runs a version that knows the answer. The answer is `task_prs.auto_merge` (`off` or `after-gates`) in the programme binding and counts only once merged on the default branch and read within a day.
- The `auto-merge-eligible` check (`.github/workflows/auto-merge-eligible.yml`, running the default branch's `repo/scripts/toolkit-auto-merge-eligible.cjs`) fails a pull request on the always-manual list: the programme binding and merge rules, hooks and every module they load, setup that writes hook config, CI workflows, agent instruction files and a major version bump. A change that only moves version stamps does not count. Such a pull request merges once the owner adds the `toolkit-owner-merge` label in GitHub; a new push removes it, and the merge hold refuses an agent that sets it.

### Changed

- With an enforceable yes (the binding and the default branch both require `auto-merge-eligible`), the merge hold lets one merge shape through without a typed approval: a merge commit pinned to the full head SHA, in a session the user started, from that repository's folder. Every other merge still needs the owner's typed merge.
- The global rules' merge line, the gate rules (new task auto-merge section), the controller rules and the Projects skill say when the controller may merge on that answer: G2 PASS, every required check green and owner UAT passed or not required, on the same head, one merge at a time.
