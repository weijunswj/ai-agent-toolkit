### Added

- The Toolkit Shard Timings workflow refreshes the test shard timings on GitHub once a day and when started by hand, so it no longer depends on a computer being on. Its built-in token only reads. With the governance GitHub App it opens the refresh pull request with an App token limited to contents and pull requests write, so that pull request's checks start; without the App it only reports. It never runs for pull requests or forks, and the cloud jobs contract lists it.

### Changed

- `refresh-shard-timings.cjs --open-pr` opens no new pull request while an earlier shard timing pull request is still open. When `TOOLKIT_SHARD_PUBLISH_TOKEN` is set, the push and the pull request use that token through environment-only git settings, never a command-line argument or saved config.
