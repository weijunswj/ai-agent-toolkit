### Added

- `refresh governance` in an already-governed repository now reads branch protection and rulesets, merge settings and the security settings from GitHub (read only) and shows their real state in the summary: on, drifted with what differs, not available on GitHub Free, waiting for you, or not checked with the reason GitHub could not be read. Before, a repository governed by an older Toolkit showed "Not checked here yet" for ever.
- Where something drifted that Toolkit sets up itself (for example squash and rebase merges allowed beside an active ruleset), the summary asks one question, Fix the drifted GitHub settings. Yes makes the same writes a governance turn-on makes and reads each one back; no writes nothing. With the programme file update also open, each answer names its question (for example 2A).
- A summary read that GitHub answered in full is saved for the session-start drift line, so a fix ends that line at once; a read with any part unread never clears saved drift.
