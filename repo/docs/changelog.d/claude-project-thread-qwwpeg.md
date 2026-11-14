### Fixed

- **Large state documents:** the programme sweep now reads a state document over about 1 MB whole by its blob id, instead of holding it as unreadable. GitHub's one-request state read leaves out the text of such a file. A pass that cannot fit those extra reads in its budget stops before any write. The check after a state commit compares blob ids instead of reading those files again, so it never stops a commit that has already landed.
- **Queued sweep runs:** a cloud sweep run that only queues behind another sweep no longer cleans footers, since it ran no pass and holds no lease.
