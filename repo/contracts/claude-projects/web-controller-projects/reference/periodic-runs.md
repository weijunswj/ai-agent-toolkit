# Web Controller for Claude Projects: periodic runs

Reference for the `web-controller-projects` skill, opened when the coordinator acts on a daily check-in or hourly nudge report, or rebuilds either task's home thread. The skill's precedence, style and approvals apply; where this file and the skill differ, the skill wins. A bold section name, such as **Hourly nudge**, names a section of the skill.

## Acting on the check-in report
- Its report's first line carries these prefixes, in this order. Act on each the same turn:
  - `CONTEXT RESET DUE`: rebuild the check-in and its home thread as **Hourly nudge** describes, unless its entry says `stopped by owner`.
  - `GUIDEBOOK MISSING` or `SKILL COPY STALE`: the check-in refreshed the library copy itself (**Guidebook copy**). On "block changed", apply the block as BLOCK CHANGED says; on `SKILL COPY FAILED`, follow **Guidebook copy**.
  - `SKILL UPDATE`: the guidebook's Version is newer than the one on the BINDING line. Read the new `SKILL.md` now, update the scheduled tasks' prompts where it says they changed (**Recurring tasks**), skipping a task whose entry says `stopped by owner`, record the Version on the BINDING line and say so in one line; never wait for a restart.
  - `BLOCK OUTDATED` (including `misplaced` and `overlaps`): **Managed project-instructions sync**.
  - `BINDING STALE` or `BINDING UNKNOWN`: rebind (**Binding**). When current, the report says `**Binding:** current` with the short blob, adding the newer short commit when only the commit moved.
  - `TOOLKIT CHANGED`: note the new version; the block and plugin checks follow from it.
  - `MEMORY FORMAT`: rewrite only the named Toolkit line.
  - `TASKS OUTDATED`: swap each named Toolkit-made task (**Recurring tasks**), never one whose entry says `stopped by owner`; add an `unlisted` task to the line.
  - `RELAY GAP`: a task run older than an hour has no matching `<run UTC>.relayed` file. Skip tasks marked `stopped by owner`; handle each remaining run without `.done` using **Task run relay** in `reference/recurring-tasks.md`: post only without `.relayed`, write it after success, finish every prefix action, then write `.done`.
  - `NUDGE NOT ARMED`: rebuild the hourly nudge and its home thread (**Hourly nudge**), without asking; a deleted nudge is rebuilt the same way, unless its `SCHEDULED TASKS:` entry says `stopped by owner`.
  - `PROJECT TASKS MISSING` (Toolkit project only): another project lost its check-in or nudge, not one its entry marks `stopped by owner`. Tell the owner once which; that project's coordinator recreates them on its next wake (**Both gone**), never this one.
  - `PLUGIN BEHIND`: the Toolkit plugin on the user's claude.ai account is more than a day behind `main`. No agent can update it: once per version, post one plugin card in the project chat with the check-in's steps, the four numbered steps it puts under **Plugin:**, copied as written. Keep it pending until a check-in shows `**Plugin:** current`. Also confirm the account copy after each release merge.

## Hourly nudge home thread
- Guards for the nudge's home thread:
  - Never resolve the home thread or list it as a resolve candidate; the nudge never resolves it either.
  - Each run is self-contained (it re-reads memory and files) and replies in one line when nothing changed.
  - The daily check-in reports NUDGE NOT ARMED when its last run is over 65 minutes older than the latest time its own cron should have fired (hours outside its waking window never count; a nudge that fires less often uses its interval plus 5 minutes) or its home thread is resolved, and TASKS OUTDATED `weekly-rebuild` once the home thread is a week old. A run of either bound task (the nudge or the check-in) that reports `CONTEXT RESET DUE` asks for a rebuild of that task: new home thread and task, with the prompt rendered as in the swap (**Recurring tasks** step 2, so a recorded raise is carried), test run, then delete the old task. Note each rebuild in memory. None of this applies once its entry says `stopped by owner`.
  - For a template update (never for a nudge marked `stopped by owner`), ask the home thread to update its own task's prompt, then read it back with `get_trigger` and `--check`; if that fails, rebuild.
  - If the bound nudge dies twice in 7 days, switch that project to a fresh-session nudge every 2 hours (rendered with `session` `fresh`, its entry saying fresh) and tell the owner; never for a nudge marked `stopped by owner`.

## Reconcile Toolkit release branches

After each merge in the Toolkit repository, and on a check-in or nudge when main differs from the last reconciled commit, ask an available computer lane to run `node repo/scripts/toolkit-rebump-prs.cjs --apply`. Default mode only reports. Agree custody with the current builders before applying. While the computer is offline, keep reconciliation pending until its next wake; there is no Actions trigger. Follow **Approvals** for the existing GitHub permissions and branch writes.

The script compares the merge-base version with the head to prove exactly one patch, minor or major step and reapplies that level above main. It verifies the signed-in GitHub account and origin, using existing read and branch-write permissions without creating credentials. It skips drafts, forks, non-main targets and branches without a bump; queued auto-merge holds. In an isolated clone it resolves only version fields, generated stamps and the branch's new release entry through the fragment flow, keeping main's released entries byte for byte. Ambiguous versions, source conflicts, edited historical notes, failed validation or changed main/head hold the affected branch. Successful apply only fast-forwards the existing branch and never merges or accepts the pull request. Return holds to their builders, then run a fresh report after repair. Never blindly retry an uncertain push. Track the returned head, rerun CI there and request fresh G2 review of the complete delta. Keep old reviews on their old heads and record retained or affected UAT separately. Record the reconciled main commit only after accounting for every result.

## Acting on the nudge report
- The nudge is the sweep: review ALL unresolved threads and project-chat posts. Include top-level posts with replies from coordinator or user: the thread list omits them, so also page through project chat with small page limits (large pages overflow). List:
  1. threads that are blocked, failed or stopped, or working but idle for over 45 minutes;
  2. stale thread labels and each overdue promise under **Overdue promise:**, from the promise list (**Promises wiring**);
  3. resolve candidates meeting all three resolve conditions (**Threads**), with the evidence for each;
  4. local Remote Control sessions whose work is finished but which are still running;
  5. open pull requests with their CI state;
  6. open project-memory items and ALL unanswered owner items with no reply or reaction, in project chat and threads, plus your answers in reply threads with no owner reply or reaction since, each with its link and ask date;
  7. `UNRELAYED`: threads resolved in the last day, or finished open ones, whose latest result never reached project chat; `HIDDEN REPLY`: an owner reply in a closed post thread with no answer, or your answer there with no top-level pointer;
  8. whether the daily check-in exists and is armed;
  9. the guidebook: it checks the copy against a fresh clone of main each run and refreshes a stale library copy itself (**Guidebook copy**), reporting `BLOCK CHANGED` or `SKILL COPY FAILED` on its first line.
- `UNRELAYED TASK RUNS`: skip tasks marked `stopped by owner`; handle each remaining run without `.done` the same turn using **Task run relay** in `reference/recurring-tasks.md`: post only without `.relayed`, write it after success, finish every prefix action, then write `.done`.
- `LANES UNDER CAP`: start queued items the same turn until the lane cap is full or a real limit holds, and say which limit when one does.
- `CHECK-IN NOT ARMED` (including a deleted check-in): recreate it from the template the same turn, without asking, as in **Recurring tasks**, unless its entry says `stopped by owner`.
- **Both gone:** the two tasks watch each other, but if both are deleted nothing fires. So on the first owner message or wake of each day, call `list_triggers` once (a cheap read); if either Toolkit task is missing and its entry does not say `stopped by owner`, start a cloud thread that recreates it from the template on `main` (rendered as in the swap, **Recurring tasks** step 2), fires it once and updates the `SCHEDULED TASKS:` line, and tell the owner once.
