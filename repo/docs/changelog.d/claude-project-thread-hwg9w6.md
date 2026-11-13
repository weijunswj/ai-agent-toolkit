Title: remove toolkit does the full uninstall

### Changed

- `remove toolkit` now removes everything Toolkit put on the computer after one OK, not only scheduled tasks and global rules: Codex's helper limit block, Claude Code's subagent limit (only while it holds Toolkit's value), the helper agent files Toolkit generated, the skill folders it copied, and last the Toolkit folder `~/.ai-agent-toolkit`, keeping `env` and the backups. The Claude Code preferences chosen at setup, such as no AI attribution, are listed and kept. The folder waits until no Toolkit plugin is installed, and the result prints the exact plan line to finish with. The plan prints each app's plugin uninstall lines, which the agent runs after the OK, and the app screen to use when the command line is missing.
- The README's Remove section is now one command plus what stays on purpose.
- The personal-data guard installer refuses to install into the Toolkit's own repository, and `--uninstall` removes a clone's guard hooks and puts back any hook they set aside. `--check` in a Toolkit checkout points at `--uninstall` when guard hooks are left over.
