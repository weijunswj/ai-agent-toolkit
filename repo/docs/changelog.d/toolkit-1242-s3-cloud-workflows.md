Title: every cloud workflow by default, and a first look at what is already there

### Added

- **Every Toolkit cloud workflow by default:** turning governance on now carries the personal data guard (its check, sweep, script and settings, with no hooks on any computer) and dependency auto-merge with the programme sweep and its gate, in the same one pull request; the test shards and Shard Timings join where a usable shard list exists, as before. One list, `DEFAULT_CLOUD_WORKFLOWS`, is read by turn-on, the refresh pull request and the governance check.
- **A missing workflow is drift:** the governance check names each default workflow file that is missing or edited, and the refresh pull request adds what is missing and brings an edited or older copy back. A rerun with nothing missing changes nothing. A file Toolkit did not write is never overwritten: that workflow is left out whole and named, and the rest still goes in.
- **First-install sweep:** after a turn-on that adds the guard merges, Toolkit runs the new Personal data sweep workflow once over what is already there (files, commit messages, pull request text, and issue, pull request and review comments) and shows the counts and a link in the next session's result line. It lists places and rule names only, never a value, and changes and posts nothing. Run workflow on GitHub runs it again by hand.

### Changed

- **The personal data guard never scans commit author, committer or tagger addresses:** the `identity` setting, and the installer's `--identity` and `--identity-reason`, are gone. A config that still holds the key is read without it, and the refresh pull request that brings the new script takes the key out, keeping every other setting.
- The guard's CI workflow copies have a managed header, and its installer brings an older copy up to date; a hand-edited one is kept.
- A default branch other than main now leaves out only the sweep, its gate and the shard copies, with the reason, instead of every cloud workflow.
- With governance off, the left-over files report also names the guard's marked workflows; like its script, they keep working and are the owner's choice to remove.
- The turn-on no longer writes dependency auto-merge into the working tree; it travels in the pull request.

### Fixed

- A file name with a line break can no longer write a line of its own in the guard's report.
