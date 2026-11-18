Title: no silent skips and release identity

### Added

- **No silent skips:** every skipped or todo test in Toolkit's own suite is listed in `repo/contracts/ci/test-skips.json` with the systems it skips on and a reason. The shard summaries now name each skipped and todo test, and the Validate check fails on a skip the list does not hold, on a listed skip that no longer skips, and on a summary that counts skips without naming them. A governed repository's own shard runner judges each test file by its exit code only, so it has no per-test skips to hold.
- **Release identity:** `node repo/scripts/toolkit-release-identity.cjs --commit <sha>` finds the first Toolkit version that holds a merged commit and reports, for the computer it runs on only, whether each Toolkit copy there has it: the managed checkout, the Claude Code plugin, the claude.ai account copy in the Claude app, a cloud session's synced plugin copy and the Projects guidebook. A copy is delivered, not delivered or unknown; anything it cannot read or prove is unknown, never delivered. `--min-version <x.y.z>` checks a version instead. It exits 0 only when every copy it found is delivered, and reads only.
- The git-completion playbook asks for this check before an owner test of a merged fix, and for each UAT result to name the version tested.
