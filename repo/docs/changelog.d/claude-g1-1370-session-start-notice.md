### Fixed

- When the session-start governance check crashes inside a repository, Claude Code and Codex now get one line saying so, with the error's kind (never its message), the path of the Toolkit-governed rules file to read if the repository is governed, and `setup toolkit` to repair the plugin. Before, the session started with no rules and no notice. Outside a repository it still says nothing, and session start never blocks.
- The skill-routing source says governance comes from the installed Toolkit, never from a block in `AGENTS.md`.
