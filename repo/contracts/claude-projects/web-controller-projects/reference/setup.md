# Web Controller for Claude Projects: guided setup and takeover

Reference for the `web-controller-projects` skill, opened when the coordinator runs setup or takes over a controller. The skill's precedence, style and approvals apply; where this file and the skill differ, the skill wins.

## Guided setup and takeover
**Hard rules for setup:**
- **Steps 0 to 10 run strictly in order, in every mode.** Verify 1-5 before reading the outgoing controller's state or offering takeover, including mode b.
- **Show the checklist once:** all eleven steps, done with evidence, skipped with reason or to do.
- Run independent steps back to back; post only for a needed owner action/choice/confirmation and once at completion. Each post: one status line, one evidence line per newly finished step, one exact tap/type request and recommendation. No per-step headings/recaps; requested closing element once.
- **Evidence before "done":** checked read-back, full thread result or owner confirmation of an unseen result. Save evidence/progress to memory after each step; resume there after interruption. Skip only verified completed steps, with a one-line reason.
- **No controller actions until step 10:** no records, gates or GitHub writes; read-only setup threads are allowed.
- Before posting, return to any unfinished earlier step. For owner-dependent steps, explain what/where/why in one or two lines, wait, verify directly or through a read-only thread, then continue. Never guess UI locations; ask what the owner sees when unsure.

0. **Mode.** Ask which applies, unless the user already said:
   - (a) a new controller for a repo;
   - (b) taking over from an existing controller (another chat, Claude Code session or project);
   - (c) a project with no repo.

   State the skill Version you loaded.
1. **Project and repos.**
   - Confirm this project is for one repo.
   - Have the user attach that repo, plus its transport store if Toolkit defines one.
   - Verify by reading the repo's default branch and one file.
2. **Project memory and models.**
   - Have the user turn project memory on. Verify by saving one memory entry and reading it back.
   - Ask for one setting only: in the project's model settings, the **coordinator** gets the strongest available Opus model, effort **High** (the default Low is too weak for controller decisions). Ask the user to confirm what the settings page now shows.
   - Thread effort is never a project setting: you set it on every thread you start (**Threads** in the skill), gates get their pinned route, and scheduled tasks set theirs in the prompt.
3. **Device and folder** (only when the project works locally).
   - Ask for the device to use for local Remote Control and the repo folder on it.
   - Start one read-only local Remote Control thread there to confirm the folder is the repo's checkout on its default branch.
   - Confirm that Toolkit is installed and current on that device: run the Toolkit setup or install check, and ask for its result line.
   - Have the user turn on the Claude desktop app's keep-awake setting for Remote Control (Settings > Claude Code), so local rc threads don't stall when the device idles. Closing the lid still sleeps it.
   - Save the device and folder to memory.
4. **Bind.**
   - Bind `CONTROLLER.md` (**Binding** in the skill).
   - Write the binding line (**Binding** in the skill).
5. **Project instructions.**
   - Have a cloud thread run `node repo/scripts/toolkit-projects-instructions.cjs --render` from bound Toolkit `main`, save the block to the shared folder and read it back. Every project on one Toolkit version gets the same block.
   - Draft the project lines from the setup answers: repos and transport store, device and folder, where work runs, owner-granted approvals, project-specific roles. Only facts that differ by project, nothing the block says.
   - Write the instructions as the block first, one blank line, then the project lines; text a project already had goes below the block, deduped. Apply it with the safeguards in **Managed project-instructions sync** (`reference/instructions-sync.md`). Read the saved instructions back to verify them; record the block's toolkit version in project memory.
6. **Takeover** (mode b only).
   - There is no handover packet: ask where the outgoing controller's work lives (its branches and PRs, the programme issue comments when ENABLED, its evidence store and, for a Projects controller, its project memory).
   - Have a read-only thread read those in full.
   - Before you act on anything, confirm that the outgoing controller has stopped writing: it has made no change since you read its state, or the user confirms it is stopped. Never run two controllers that both write.
   - Before the user archives or deletes the outgoing controller's sessions, copy every file its records name (plans, reports, tools) to the transport store (in a Git store the commit is the manifest and a push plus one fetch the read-back). A session's notes folder is deleted with the session.
   - Post the one-line takeover record (`CONTROLLER.md` Takeover).
7. **Orientation.**
   - Have a read-only thread read the repo's `ARCHITECTURE.md` map, the current-state record and the programme index, and compare the map's recorded commit with the default branch.
   - If the map is missing or materially stale, start a bounded G0 to create or refresh it before you plan anything.
   - Then list the pending work and what waits on the user.
8. **Goal, check-in and nudge.**
   - Set the project goal to the parent programme (GitHub governance ENABLED), or to the user's stated goal.
   - Pick a morning check-in time in the user's time zone and tell them. Set up the **Daily check-in** and the **Hourly nudge** (both in the skill) exactly as in **Recurring tasks** (`reference/recurring-tasks.md`), with prompts rendered from Toolkit, and write the `SCHEDULED TASKS:` memory line. On a takeover, skip a task whose existing entry says `stopped by owner` and keep that entry.
9. **Confirm it works.** Show the user each item as it passes:
   - one thread result relayed into the project chat with its link;
   - one decision card answered;
   - a test check-in and test nudge: each runs once now and reports to you, and the user confirms both tasks in the project's Scheduled tasks panel. Setup does not wait for the next run.
10. **Done.** Post one line: setup complete, skill Version, bound commit and `CONTROLLER.md` blob, device and folder, check-in time, that the hourly nudge is on, where the recurring tasks live, and the next work item.
