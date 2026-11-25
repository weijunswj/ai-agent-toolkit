### Added

- **Typed command `controller takeover`:** typed as the whole message in a new chat, it makes that chat the controller of the repository the chat's folder is in, names that repository, follows the takeover playbook (dry run, then claim) and ends in one short status: what runs, what is next, what waits on you. It counts as your appointment exactly as the sentence does, and only when you type it yourself: a launched, forked, scheduled or relayed message, a quoted line or words inside a longer message start nothing. A folder with no repository, or one where GitHub governance is off, undecided or unreadable, gets a plain refusal. The sentence keeps working for another repository and for chats that cannot run the command. It has its own group in `toolkit cmd`.
- **Toolkit versions in a takeover:** the dry run and the done line show the Toolkit copy this chat loaded (`--session-copy <folder>`, "not given" otherwise, never guessed), the copy that ran, Toolkit main, what the repository's cloud sweep runs (follows main, pinned, outdated, edited or the repository's own commit) and exactly one refresh action. The dry run shows them with governance off too.

### Changed

- The takeover playbook is 9,586 bytes shorter (29,998 bytes, capped): its steps point to the one command, the hand-made "two matching reads" stop proof is gone, and only the owner's own typed confirmation stands where the command cannot run. The relay illustrations that only repeated the templates are gone.
- The public-record screen names what it refuses exactly: dotted host names of three parts or more, local one-name hosts and any host with a port; a two-part name such as `claude.ai` passes.

### Fixed

- A takeover run that resumes an earlier run's record marks it NOT USED only when a read shows that another claim left its epoch. Before, a refusal or a late comment could mark the record an earlier run's claim had landed with, when GitHub's old reads outlasted that run.
- A record with other text in it is never resumed, so it cannot hold a takeover up.
- `CLAIM_UNCERTAIN` gives the reason of the claim that is uncertain, not of a later refused request, and a record that could not be marked says to run the command again first.
