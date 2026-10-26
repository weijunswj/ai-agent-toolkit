# Changelog Fragments

An open branch keeps `main`'s Toolkit version and writes its notes here, in one file named after the branch with `/` replaced by `-` (for example `claude-fix-setup.md`). One file per branch means open branches never conflict on notes or version lines.

A fragment holds what a version entry in [CHANGELOG.md](../CHANGELOG.md) holds: `###` section headings and bullets. An optional first line `Title: <words>` adds words to the version heading, such as `## 3.16.0 (repository protection)`. Leave the `##` version heading out; it is added at merge time.

At merge time, after the branch has merged `main`, one command sets the next version, folds every fragment here under its heading, deletes the fragments, refreshes every copy of the version and bumps the Projects skill Version line if the branch changed that skill:

```text
node repo/scripts/bump-version.cjs --next patch
node repo/scripts/bump-version.cjs --next minor
```

Commit that as the branch's last commit, push it and wait for green CI before the merge. CI accepts a branch that holds its base's version, or one that sets exactly the next patch or minor version with its notes folded and no fragment left.
