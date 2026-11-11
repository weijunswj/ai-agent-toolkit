Title: automatic re-bump workflow and a narrower launch rule

### Added

- A re-bump workflow for this repository: after every push to `main` it runs the re-bump command for the owner's open pull requests and pushes with the repository secret `TOOLKIT_REBUMP_TOKEN`, so their checks start by themselves. With no secret it prints a note and does nothing. A pull request it cannot re-bump gets one comment that says why.
- `toolkit-rebump-prs.cjs --authors <login,...>` skips other authors' pull requests before any of their code runs.

### Changed

- The re-bump command runs the pull request branch's own bump and validation scripts with every token variable removed from their environment.
- The merge hold no longer refuses a command that starts Claude or Codex when its only merge wording is branch upkeep: `git merge`, merge commits, merge conflicts or merge-base. Any other merge wording still refuses the launch, and pull request merges stay guarded.
