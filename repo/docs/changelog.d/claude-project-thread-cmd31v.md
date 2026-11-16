### Fixed

- **The issue closure check proves a merge train is a train:** a merged train's `OWNER_TEST_NEEDED` line releases an issue its members answer for only when the train's own commits are merges of member heads (each row's pull request merged at that head, never the train itself), catch-up merges of main, eject reverts that exactly undo an earlier boarding, and a last version-only bump, read from GitHub. A pull request that pastes a train table over a merge of a sibling branch (even one that lists the sibling's head as a row), or adds a commit of its own, keeps the issue held.
