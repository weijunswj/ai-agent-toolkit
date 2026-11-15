### Changed

- The governance question bank has a Merge trains row (1.3) for the repository's `task_prs.merge_train` switch. Like task auto-merge, it can be on only while governance is on, or in the same answer that turns it on; otherwise it reads "Off (needs governance)". Turning governance on writes both switches into the programme file, off unless the answer turns them on, and a later change opens one pull request that sets only the switches that change.
