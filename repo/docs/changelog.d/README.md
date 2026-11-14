# Changelog Fragments

A branch writes its notes here and keeps `main`'s version; the Toolkit version bump happens once, at merge time. Use one file named after the branch with `/` replaced by `-`, for example `claude-fix-setup.md`. The pull request body names the level in one line, `Bump: patch`, `Bump: minor` or `Bump: major`. Nothing reads that line by machine: the merging agent checks it against the rule below, and a missing or wrong line is corrected at merge, not a blocker.

A fragment holds what a version entry in [CHANGELOG.md](../CHANGELOG.md) holds: `###` section headings and bullets, starting with the first `###` heading. An optional first line `Title: <words>` adds words to the version heading. Leave the `##` version heading out; the bump command adds it.

A branch with one `## Unreleased` section on top of the CHANGELOG may fold it like a fragment. Use `###` sections and bullets, with optional title words in `## Unreleased (<words>)`. Keep any notes main already holds there. New work uses fragments.

## Bump at merge time

The merging agent bumps just before the merge, never the builder. On the pull request branch, after merging main, one command sets the next version, folds every fragment and any `## Unreleased` section under its heading, deletes the fragments, refreshes every copy of the version and bumps the Projects skill Version line if the branch changed that skill:

```text
node repo/scripts/bump-version.cjs --next patch
node repo/scripts/bump-version.cjs --next minor
node repo/scripts/bump-version.cjs --next major
```

- **Patch or minor:** `minor` when the branch adds a feature, a skill, a command or a new rule; `patch` for fixes and wording.
- **Then:** commit that as the branch's last commit, push it, wait for green CI and merge that head. A clean main merge and the version-only commit need no new review; a source conflict gets a delta review. An owner merge card goes up at the bumped head.
- **Batches:** several merge-ready pull requests land as one merge train that bumps once, for all of them (below).
- **Why at merge:** a version taken by an earlier merge would otherwise force a re-bump, new CI and a stale merge card on every other open pull request.
- **Major releases:** use `--next major` for an owner-chosen major release.
- **Projects skill Version date:** the date is today's date in UTC, so a merge in the early morning east of UTC may carry the previous day's date.
## Merge trains

A merge train lands several reviewed pull requests with one bump and one CI run. Each member keeps its own commits and review: it boards at the exact head its review passed, as its own merge commit, and GitHub shows it as merged once the train merges. The train never carries a hand-made fix.

```text
node repo/scripts/toolkit-merge-train.cjs build --manifest train.json --branch toolkit-train/<name> --out boarded.json
node repo/scripts/toolkit-merge-train.cjs catchup --manifest boarded.json
node repo/scripts/toolkit-merge-train.cjs verify --manifest boarded.json --head toolkit-train/<name>
node repo/scripts/toolkit-merge-train.cjs body --manifest boarded.json
node repo/scripts/toolkit-merge-train.cjs land --manifest boarded.json --pr <train PR> --head <train head SHA>
```

- **Manifest:** each member's pull request number, reviewed head (full SHA), review link, tier, `Bump:` level, `UAT:` line, closing lines, any `Pack changes` lines (`pack_changes`, copied from the member's body when it boards) and, for RISKY members, the owner's typed merge OK. A train holds at most six members; later ready pull requests board the next train. Members hold main's version, like any open pull request.
- **Build:** run it in a worktree of its own; it refuses a branch checked out in another worktree. It merges each member head in order, ejects one that conflicts or is already on main, then runs the bump once at the highest member level. A bump that fails (a member already carrying its own bump) stops the build with a clean tree.
- **Rolling trains:** while a landing is in flight, ready pull requests board the next train with `build --onto <the landing's head>`, which takes no bump. Once that landing merges, boarding closes and `catchup`, run in a clean checkout of the train, merges main in as one merge commit and adds the one bump; no rebuild and no force-push. A main that does not merge cleanly is refused, so the clashing member is ejected. The next train opens at once, and a lone ready pull request merges on its own.
- **Verify:** proves the train holds only member merges and main catch-up merges identical to Git's own clean merge, plus one last commit identical to a fresh bump. It also lists the files two or more members change (`overlap`): with none, the train needs no review of its own once CI is green; shared files get a short delta review. Run it before pushing and again before the merge.
- **The train pull request:** its body is the `body` output under the usual header, so it lists every member, one `Bump:` line, the strictest `UAT:` line and every member's closing lines. When any member needs an owner test, closing lines become `Refs`: each member's own `Closes` line still closes its issue when the train lands. Its tier is the highest member tier.
- **Land:** re-runs verify and checks main has not moved, every member is open at its boarded head, the train pull request is at the given head and every RISKY member has the owner's OK. It then names the train pull request and the exact head to merge; it never merges. The merging agent merges that head by the usual route (`--match-head-commit`, a merge commit, the merge hold and any owner card).
- **Red CI:** never patch the train. `split --out-prefix half` writes two halves; rebuild and test each until the culprit is out, then land the rest.
- **While CI runs:** the stacked train above combines the next members early, so conflicts show before main frees. It takes no bump and cannot land until `catchup` brings main in. Open its pull request against the running train's branch, not main: it carries that train's bump while its own fragments wait, so against main the version check reports the fragments as not folded. Once the running train lands, point the stacked pull request at main, then run `catchup`.
- **Native merge queue:** GitHub offers it only to some organisation-owned repositories, and it cannot run this bump, so trains do not use it.

## When main moves

A pull request that holds main's version needs nothing when main moves. Only an older pull request that already carries its own bump falls behind; for those, the re-bump workflow below runs after each merge, and the hand command is its fallback:

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
