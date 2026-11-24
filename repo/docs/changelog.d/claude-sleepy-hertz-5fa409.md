Title: Projects skill card only on real text changes

### Added
- `toolkit-projects-guidebook.cjs --card` prints one line on the owner's saved claude.ai copy of the Projects skill: `SKILL CARD OUTDATED: saved <old>, main <new>, text <fingerprint>`, `SKILL CARD CURRENT` or `SKILL CARD NOT SEEN`. It compares the text, leaving out the Version line, line endings and trailing whitespace, so a release that only restamps the Version line offers no card, and a declined card is remembered by its text fingerprint.
- `toolkit-projects-guidebook.cjs --refresh <folder>`, the hourly nudge's every-run guidebook refresh: it refuses a clone that is not origin's main tip (`SKILL COPY FAILED STALE_CHECKOUT`), then prints `GUIDEBOOK CURRENT` or `GUIDEBOOK REFRESHED <old> -> <new>`.

### Changed
- Setup and the Claude Code session start offer the Projects skill update card only when the saved text really differs; a Version-only difference says the copy matches Toolkit's text. Where the session has no `propose_skills` tool, the line says so plainly and nothing is asked.
- The hourly nudge deletes any old Toolkit clone before cloning, runs the guidebook refresh and the skill card check every run, and deletes the clone at the end. The daily check-in uses the scripted card line instead of comparing Version lines by hand.
- The guidebook refresh no longer reports `BLOCK CHANGED`, and the project-instructions check no longer reports the block outdated, when only the block's marker version or digest moved, so an identical block is not re-applied every release.
- The Projects coordinator no longer watches Toolkit features to suggest improvements or settings to the owner; it still never changes Toolkit features or their settings itself.
