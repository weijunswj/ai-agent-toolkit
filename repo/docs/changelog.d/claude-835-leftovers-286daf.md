Title: v4 setup split leftovers and review polish

### Fixed

- `remove toolkit` says the Toolkit folder waits for Toolkit's permission lines as well as its plugins, gives the agent the right next step when only the permission lines are left, and names deleted older backups as Toolkit's own on the closing lines too.
- Setup's "Read AGENTS.md (in all local repos) too" question names the exact key it writes: `"instructionFiles": "claude-md-and-agents-md"` at `pluginConfigs` > the AGENTS.md plugin id > `options` in `settings.json`.
- Refresh governance: the offer says Toolkit's ruleset is added only where still needed after a change to the repository's own ruleset; why Toolkit's ruleset waits for the controller's workflow fix is a note, no longer counted as the owner's step; a programme file update made stale by the refresh pull request is closed by the agent, not by the owner on GitHub.
- Weakness tasks: the yes question says it files only what is not filed yet; a task says to stay open until the fix is merged (a closed task is filed again while the weakness is found); a programme file that cannot be read is named as that; a Dependabot file gap is filed only when the summary could list it; dependency auto-merge with a foreign workflow and an unprotected branch waits for the controller instead of going to the owner by hand.
- The governance summary is filed only by the code that prints it (`show()`), never by reading the view.
- `review permissions`: the setup skill says to show the review list as ordinary text, never in a code block of the agent's own, as it already says for the `remove toolkit` plan.
