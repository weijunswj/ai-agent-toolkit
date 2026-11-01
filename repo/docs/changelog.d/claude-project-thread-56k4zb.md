Title: setup host check

### Setup

- Setup now works out which app started it. When Codex runs it with `--host claude-code`, or Claude Code runs it without, it stops with exit code 2 before any question, says which app started it, changes nothing and prints the command to run instead. The stop names only that app, never the other one. With no app markers, or both apps' markers, `--host` is used as before.
- The setup skill and setup docs now say that only Claude Code adds `--host claude-code`, Codex never adds `--host`, and agents show only the question bank setup prints, never questions copied from the setup question reference.

### Internals

- The exact Codex and Claude Code shell marker names live in one module, `repo/scripts/agent-host-markers.cjs`, used by setup and `toolkit-env`.
