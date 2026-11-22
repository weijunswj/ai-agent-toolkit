Title: One approval question for Claude Code setup

### Added

- Claude Code setup now asks one question, `Apply these defaults?`, over a table per section that shows each setting's current value, what setup applies and the other choices. A yes applies the Toolkit default only to settings that have no value yet; a setting that already has a value, including one you turned off, keeps it. A reply such as `3.5=off` changes just that setting, and a setting you do not list keeps its current value unless you also say yes. A no writes nothing.
- An off you choose for a Claude Code setting (attribution, cross-session messages, reading AGENTS.md) or for the Antigravity skills copy is recorded, so later setups and refreshes keep it off without asking.
- The AGENTS.md setting goes where the running Claude Code reads it: `cc-plugin-agents-md@builtin` on 2.1.285 and later, `agents-md@builtin` on 2.1.277 to 2.1.284, and nowhere on older versions, which setup says.
- The setup skill now keeps the rule for relaying the question bank as its own short section.

### Fixed

- A Claude Code refresh asks the question again when a setting still has no value, and stays silent otherwise.
- Setup saves the answers refresh compares with only after they are applied, so a run that stopped to rerun the updated setup no longer leaves a later refresh silent with nothing applied.
- On Claude Code, an empty reply to the approval question stops setup with the "requires an answer" message instead of asking again forever.
