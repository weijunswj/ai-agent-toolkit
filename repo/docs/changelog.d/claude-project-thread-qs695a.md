Title: setup rows stand on their own
### Setup

- **Each Claude Code setting row recommends on its own.** A row recommends Turn on unless it is already on, or setup cannot read or change it, in which case it recommends Keep current. One row with a value no longer holds the other three on Keep current, so "All recommended" now turns on a setting that is still off.
- **Model switching is recommended on.** "Switch models without asking on a flag" recommends Turn on, which writes `"switchModelsOnFlag": true`; Turn off still writes `false`.
- **Choices list only what changes something.** In every row, the choice that matches the current state folds into Keep current whatever is recommended, so a row shows Keep current plus the choices that change something. "Keep Toolkit available in Codex?" hides Install or refresh when Codex already runs the current Toolkit from the update copy.
- **Each app's setup talks only about that app.** The Claude Code question bank and summary no longer mention Codex, and the Codex ones no longer mention Claude Code.
