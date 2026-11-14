### Changed

- `setup toolkit` and `refresh toolkit` now install, refresh and report the Toolkit global rules only for the app they run in (plus Antigravity when managed). Claude Code setup no longer writes or reports `~/.codex/AGENTS.md`, Codex's instruction limit or a hand-written section in Codex's file, and Codex setup no longer touches Claude Code's file; each app keeps its own file current at its own session start. `remove toolkit` for every app and `toolkit-global-rules.cjs` without `--harness` still cover both apps.
- An update report names only the plugin version of the app that triggered it.
- Setup's checklist and PR-branch warning, the final audit step title, two merge-hold refusals and the attribution repair message no longer name Claude or Codex.
