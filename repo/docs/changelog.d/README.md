# Changelog Fragments

An open branch keeps `main`'s Toolkit version and writes its notes here, in one file named after the branch with `/` replaced by `-` (for example `claude-fix-setup.md`). One file per branch means open branches never conflict on notes or version lines.

A fragment holds what a version entry in [CHANGELOG.md](../CHANGELOG.md) holds: `###` section headings and bullets, starting with the first `###` heading. An optional first line `Title: <words>` adds words to the version heading, such as `## 3.16.0 (repository protection)`. Leave the `##` version heading out; it is added at merge time.

A branch that already keeps its notes in one `## Unreleased` section at the top of the CHANGELOG may keep it there, written like a fragment (`###` sections and bullets); `## Unreleased (<words>)` adds those words to the version heading. The merge step folds it in like a fragment. New branches use a fragment, which never conflicts. Any other change to the CHANGELOG's `##` headings, such as a branch's own version heading, is refused.

## At merge time

After the branch has merged `main`, one command sets the next version, folds every fragment and any `## Unreleased` section under its heading, deletes the fragments, refreshes every copy of the version and bumps the Projects skill Version line if the branch changed that skill:

```text
node repo/scripts/bump-version.cjs --next patch
node repo/scripts/bump-version.cjs --next minor
```

- **Patch or minor:** `minor` when the branch adds a feature, a skill, a command or a new rule; `patch` for fixes and wording.
- **Then:** commit that as the branch's last commit, push it and wait for green CI before the merge.
- **Major releases:** `--next` never sets a major version. A major release is the owner's decision, and the script changes first in its own reviewed change.
- **Projects skill Version date:** the date is today's date in UTC, so a merge in the early morning east of UTC may carry the previous day's date.
- **If `main` moves first:** revert the bump commit, merge `main` again and run `--next` again, so the number is still the next free one.

CI accepts a branch that holds its base's version with the base's `##` headings (plus at most one `## Unreleased` on top), or one that sets exactly the next patch or minor version with that heading on top, the base's headings below it and no fragment left.
