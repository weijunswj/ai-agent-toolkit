### Changed

- The governance question bank asks the parallel CI shards question in the first bank too, not only once governance is on. A yes or never needs governance turned on in the same answer and joins the one turn-on pull request: the binding records `ci_shards`, and a yes adds a first `.github/toolkit-test-shards.json` and the two shard workflows to that pull request.
- The shards question recommends Yes when the last green CI run took 10 minutes or more, and keeps Not now when CI is faster or its time is unknown. Its "More on" line says when Yes is recommended and where Yes puts the list and workflows.
- In a governed repository, an answer that changes task auto-merge or merge trains and also answers the shards question makes one binding pull request with both, instead of holding the shards answer for the next refresh.
- The turn-on pull request renders the shard workflows from its own `ci_shards` answer, not from this computer's last read of the merged binding.

### Fixed

- The minutes line says "1 runner minute", not "1 runner minutes".
