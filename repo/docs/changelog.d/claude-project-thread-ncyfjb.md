Title: governance yes opens the question bank

### Changed

- Answering yes to the governance question (the card, a typed `toolkit governance enable`, or `enable` in your own terminal) now opens the governance question bank instead of a bare decision. The bank's own script then makes the one setup pull request, so chats no longer build the programme file, rules files, parent issue or evidence store by hand.
- A yes can no longer be published with `toolkit governance publish --run`. A turn-on pull request that is missing any of the rules set (the governed AGENTS.md block, a CLAUDE.md that loads it, the playbooks and the plain-text check) is refused. A repository already prepared by hand gets the missing files rendered into the same pull request.
- On a public repository, the bank shows a visibility line before you answer: the programme file names your private evidence store (its name only) and the parent issue is public. Nothing stops after you answer.
