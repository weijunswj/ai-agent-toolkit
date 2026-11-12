Title: a governance GitHub App for the re-bump workflow

### Changed

- The re-bump workflow now mints its push token on each run from the Toolkit governance GitHub App, the one App the Toolkit governance workflows share, instead of reading a personal token from `TOOLKIT_REBUMP_TOKEN`. It reads the repository variable `TOOLKIT_GOVERNANCE_APP_CLIENT_ID` and the repository secret `TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY`. The App needs the repository permissions Contents (read and write) and Pull requests (read); the token lasts one hour, covers this repository only and is narrowed to those two. The workflow runs the command with the new `--installation` switch, which checks that the token covers exactly this repository instead of reading the signed-in account, which an installation token cannot do. With no client ID variable the run still prints a note and does nothing.
