### Changed

- `toolkit governance status` names the governed rules file in an enabled repository (`Governed rules: <path>`, and `governed_rules` in `--json`), so a chat that no session-start hook reached can still read them.
- The Bridge doc says helpers (subagents) get the global rules and the repository's `AGENTS.md` but not the governed rules, and why.
- The n8n safety router skill no longer calls itself a Toolkit skill surface, so the portable skills' leak list is empty.
- The git-completion playbook no longer cites a PR review playbook that only Toolkit's own repository has.
