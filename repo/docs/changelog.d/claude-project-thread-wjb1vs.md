Title: the plugin delivers the governed rules

### Added

- Session start gives the governed rules: in a repository whose merged binding is enabled, Claude Code's session-start context and Codex's session-start output carry the full governed rules from the installed Toolkit, tagged with its version, so the repository needs no copy of them in `AGENTS.md`. Disabled, undecided, unreadable and error states get none.
- Cloud sessions that start outside a repository, such as a Claude Projects thread in `/home/user`, read each repository cloned directly under the start folder, name each one's governance state and give the governed rules once for the enabled ones.
- New `toolkit-playbooks` skill: the sixteen working playbooks now ship with the plugin, with the index as its `SKILL.md`, on every host that loads Toolkit skills.

### Changed

- The playbooks moved out of `repository-agent-rules`; turn-on pull requests still write them into `docs/agent-playbooks/` until turn-on stops writing repository files.
- Conformance: an enabled repository with no governed block is no longer drift. A block still there is reported once as a leftover copy to remove by pull request once every app working there runs this version.
- Global rules say where the governed rules and playbooks come from when no session hook runs; the governed rules drop the playbook-index install line.
