Title: light CI after main moves

### CI

- **Body edits stay light after main moves:** a pull request title or body edit used to rerun the whole Linux and Windows test matrix whenever `main` had moved since the last run, because the tested merge commit changed. The route job now also reuses an earlier run of the same head on an older base, but only when GitHub shows that run tested this head merged into a base commit today's base still contains, and the base moved no test file, shard manifest, workflow or dependency file. The required check is not strict, so the pull request already stood on those results before the edit; the edit's run still checks the title, body and repository again. Any doubt runs in full.
- **The summary checks follow the choice:** the gate job's legs step names the tested commit it reused (`TESTED_COMMIT`), and both `--verify-ci` checks require exactly that commit.
