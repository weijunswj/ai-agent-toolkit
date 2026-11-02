# Changelog Fragments

A branch writes its notes here before preparing its own Toolkit version bump. Use one file named after the branch with `/` replaced by `-`, for example `claude-fix-setup.md`.

A fragment holds what a version entry in [CHANGELOG.md](../CHANGELOG.md) holds: `###` section headings and bullets, starting with the first `###` heading. An optional first line `Title: <words>` adds words to the version heading. Leave the `##` version heading out; the bump command adds it.

A branch with one `## Unreleased` section on top of the CHANGELOG may fold it like a fragment. Use `###` sections and bullets, with optional title words in `## Unreleased (<words>)`. Keep any notes main already holds there. New work uses fragments.

## Prepare the branch bump

After merging main, one command sets the next version, folds every fragment and any `## Unreleased` section under its heading, deletes the fragments, refreshes every copy of the version and bumps the Projects skill Version line if the branch changed that skill:

```text
node repo/scripts/bump-version.cjs --next patch
node repo/scripts/bump-version.cjs --next minor
node repo/scripts/bump-version.cjs --next major
```

- **Patch or minor:** `minor` when the branch adds a feature, a skill, a command or a new rule; `patch` for fixes and wording.
- **Then:** commit that as the branch's last commit, push it and wait for green CI before the merge.
- **Major releases:** use `--next major` for an owner-chosen major release.
- **Projects skill Version date:** the date is today's date in UTC, so a merge in the early morning east of UTC may carry the previous day's date.
## When main moves

After each merge in this repository, the merging agent runs the apply command below, or asks a computer lane to run it if it has no computer:

```text
node repo/scripts/toolkit-rebump-prs.cjs
node repo/scripts/toolkit-rebump-prs.cjs --apply
```

The first command only reports. Agree branch custody with the current builders before applying. The lane uses existing GitHub authentication, repository read access and branch-write permission. No credentials or Actions workflow are created. Reconciliation waits for the computer's next wake if it is offline.

The script compares each head version with its merge-base version to prove exactly one patch, minor or major step. It reapplies that level above main in a separate clone, using the fragment flow for the branch's new release entry and keeping main's released entries byte for byte. It skips drafts, forks, non-main targets and branches without a bump. Queued auto-merge, ambiguous versions, edited historical notes, source conflicts, failed validation or a changed main/head hold the affected branch. Only version fields, generated stamps and the new CHANGELOG entry are resolved automatically. A successful apply makes an ordinary fast-forward push to the existing branch.

On a hold, the builder reconciles the reported problem before a new report. Read the remote before retrying an uncertain push. Re-run CI and route the complete delta for fresh G2 review; keep the previous review on its old head and record retained or affected UAT separately. The script never merges, approves or accepts a pull request.

CI accepts a branch that holds its base's version with the base's `##` headings (plus at most one `## Unreleased` on top), or one that sets exactly the next patch, minor or major version with that heading on top, the base's headings below it and no fragment left.
