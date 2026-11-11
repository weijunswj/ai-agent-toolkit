Title: automatic re-bump workflow and a narrower launch rule

### Added

- A re-bump workflow for this repository: after every push to `main` it runs the re-bump command for the owner's open pull requests and pushes with the repository secret `TOOLKIT_REBUMP_TOKEN`, so their checks start by themselves. With no secret it prints a note and does nothing. A pull request it cannot re-bump gets one comment that says why.
- `toolkit-rebump-prs.cjs --authors <login,...>` skips other authors' pull requests before any of their code runs.

### Changed

- The re-bump command runs the pull request branch's own bump and validation scripts with every token variable and the Actions file-command paths removed from their environment.
- The merge hold no longer refuses a command that starts Claude or Codex when its only merge wording is branch upkeep: `git merge`, merge commits, merge conflicts or merge-base. Any other merge wording still refuses the launch, and pull request merges stay guarded.
- The merge hold's approval reader now skips a typed line whose only merge wording is the same branch upkeep, from one shared definition, so a launch the hold lets through carries no line the reader counts, as far as the hold can read the command (text the shell reshapes afterwards is not covered). A line such as `git merge 5` or `update #5 with a merge commit` no longer records an approval. This is one more reason to skip a line and nothing else in the reader changed: every line that was held before is still held, and `merge 5` and `merge owner/name#5` count as before.
- A pull request that changes the re-bump scripts (`toolkit-rebump-prs.cjs`, `toolkit-rebump-report.cjs`, `toolkit-rebump-action.sh`) now waits for the owner's typed merge.
