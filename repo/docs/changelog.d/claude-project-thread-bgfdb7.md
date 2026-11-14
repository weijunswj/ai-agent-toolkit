Title: governed repositories can shard tests in any language

### Added

- A governed repository can keep its own test shard list at `.github/toolkit-test-shards.json` (schema `toolkit-test-shards/v2`): Toolkit's shard list plus, per system, a `discover` glob and a `command` with one `{files}` argument. `run-tests.cjs --repo-root <dir> --shard <id> --os <system>` runs the command once per file with no shell, three at a time, stops a file that runs past `file_timeout_seconds` (default 900), times each file and writes the same shard summary as Toolkit's own shards. `--check` and `--plan` read the list without running anything.
- The programme binding accepts a `ci_shards` key (`answer` yes, not-now or never, and `offered_at`) for the sharded CI offer. This release only reads it; nothing writes or acts on it yet, so every copy knows the key before a later release sets it.
