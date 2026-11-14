Title: decision records out of page bodies

### Changed

- **No comment trace in page bodies:** programme parent and task pages no longer carry a generated COMMENT TRACE. Each keeps a short DECISIONS block instead: one line, the command that lists the decisions, and one link to the newest decision comment. The next refresh replaces every old trace block in place; index comments an older Toolkit posted stay as they are.
- **Fewer page writes and no trace paging:** an untagged comment no longer changes a page, and the pass never pages decisions into index or directory comments. Body traces are no longer audited, so `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED` are not raised.
- **Rules:** the governed Decision traces line, the decision-trace and takeover playbooks, the bootstrap skill and the reconciler skill now point agents at `programme.cjs trace <n>` instead of the body.

### Added

- **`programme.cjs trace <n>`:** lists an issue's decision records by topic (latest per topic live), with the parent's read separately. It runs the read-only decision history against the checkout's origin and takes `--full`, `--edits`, `--json`, `--max <n>` and `--repo-root <dir>`.
