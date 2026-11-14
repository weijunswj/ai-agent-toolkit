Title: governance turns on in a new repository

### Changed

- Turning governance on from the governance question bank now works in a new repository. The bank shows the evidence store, parent issue and required checks it found, or says what it will make; an existing store that is not `TRANSPORT-<name>` becomes a question (keep it, or create a new private one). After the owner's answer Toolkit creates a missing private `TRANSPORT-<name>` evidence store (read back as private and the owner's, seeded with `archives/README.md`) and a missing parent issue, then puts the programme file, the governed `AGENTS.md` block, the `CLAUDE.md` shim, the playbooks and the plain-text check into the one turn-on pull request. Text outside the block markers keeps its bytes, and the working tree's instruction files are not changed.
- A failed step stops with what was made and what was not; answering again reuses a store or issue made earlier. When GitHub cannot be searched, nothing is made.
- `toolkit governance check` now tells a repository with no merged decision to say `toolkit governance` and answer its bank in chat, instead of running enable or disable in a terminal.
- In Claude Code the governance question bank is answered on the app's own question card instead of a typed reply. Toolkit lets only the exact card it printed through, and the owner's taps come back as one answer with a one-use ticket. Codex keeps the typed reply. A shown bank no longer ends as Failed.
- The bank's permissions row is now one row per app, "Toolkit permissions (Claude Code)" or "(Codex)", with Keep current, Update or Remove. Its state reads Up to date or "Outdated: N missing, M old". Update and Remove give the owner one command to run in their own terminal: it previews, backs up and waits for a typed `apply`. The bank says any other app needs `toolkit governance` run there too.
- Task auto-merge can be turned on only while governance is on, or in the same answer that turns it on; otherwise it reads "Off (needs governance)".
- `toolkit governance security` also turns on GitHub's "Automatically delete head branches" (check S8), so merged branches do not pile up.
