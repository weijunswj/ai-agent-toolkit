Title: one shared governance key for the re-bump workflow

### Changed

- The re-bump workflow now reads the repository secret `TOOLKIT_GOVERNANCE_TOKEN`, the one key the Toolkit governance workflows share, instead of `TOOLKIT_REBUMP_TOKEN`. The re-bump uses only its Contents (read and write) and Pull requests (read) permissions. With no secret the run still prints a note and does nothing.
