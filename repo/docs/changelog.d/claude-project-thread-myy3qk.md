Title: merge train finder

### Added

- **Merge train finder:** `toolkit-merge-train.cjs find --out <file>` picks the pull requests ready to board a train and writes the manifest `build` takes. Ready means open, not a draft, on the default branch, a passing review verdict comment for the current head, green required checks, one `Bump:` line, an accepted `UAT:` line, no version bump of its own and no open train holding it. It takes at most six, oldest first, and with fewer than two it says to merge the one alone. It reads only, never fills the owner's OK for a RISKY member, and refuses where merge trains are off.
- **Review verdict comments:** each G2 pass or fail also goes on the pull request as one comment whose first line is `Toolkit-G2: PASS|FAIL <full head SHA> tier=<tier>`. The finder reads only that line, and only from accounts that can write to the repository. The hourly run's `train due` flag uses the finder.
