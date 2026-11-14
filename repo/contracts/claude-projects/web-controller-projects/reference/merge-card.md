# Web Controller for Claude Projects: merge card

Reference for the `web-controller-projects` skill, opened by the merge thread before it posts an owner merge card, and again before it merges on the tap. The skill's precedence, style and approvals apply; where this file and the skill differ, the skill wins.

An owner tap is good for one merge attempt. Anything that starts a required check after the tap (a body or title edit, a push, a programme page refresh that edits the body) makes GitHub refuse the merge, and the refused attempt spends the tap, so the owner has to tap again and the queue waits for another CI run.

## Before the card
1. Bring the branch current: merge `main` in, run `bump-version.cjs --next <level>` from the body's `Bump:` line, push, and wait for green CI.
2. Run `node repo/scripts/toolkit-auto-merge-eligible.cjs --base <base SHA> --head <head SHA> --body-file <PR body>` at that head. Fix every body line it names (the UAT line must read `NOT_REQUIRED`, `OWNER_TEST_NEEDED` or `PASSED`) and finish every other body edit now: strip platform footers, update the summary and the external-effects note.
3. Wait for the Validate run those edits started to go green.
4. Run `node repo/scripts/toolkit-merge-card-ready.cjs --repo <owner/name> --pr <n> --head <full SHA>`. Post the card only on exit 0, and keep the body sha256 it prints. Exit 1 names what to fix or wait for; exit 2 means GitHub or git could not be read, so nothing is ready.

## After the tap
- Edit nothing on the pull request until it lands or GitHub refuses it: no body or title edit, no push, no footer strip, no programme page write to its body.
- Just before merging, run the readiness check again with `--body-sha <the sha256 from the card step>`. On exit 0, merge with `--match-head-commit <full SHA>`. On exit 1 (the head or body moved), do not merge: say why, wait for green, run the card step again and post a fresh card.
- Once it lands or is refused, the usual post-merge steps resume, body edits included.
