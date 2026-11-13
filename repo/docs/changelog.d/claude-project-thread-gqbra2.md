Title: cloud merge hold

### Changed

- **Cloud sessions run the governance holds:** a Claude Code cloud session, including every Claude Projects thread, now runs the merge hold and the undecided-repository hold as a computer does, instead of skipping them. Issue closures the cloud check cannot prove unsafe stay advisory there. `toolkit governance status` says "governance holds run" for a cloud session.
- **Projects merge card taps count:** in a Projects thread, a tap on Merge on the decision card `Merge owner/name#N at <full head SHA>?` counts as the owner's approval for that pull request at that SHA, once. Only the host's own card answer counts: not Not now, another option, a relay or a replayed card. The merge thread posts the card itself, so the tap reaches the session that merges.
- **Projects task auto-merge switch read by the hook:** the project line `- Task auto-merge: On` is read from the host's session context at the start of a thread's first prompt, and with it On a merge with no tap passes on the computer's standing checks (fresh enabled binding, merge commit pinned to the full head SHA, clean merge scope). The Projects skill's parity and overrides tables drop the "holds skipped" entries.
