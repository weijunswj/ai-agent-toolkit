### Fixed

- The Toolkit permission blocks no longer carry the retired Windows scheduled task lines (`tasks-plan`, `tasks-list`, `tasks-list-all`). Applying the blocks now also takes out Toolkit lines that are no longer in them, and `--remove` takes every Toolkit permission line out, with the same preview, backup and typed `apply`.
- CI now runs the script reference check, so a permission row or command that points at a retired script fails Validate.
