# Fast CI Delivery

Use this when CI feels slow, when pull requests wait long for checks, or when designing or changing a workflow. The goal is the shortest wait from push to a trusted green check. Speed never costs a security gate or coverage: never skip, sample or delete a test or a security check to go faster, and keep every required check running on every pull request.

## Measure First

Wall time is queue time plus run time, and on GitHub-hosted runners queue time is often the bigger part. Before changing anything, read the last 100 to 200 runs of the slow workflow through the GitHub Actions API and write down:

- **Runs per head commit:** more than one means edits, re-runs or cancels are repeating work.
- **Cancelled runs and their cause:** a new commit (useful) or a title, body or label edit on the same commit (wasted).
- **Jobs per run:** count matrix legs; each leg is a job.
- **Queue and run time per job:** queue is `started_at` minus `created_at`; run is `completed_at` minus `started_at`. Take the median and the 90th percentile.
- **Peak jobs running at once:** compare it with the account's concurrent job cap.
- **Setup step times:** checkout, toolchain and install, before adding any cache.

Run the CI check-up (`ci-checkup.md`): its `speed.*` rows flag edits that rerun heavy jobs, concurrency that keeps stale runs or cancels useful ones, and runs that take more than half the account's job slots.

## Concurrent Job Cap

GitHub-hosted runners run at most a fixed number of jobs at once per account: Free 20, Pro 40, Team 60, Enterprise 500, with macOS jobs capped lower (GitHub's Actions limits page). The cap is shared by every repository and workflow of the account. When one run starts as many jobs as the cap, a second pull request waits for a whole run to finish. Set `concurrent_jobs` in `.github/ci-checkup.json` when the plan is not Free.

## Fixes, Cheapest First

Prefer free fixes. A paid plan raises the cap (Pro doubles it), which cuts queueing, but it is the owner's account decision, never a default.

1. **Light edit runs:** a title, body or label edit should run only the checks that read that text (pull request text guards, issue-closure checks). Put them in their own small workflow that keeps `edited`, and leave `edited` out of the heavy workflow, or skip heavy jobs when `github.event.action` is `edited`. If the required check covers both, let it reuse the passing results of the same head commit instead of rerunning them. This changes a required check, so plan it at the risk tier that check needs.
2. **Concurrency that cancels only stale work:** for pull requests, group by workflow and pull request number and cancel the older run when a new commit arrives. Never key a pull request group on the commit SHA: every commit gets its own group, so stale runs are never cancelled and keep their slots. Never let an edit cancel the full run on the same commit: `cancel-in-progress: ${{ github.event_name == 'pull_request' && github.event.action != 'edited' }}` makes an edit wait as the pending run while a new commit still cancels, or split edits out as above. That same expression keeps default-branch pushes from cancelling each other; a group keyed on the run id for pushes works too.
3. **Fewer, fuller jobs:** every job waits in the queue and repeats its setup. Group short jobs and short matrix legs (under about a minute of real work) into one job that runs them in sequence, keeping one clear step per check so a failure still names its check. Keep long test shards separate; they are what parallelism is for.
4. **Path filters for docs-only changes:** skip test jobs when a change touches only docs, but never with a workflow-level `paths` filter on a workflow that holds a required check: GitHub leaves the skipped check "Pending" and the pull request cannot merge. Decide inside the workflow instead (a first job that lists the changed files, later jobs with `if:`), so the required check still reports.
5. **Balanced shards:** split by measured per-file time from one manifest, never by file count, and rebalance only when shard times drift apart (fast-tests-and-sharding playbook in governed repositories).
6. **Caching only where setup is slow:** add a dependency or build cache only when the measured setup step takes a real share of the job. A cache that saves seconds adds a key to keep right and a poisoned-cache risk; never cache on `pull_request_target` or share a cache that untrusted code can write.
7. **Flake hunting:** a flaky test costs a whole re-run. Track re-runs and failures that pass on retry, fix the cause (clocks, temp folders, ordering, timeouts), and never hide it with retries, `continue-on-error` or a skip.

## Worked Example: The Toolkit, November 2026

Measured from 200 runs of the Toolkit's own Validate workflow (3,073 jobs) on a Free account:

- 67% of pull request runs were cancelled, 95 of 131 by an edit on the same commit, so each head commit ran 2.3 times on average.
- One run is 20 jobs, exactly the Free cap, and 18 or more jobs were running 53% of the time.
- Successful runs took 34 minutes at the median, yet each job ran 0.1 to 5.4 minutes: 7 to 18 minutes of each job's median wait was queue.
- Setup steps took 2 to 25 seconds per job and the shards were already balanced within about a minute, so caching and rebalancing would gain almost nothing.

The ranked fixes followed: light edit runs first (about half of all jobs), then grouping nine short Windows jobs into four or five (frees slots, removes no test), then folding two small pull request text jobs into one. A Pro plan would double the cap at once but was left to the owner. Caching and shard rebalancing were measured and dropped.
