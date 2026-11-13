Title: merge trains
### Added

- **Merge trains:** `repo/scripts/toolkit-merge-train.cjs` lands several reviewed pull requests with one version bump and one CI run. Each member boards at the exact head its review passed, as its own merge commit, so it keeps its own commits and review. `verify` refuses anything else in the train, `land` checks live heads, main and RISKY owner OKs and names the one head to merge, and a conflict, moved head or red CI ejects a member instead of patching the train.
