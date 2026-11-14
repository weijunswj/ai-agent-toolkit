Title: governance turns on in a new repository

### Changed

- Turning governance on from the governance question bank now works in a new repository. The bank shows the evidence store, parent issue and required checks it found, or says what it will make; an existing store that is not `TRANSPORT-<name>` becomes a question (keep it, or create a new private one). After the owner's answer Toolkit creates a missing private `TRANSPORT-<name>` evidence store (read back as private and the owner's, seeded with `archives/README.md`) and a missing parent issue, then puts the programme file, the governed `AGENTS.md` block, the `CLAUDE.md` shim, the playbooks and the plain-text check into the one turn-on pull request. Text outside the block markers keeps its bytes, and the working tree's instruction files are not changed.
- A failed step stops with what was made and what was not; answering again reuses a store or issue made earlier. When GitHub cannot be searched, nothing is made.
- `toolkit governance check` now tells a repository with no merged decision to say `toolkit governance` and answer its bank in chat, instead of running enable or disable in a terminal.
