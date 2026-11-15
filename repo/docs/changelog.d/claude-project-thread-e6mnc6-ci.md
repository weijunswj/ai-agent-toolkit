Title: light CI after main moves

### CI

- **Body edits stay light after main moves:** a pull request title or body edit used to rerun the whole Linux and Windows test matrix whenever `main` had moved since the last run, because the tested merge commit changed. The route job now also reuses an earlier run of the same head on an older base, but only when GitHub shows that run tested this head merged into a base commit today's base still contains, and the base moved no test file, shard manifest, workflow or dependency file. Only the newest run at the head that ran its tests can be reused: if it failed, the edit runs in full rather than reaching back to an older pass. The edit's run still checks the title, body and repository again. Any doubt runs in full.
- **The summary checks follow the choice:** the gate job's legs step names the tested commit it reused (`TESTED_COMMIT`), and both `--verify-ci` checks require exactly that commit.
- **Faster Toolkit validation:** the validator reads the topology policy once per run instead of once per checked review field, builds each retired-wording pattern once, and skips plain words when it looks for file paths. A full run takes about a quarter less time, which the copied-workspace tests feel on every case.
- **Topology tests split in two:** the copied-workspace topology tests took up to about 109 s of their 120 s budget on Windows. The retired-wording cases now run in their own file, so both halves run side by side well inside the budget.
