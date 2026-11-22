Title: polish bundle

### Fixed

- **Remove toolkit takes the update records too.** `remote-check.json`, `update.readers/`, `agent-rules-notices.json` and `hook-skips.json` are now removed with the rest of Toolkit's own files instead of being kept as "not a Toolkit file".
- **Setup moves the managed checkout under the update guard.** Setup's switch and fast-forward hold the same moving marker as the bridge, so a session-start hook never loads half-moved files; a reader still reading after 15 seconds stops setup with nothing moved.
- **A held-off update is one plain line.** An update another session start held off for the whole wait no longer reads as a failure or opens an update report; it runs at the next session start.
- **A paste marker split across two reads is found.** The owner's Enter prompt keeps the last few characters read, so a split end marker no longer holds the prompt until Ctrl+C, and a split start marker no longer lets an Enter inside a paste confirm.
- **Setup reports terminal answers truly.** "Question answers prompted interactively" now says yes when the owner answered at the terminal, also after the RAM Enter prompt.
- **The governance App `--save` checks again after the Enter.** A variable or secret that appeared on the repository while the prompt was open stops the save with nothing written.
- **Projects run check is fast and reads ISO times.** The check stops at the first fire after a stamp (60 old runs went from about 36 seconds to under 0.1), and ISO run times match their receipts instead of reading as orphan and pending.
- **Agent UAT records name the owed head.** A write that records the agent's UAT at another head than the owed UAT is refused, naming both heads.

### Changed

- **Server monitor alerts start with "Server monitor".** Alert and test titles read `Server monitor <label>: ...` instead of `host-observability <label>: ...`, and email subjects take an optional prefix only when one is set. The set-up steps say to copy the skill folder whole, and the Healthchecks.io line says its Telegram alarms come from its own bot.
- **Plainer rules.** The global question rule ends "Failing that, ask in one fully bold sentence."; the root-cause principle reads "make it at the shared source every copy, prompt and later run inherits"; the Secure CI/CD reference keeps the merge-guard condition; the delivery doc describes the stale sweep's `JUDGE?`, `FOLD?` and `MOVE?` rows.
- **The PR body pre-flight checks size and the bump level.** In a governed repository a body at or over the 3,000-character pull request page budget is a problem to fix, and in the Toolkit repository `Bump: patch` beside a changelog fragment with an Added section prints a note.
- **A refused Projects task refresh says why,** and a hand-made Toolkit task prompt refreshes only once its project lines are saved.
- **The Claude app chat's refresh ask is softer** on a computer whose own sessions still keep Toolkit current, and the Bridge doc no longer states an unmeasured spinner display.
