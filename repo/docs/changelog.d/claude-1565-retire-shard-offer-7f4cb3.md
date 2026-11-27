Title: the parallel CI shards offer retires

### Removed

- The governance question bank no longer has a Parallel CI shards row or a `shards=` override. A reply that still says `shards=` gets one line, "Toolkit no longer sets up CI shards; the CI check-up flags when they would pay", and nothing is written.
- Toolkit no longer writes a shard list (`.github/toolkit-test-shards.json`) or copies the test shards workflow and Shard Timings into other repositories, and no turn-on or binding pull request records `ci_shards`.
- The governed shard runner is gone: `run-tests.cjs --repo-root` is a usage error, `refresh-shard-timings.cjs` takes no `--branch` and refreshes only Toolkit's own shard manifest, and `repo/scripts/governed-test-shards.cjs`, `repo/scripts/toolkit-ci-shards-offer.cjs` and `repo/contracts/ci/governed-test-shards.yml` are removed.

### Changed

- A rules refresh pull request removes the test shards and Shard Timings copies (found by their Toolkit marker) and the shard list an older Toolkit left in a repository, each with one line saying why. The governance check names each one as a retired Toolkit file, so the session start asks for that refresh. A removal never passes the copy proof, so that pull request waits for the owner's merge.
- The binding key `ci_shards` is retired: it is still read, so a binding an older Toolkit wrote stays valid, and every binding writer (a switch pull request, the instruction copies cleanup) deletes its line in the file's own layout.
- The session start removes the shard offer's memory of closed shard pull requests (`ci-shards-closed.v1.json`) from Toolkit's user-state folder.
- The leftover file scan lists a retired test shards or Shard Timings copy wherever it is, governance on included.
- Toolkit's own shards, its shard manifest and its own Shard Timings workflow are unchanged.
