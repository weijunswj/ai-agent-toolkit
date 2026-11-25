### Added

- Claude Code setup has a row for the Claude desktop app's "archive sessions when their PR closes" setting, On by default. In the app, the agent reads the setting with the app's settings tool and passes it to setup; a yes returns that one change for the agent to make in the app. The app asks you in its own approval card; in auto or bypass permissions mode it may not, so there your agent asks you about that one change first. Setup never changes the setting itself. An off you chose in setup is remembered; an off you set only in the app looks the same as one never chosen, so the question says that `3.6=off` keeps it off. Outside the app the row shows Not readable here and changes nothing.

### Fixed

- A governance answer, or `toolkit env show`, in a Terminal panel tab Claude opened in the desktop app is refused like any shell an agent started: the app marks such a tab, and Toolkit now reads that mark. A tab you open yourself works as before; the shell behind a `!` line in the message box is refused too. The bridge doc no longer says the panel carries no mark.
- A Claude Code setting under an entry that is not an object counts as not read, no longer as having a value.
- Where the Claude Code settings file cannot be read and no agent profile can be used, setup says it still sets its own profile to root-only.
- Turning governance off where it is already off says only that.
