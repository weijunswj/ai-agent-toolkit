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

The first command only reports. Agree branch custody with the current builders before applying. The lane uses existing GitHub authentication, repository read access and branch-write permission. The hand command creates no credentials. Reconciliation waits for the computer's next wake if it is offline.

### The re-bump workflow

In this repository the workflow `.github/workflows/toolkit-rebump.yml` runs the same apply command after every push to `main`, so the hand command above normally finds nothing left to do and reports `unchanged`. Setup never copies this workflow into another repository.

- **Push key:** the workflow pushes with the repository secret `TOOLKIT_REBUMP_TOKEN`, a fine-grained personal access token limited to this repository with contents read and write. The owner creates the token and adds the secret by hand, under the repository's Settings, Secrets and variables, Actions. GitHub starts a pull request's checks by themselves only for a push made with such a token: a push made with the built-in token leaves the checks waiting for a person to approve them, and checks from a manually dispatched run do not count for a pull request.
- **No key:** the run prints a note, re-bumps nothing and ends green. The hand command is then the only route.
- **Whose pull requests:** only the repository owner's open, same-repository pull requests that carry a version bump. Drafts, forks, bot pull requests and other authors are skipped before any of their code runs.
- **What the key can reach:** the run checks out `main` only. The pull request branch's own bump and validation scripts run with every token variable removed from their environment, and the push goes to that pull request's own branch, never to `main` and never forced. A script on that branch could still read the key from the parent process on the runner; that gap is accepted because those branches are written with the owner's own sign-in already. The key itself is wider than the command: it can write any branch the owner can, `main` included unless a ruleset stops the owner, so treat it like the owner's own sign-in for this repository. When a re-bump merge brings a changed workflow file from `main` into a branch, GitHub may refuse the push unless the token also has the Workflows permission; the pull request is then held as a push that failed or is uncertain (the comment does not name the permission), and the hand command finishes it.
- **A hold:** the pull request gets one comment that names the reason, edited in place by later runs and marked as cleared once a later run re-bumps it. A hold does not fail the run; a run that cannot produce a report does.
- **Unpushed local work:** when the workflow pushed to a branch first, the builder's next push is refused as not fast-forward. Pull, which makes a merge commit, and push again.
- **Expired key:** the run fails where it signs in. Renew the token and update the secret, or use the hand command.

The script compares each head version with its merge-base version to prove exactly one patch, minor or major step. It reapplies that level above main in a separate clone, using the fragment flow for the branch's new release entry and keeping main's released entries byte for byte. It skips drafts, forks, non-main targets and branches without a bump. Queued auto-merge, ambiguous versions, edited historical notes, source conflicts, failed validation or a changed main/head hold the affected branch. Only version fields, generated stamps and the new CHANGELOG entry are resolved automatically. A successful apply makes an ordinary fast-forward push to the existing branch.

On a hold, the builder reconciles the reported problem before a new report. Read the remote before retrying an uncertain push. Re-run CI and route the complete delta for fresh G2 review; keep the previous review on its old head and record retained or affected UAT separately. The script never merges, approves or accepts a pull request.

CI accepts a branch that holds its base's version with the base's `##` headings (plus at most one `## Unreleased` on top), or one that sets exactly the next patch, minor or major version with that heading on top, the base's headings below it and no fragment left.
