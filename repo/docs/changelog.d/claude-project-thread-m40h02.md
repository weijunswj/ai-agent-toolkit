### Changed

- Each Claude Code setting row in setup lists only the choices that change something: a setting already on shows Turn off and Keep current, and one already off shows Turn on and Keep current. A different value, a blocked parent entry or an unreadable settings file still shows all three. The hidden choice's flag value still works and does the same as Keep current.
- The model-switch row now reads "Switch models without asking on a flag", so on means `"switchModelsOnFlag": true`, which is also Claude Code's default when the line is missing. Turn off writes `false` instead of removing the line, and setup still recommends Turn off. An existing `false` shows as off, so nothing in the settings file changes.
