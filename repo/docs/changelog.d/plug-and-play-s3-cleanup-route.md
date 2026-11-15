Title: cleanup route for Toolkit instruction copies

### Added

- `repo/scripts/toolkit-governance-cleanup.cjs`: in a repository whose governance is on, it previews and then (with `--write`) removes the Toolkit instruction copies older setups wrote: the governed block (keeping every byte outside the markers), the Antigravity bootstrap, Toolkit playbook copies, and a one-line `CLAUDE.md` when `AGENTS.md` has nothing of its own left. It sets `min_toolkit` in the programme file, keeping that file's own layout so the pull request shows one changed line, and never runs git; the owner merges the one pull request. It refuses a version 1 programme file, which cannot carry `min_toolkit`, and a Toolkit source checkout, whose copies are removed by hand, and holds while a pinned cloud sweep copy runs a Toolkit that does not know `min_toolkit` (the bank shows that as a status line). A governed block edited by hand is named in the preview.
- `refresh governance` asks about a governed repository's instruction copies as one bank row; Keep current is recommended, and only the owner's Clean up answer runs the cleanup in the working tree.
- `min_toolkit` binding key: a Toolkit copy older than it reads the binding as ERROR and says to update Toolkit.
- `repo/contracts/agent-rules/playbook-history.json`: hashes of every playbook version Toolkit shipped, retired names included, so a repository's older copies are recognised.

### Changed

- The leftover scan now covers repositories whose governance is on: only the instruction copies are listed there, and its checks and workflow copies are kept. A playbook matching any earlier Toolkit copy is listed. A one-line `CLAUDE.md` that loads the repository's own `AGENTS.md` rules is kept.
- The session-start preflight names a governed-rules copy as a leftover instead of asking to refresh it. Where governance is on it says removal is the owner's Clean up answer in `refresh governance`; elsewhere it names the leftover scan. Neither asks anything of the current task. A note with both a leftover copy and differing checks names both, instead of reporting broken markers.
- The n8n router no longer offers "install `AGENTS.md` with `repository-agent-rules`".
