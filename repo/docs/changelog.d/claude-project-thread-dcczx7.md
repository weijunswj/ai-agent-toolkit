Title: turn-on writes only what the repository needs

### Changed

- Turning governance on now opens one pull request with only the programme file and the Toolkit CI checks (the plain-text check, plus the dependency security files and cloud sweep copies where they apply). It no longer writes the governed block into `AGENTS.md`, a `CLAUDE.md` shim, the Antigravity bootstrap or the playbooks: the installed Toolkit gives every session the governed rules, and the playbooks ship as the `toolkit-playbooks` skill.
- A working tree is a prepared adoption when its programme file turns governance on; a governed block is no longer needed. A programme file that turns governance off is not taken as a prepared yes.
- The governance discovery list no longer offers to reuse or refresh a governed block. A block an older setup left is listed as no longer needed, and the CI checks the turn-on adds are listed.
- `repository-agent-rules` no longer installs or refreshes the governed block, the Antigravity bootstrap or playbook copies; it reports any it finds as leftovers and keeps the CI checks and the one-line `CLAUDE.md` shim.
