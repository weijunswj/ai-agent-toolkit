Title: Governance reminders for permissions, the App, the evidence store and a closed shard split

### Added

- **Permissions line at turn end (Claude Code):** while this computer's Toolkit permission lines are out of date, the first turn end of each governed local chat shows the owner one line, naming `toolkit permissions`. It shows once per chat, never stops the turn, and cloud sessions are not checked. The session-start line for the agent stays.
- **Governance App and evidence store at session start:** a governed session start carries one line for the agent to pass on when the Governance App is missing or partly set up, or when the evidence store cannot be found, is not private or cannot be written with this computer's GitHub sign-in. GitHub is checked at most once a day per repository (once an hour while it could not be read), in the background, so a session start never waits; GitHub that could not be read says nothing.
- **Evidence store row:** the governance bank's evidence store row shows Not ready, with its one step, when that check found the store cannot be used.
- **A closed shard split is asked about once:** when the owner closed a shard split pull request without merging it, the bank's shards row asks once (shards=yes opens a new one, shards=never stops the offer, any other reply keeps shards off). The answer is remembered on that computer for that pull request, and no plain reply reopens it.

### Changed

- **How to ask, generic wording:** the global rules, the desktop asking line, the takeover playbook and the controller principles now say to mark the recommended option instead of naming the owner's own "(my pick)" style, and the principles no longer ask for bold section labels. The owner's own instructions keep their style; the Claude Projects controller skill keeps its post format.

### Notes

- A missing Governance App holds no governance action: programme records, gates, merges, the bank and this computer's own refresh use the owner's own GitHub sign-in. Only the cloud Programme Sweep and the Shard Timings pull request need the App, and they do nothing without it.
- Codex keeps the session-start permissions line only; its turn-end hook prints nothing.
