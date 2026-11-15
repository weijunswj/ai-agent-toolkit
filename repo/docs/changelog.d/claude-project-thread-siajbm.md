### Fixed

- The merge hold now judges a shell command by the real folder it runs in, not only by its text. Inside Toolkit's user-state folder nothing runs; in Toolkit's own folder only listing, reading, changing folder, read-only git and running a script file with node pass, with no wildcards, variables, substitutions or `..`; deeper in Toolkit's folder, a word naming user-state or a `..` path back up is refused. Links, junctions and letter case on Windows cannot hide the folder, and a command too long to read is refused there too.
- A push to the default branch through `--git-dir`, a `GIT_DIR=` prefix, or a `GIT_DIR` set earlier in the command (`export`, `$env:`, `set`) is now judged against the repository it names, so it is held like any other default-branch push.
