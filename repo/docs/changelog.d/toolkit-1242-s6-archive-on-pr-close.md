### Added

- Claude Code setup has a row for the Claude desktop app's "archive sessions when their PR closes" setting, On by default. In the app, the agent reads the setting with the app's settings tool and passes it to setup; a yes returns that one change, which the agent makes through the app's own approval card. Setup never changes the setting itself. An off you chose is remembered, and outside the app the row shows Not readable here and changes nothing.

### Fixed

- A governance answer typed into a Terminal panel tab Claude opened in the desktop app is refused like any shell an agent started: the app marks such a tab, and Toolkit now reads that mark. A tab you open yourself works as before. The bridge doc no longer says the panel carries no mark.
- A Claude Code setting under an entry that is not an object counts as not read, no longer as having a value.
- Where the Claude Code settings file cannot be read and no agent profile can be used, setup says it still sets its own profile to root-only.
- Turning governance off where it is already off says only that.
