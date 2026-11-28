### Added

- **Toolkit pull requests get their own bold line.** When a controller opens, holds or lands a pull request that changes Toolkit's own files in a governed repository (a Toolkit refresh too), its message to the owner ends with one bold line of its own: which pull request, what it brings and what happens next (lands on its own once green with a notice after, held until the owner resumes, or needs the owner's merge), never only a bullet in a longer list. The rule lives in the controller principles' Plain owner posts; the takeover playbook's done line and the `controller takeover` command point to it.
- **`--land-refresh` prints that line.** For every route that finds an open refresh pull request, `toolkit-cloud-workflows.cjs --land-refresh` prints the bold line to end the owner's message with; for a landing, the notice to post after the merge is that bold line.

### Fixed

- `toolkit-cloud-workflows.cjs --land-refresh` run as a command no longer stops with "not extensible" before deciding anything: the command starts once the script has finished loading, so the land check and the copy proof it runs can load it.

### Changed

- **Refresh lines point to it.** The session-start stale-copies line, the sweep's stale-copies finding, the refresh command's own output and the repository-agent-rules skill say that `--land-refresh` prints the bold line that ends the owner's message.
