### Added

- Claude Code refuses a gate start (`start_session`) whose brief lacks a valid `Gate:`, `Route:` or `Assignment:` line, is a fork, or does not pin the route's model and effort, and names the exact fix: the route lines from the stack registry, the profile's members, or the model and effort to pass. The brief is read by the same route reader the started session's own route check uses.
- After a gate start or proposal card below its pinned effort, Claude Code prints the next steps with the session id filled in: a READY-only first turn, then `set_session_effort` to the pin, then the go-ahead; and the `programme.cjs assign` record step for the brief's assignment.
- The hook test pack also reads after-tool (PostToolUse) context, so a row can check what a hook adds after a tool runs.
