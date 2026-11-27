### Fixed

- Turning governance on no longer leaves files in your checkout. The plain-text check, its baseline, the Dependabot settings and a first shard list are rendered in a scratch folder outside the checkout and travel only in the one setup pull request, so after the merge the session-start catch-up can bring the default branch up to date.
- The session-start catch-up now also moves a default branch whose only changes are untracked files the move adds with exactly the same bytes (as an older turn-on left them). It removes them just before the move, puts them back if the move fails and names them in its line; a file that differs, or one the move does not add, still keeps the checkout where it is.

### Changed

- The setup pull request's programme file requires the checks its own workflows add (`plain-text`, and `personal-data` where it adds the personal data guard) next to any the default branch already requires. The turn-on no longer asks you to edit `required_checks`, run `migrate` or compare files before pulling.
- Owner commands in the governance bank's answer (the permissions command and the Governance App line) come in `powershell` blocks.
