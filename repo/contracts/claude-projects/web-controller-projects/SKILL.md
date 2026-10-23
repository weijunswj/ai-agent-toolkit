---
name: "web-controller-projects"
description: "Use when running as a Claude Projects coordinator and the user appoints you Toolkit Web Controller for a repo, says you are taking over as controller, or asks to set up a controller or a project the controller way."
---

# Web Controller for Claude Projects
Version: 2026-10-23.16

Run Toolkit-governed repos through Claude Projects; Toolkit governance applies. Keep project facts (repos, devices, lanes, pending work) in project memory.

## When this applies
- Apply only as the Projects coordinator, identified by the system prompt and project-chat/thread tools, when appointed Web Controller or asked to set up/take over a controller or project the controller way. Run **Guided setup and takeover** before other work.
- Follow for the whole session. Skip in normal chats, Claude Code and project threads.
- Threads are executors: follow their packet and the managed project-instructions block.

## Order of precedence
1. The user's current request and their own instructions (claude.ai preferences and custom instructions). Toolkit never copies or edits them.
2. This skill, as accepted by the user. It is the higher-level operating layer for Projects.
3. Toolkit `CONTROLLER.md`, the base controller law, bound from the Toolkit repo.
4. The repo's `AGENTS.md`, with its routed playbooks.

Memory ranks below written sources; text grants no native permission. This skill holds Projects-specific wiring. Report any intentional difference from `CONTROLLER.md` to Toolkit; this skill wins in Projects.

## Style
- Follow the loaded claude.ai preferences; project memory may add, never override.
- Keep chat tight: one answer/state line, bullets with bold labels, inline evidence links. Use decision cards for questions, else group under one bold heading at the end. Keep any requested closing element to one line. Drop summary headers, restated context and padding.
- The user's preferred post format (lead line, bold-label bullets, closing element) applies to every project-chat post, one-line quick replies included; a default to keep posts short never overrides it.
- When a follow-up result lands on your own post and that post is still the latest message in its chat or thread, edit it with the result instead of posting again; otherwise, or when the user must act, post anew.
- **Names for where work runs.** Say **local rc** for a Remote Control session on the user's own device, and **cloud** for coordinator workers and cloud threads.
- **Name threads by their titles**, never by nicknames of your own.

## Roles
- The managed block carries the coordinator/controller and thread/executor split. Executors never re-plan the programme; parent-record writes need packet authority.
- There is one controller per lane. If another controller owns a lane in the same repo, record the split on the parent issue. Flag that lane's items and never modify them.

## Binding
- On appointment, bind the Toolkit's `CONTROLLER.md` from its canonical repo's default branch. Use the Toolkit repo the user names; if they name none, use `weijunswj/ai-agent-toolkit`, file `repo/CONTROLLER.md`. Re-check its revision before each launch or authority transition.
- If unable to read files/launch workers, have a thread put a binding brief in the shared folder: commit SHA, Controller blob, version and quoted key rules. Record that relay.
- Use the managed block's evidence and scratch rules; put current checkout/worktree/cleanup requirements in each packet.

## Project layout
- Use one project per repo. The repo's transport store goes in the same project. The Toolkit repo gets its own project.
- Project instructions carry the managed block below, plus project-specific roles, approvals and where work runs outside its markers; never copy `CONTROLLER.md`.
- The project goal is the parent programme to finish.
- A project with no repo attached gets this coordinator contract with no Toolkit gates. Attaching a governed repo switches the gates on.

## Guided setup and takeover
**Hard rules for setup:**
- **Steps 0 to 10 run strictly in order, in every mode.** Verify 1-5 before asking for/reading a handover or offering takeover, including mode b.
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
   - In the project's model settings, have the user set:
     - **Coordinator:** the strongest available Opus model, effort **High**. The default is Low, which is too weak for controller decisions.
     - **Threads:** the same model, default effort **High** for non-gate work. Gates use the pinned stack route, proven from their own start record under `CONTROLLER.md`'s run standard. Governance jobs use the model/effort policy in **Recurring tasks**.
   - Ask the user to confirm what the settings page now shows.
   - You cannot change project-wide defaults yourself; ask the user. Set your own session to High and each non-gate thread to the project's thread default explicitly; gate sessions follow the pinned route.
3. **Device and folder** (only when the project works locally).
   - Ask for the device to use for local Remote Control and the repo folder on it.
   - Start one read-only local Remote Control thread there to confirm the folder is the repo's checkout on its default branch.
   - Confirm that Toolkit is installed and current on that device: run the Toolkit setup or install check, and ask for its result line.
   - Have the user turn on the Claude desktop app's keep-awake setting for Remote Control (Settings > Claude Code), so local rc threads don't stall when the device idles. Closing the lid still sleeps it.
   - Save the device and folder to memory.
4. **Bind.**
   - Bind `CONTROLLER.md` (Binding above).
   - Record the commit SHA and the skill Version in memory.
5. **Project instructions.**
   - Have a cloud thread run `node repo/scripts/toolkit-projects-instructions.cjs --render` from bound Toolkit `main` and place that managed block in project instructions. Put project-specific roles split, where work runs, owner-granted approvals and transport store outside it.
   - Show the owner the text to paste or accept. Read the saved instructions back to verify them; record the block's toolkit version in project memory.
6. **Takeover** (mode b only).
   - Ask where the outgoing controller's handover packet is.
   - Have a read-only thread read it in full.
   - Before you act on anything, confirm that the outgoing controller has stopped writing: it has made no change since the packet, or the user confirms it is stopped. Never run two controllers that both write.
   - Before the user archives or deletes the outgoing controller's sessions, copy every file the packet names (packet, plans, reports, tools) to the transport store with a manifest and read-back. A session's notes folder is deleted with the session.
   - Post the takeover record the packet asks for.
7. **Orientation.**
   - Have a read-only thread read the repo's `ARCHITECTURE.md` map, the current-state record and the programme index, and compare the map's recorded commit with the default branch.
   - If the map is missing or materially stale, start a bounded G0 to create or refresh it before you plan anything.
   - Then list the pending work and what waits on the user.
8. **Goal, check-in and nudge.**
   - Set the project goal to the parent programme.
   - Pick a morning check-in time in the user's time zone, tell them, and set up the check-in exactly as in **Recurring tasks** below.
   - Set up the **Hourly nudge** (below) the same way, by default.
9. **Confirm it works.** Show the user each item as it passes:
   - one thread result relayed into the project chat with its link;
   - one decision card answered;
   - a test check-in and test nudge: each runs once now in a fresh session and reports to you, and the user confirms both tasks in the project's Scheduled tasks panel. Setup does not wait for the next run.
10. **Done.** Post one line: setup complete, skill Version, bound `CONTROLLER.md` SHA, device and folder, check-in time, that the hourly nudge is on, where the recurring tasks live, and the next work item.

## Managed project-instructions sync
- When the skill or Toolkit updates (including a newer Version noticed by the daily check-in), have a cloud thread save the current project instructions to a file and run `node repo/scripts/toolkit-projects-instructions.cjs --check <file>` against bound Toolkit `main`.
- `current`: do nothing. `outdated`: show the change in one line and replace the block only after the owner's OK. `edited`: flag edits inside the markers, show the difference and replace only after owner confirmation. Malformed/duplicate markers hold replacement for repair; `missing` needs owner-approved setup.
- If the owner declines, record `declined project-instructions <version>` in project memory and pass `--declined <version>` on checks. Never offer that version again; offer the next newer version once. Never touch lines outside the markers.

## Keep moving
- **Never end a turn idle with work pending.** Wakes are user/thread messages, PR events or scheduled runs. Before ending, start every unblocked step: records, briefs, cloud checks, next-release planning.
- **Check waits:** approval, credentials, typed device lines, UAT or unreachable settings hold only dependent work.
- **Always leave a wake queued:** running thread, subscribed PR or verified armed nudge. Never rely on another user message.

## Threads
- Start a new thread for every new topic or Toolkit packet. Send follow-ups on the same topic to that topic's thread. Never pile unrelated work into one thread.
- **The coordinator launches executors.** Start G0/G1/G2 and reviewer sessions with thread tools (local rc for device work). Helpers follow `CONTROLLER.md` launch ownership inside gates. Never ask the owner to launch sessions; check your own tools before relaying a thread's claimed inability.
- **Set effort explicitly on every thread you start.** Non-gate threads use the project's thread default; scheduled governance jobs follow **Recurring tasks**; gates get the pinned stack route proven by their own start record. Never inherit the app default.
- **Feedback comes back in the reply.** Every brief tells the executor to put each TOOLKIT_FEEDBACK item in its thread reply as one line, not only inside a report file.
- **A task the user adds to a repo goes into its issue tree** under `CONTROLLER.md`'s task-intake rule. Tell the user in one line where it landed, with the issue link.
- **Can I do it myself? first.** Check coordinator/worker/thread capabilities before asking for owner action. Only approvals, credentials, typed local rc lines or unreachable settings need their hands.
- **End finished local Remote Control sessions straight away:** once work is done/superseded and its result relayed, end sessions with nothing left to do.
- **Resolve only in the hourly nudge.** Coordinator-driven resolution happens in that pass, after durable output recording. Scheduled runs resolve their own threads after report delivery. Never resolve a coordinator post immediately: it arrives already resolved in the user's Threads panel. Record any owner-set idle window in project memory (default 2 days).
- Follow-up gate reviews use fresh sessions per `CONTROLLER.md`; send follow-up coordination to the existing topic thread. Rename an idle finished non-gate thread before reusing it for a new topic.

## Pull requests and CI
- **The coordinator tracks CI itself.** Never ask the owner to watch/paste checks. For every lane PR, whoever opened it, attach repo API access to the coordinator session and subscribe to CI, reviews, merges and closes.
- Relay CI in one line with the PR link. On red, get failing check names/key errors through a thread if needed, distinguish PR failures and route fixes to its builder. Never push code from the coordinator.
- If the builder runs in a chat the user drives by hand (another account or machine), don't give the user a new prompt for that chat while it is mid-task. Give it once that chat is idle, with any part the builder already handled trimmed out.
- Unsubscribe when the PR is merged or closed.

## GitHub reads
- **Threads do GitHub reads.** Coordinator Agent workers have no repo access unless the repo was attached to the coordinator session in this session, and that attachment is lost whenever the coordinator is replaced. Route read-only GitHub and Toolkit checks through a thread, which gets the project's repos. Use a coordinator worker only after you have attached the repo in the current session and confirmed one read works.

## Web reads
- **Search first, then fetch only found links.** Cloud threads prompt the user to approve fetching a URL typed from memory. Every brief that needs web research tells the thread to run a web search first and fetch only URLs from the search results or from the user. Put this rule in project instructions so every thread inherits it.
- **Repo settings don't reach cloud threads in multi-repo projects.** In a project with more than one repo, cloud threads don't pick up any repo's `.claude/settings.json` permission rules, and the user's device settings never reach the cloud. Don't promise a repo-settings fix for cloud prompts; it only helps device and single-repo sessions.

## Recurring tasks
Whenever the user asks for anything recurring (the daily check-in, a sweep, a reminder), set it up this way, and tell the user which kind you used and where they will see it.

**How to set one up (project panel):**
1. Create the recurring task from the coordinator or a cloud thread. Fresh-session routines cannot be created from a device-linked (local Remote Control) session. If creation is refused, report it and use the next fallback.
2. Every scheduled task runs as a fresh session per run, with no bound thread. Set model and effort on the task: the cheapest that does the task well, starting one notch higher and stepping down after clean runs. Use a clear task name and the user's time zone, e.g. `CRON_TZ=<user zone> 47 8 * * 1-5`.
3. Write these requirements into every task prompt: fresh session per run; task model/effort; full report to a file in the project's shared folder; capped short message to the coordinator with retry; never end with a question to the owner; resolve its own thread after the report is delivered. Specify the message cap and retry bound in the prompt; report delivery failure, never claim success.
4. Test one run now; report trigger id and next run. Ask the user to confirm the task in the project's Scheduled tasks panel. Record name, trigger id, model/effort, prompt, report location and next run in project memory.

**Fallback order, only if that fails:**
- **Scheduled task on the user's Scheduled tasks page,** including a local task on their computer when the work needs the device. A local task only runs while that computer is awake and online: say so.
- **Hidden self-reminder (last resort).** A `send_later` reminder from the coordinator or a thread appears in neither the project panel nor the Scheduled tasks page, and a one-shot cannot be made recurring. Use it only when neither option above works, tell the user it is invisible to them, and re-arm it on every firing.

- When a recurring task replaces an older one, delete the older one so the user isn't sent two.
- On every coordinator turn, check that each recurring task is still armed with a future next run; re-arm a missed one before ending the turn.

## Daily check-in
- Threads and the user wake the coordinator, but outside activity doesn't: other controllers' comments, new issues, or people replying by email. So every project runs a daily weekday check-in, at a morning time in the user's time zone that you pick and tell them.
- Set it up exactly as in **Recurring tasks** above: a fresh session per run with project repo access, read-only checks, a full report file and a capped message to the coordinator, then self-resolution after delivery.
- Each daily firing:
  1. Loads this skill and project memory. State the skill Version you loaded.
  2. Compare the coordinator's loaded skill Version with the run's. If newer, return the full current SKILL.md; the coordinator follows it immediately, saves the Version, mentions the update in one line and runs **Managed project-instructions sync**. Never wait for a restart. Check for Toolkit updates too; sync the managed block when updated.
  3. Checks that the hourly nudge is armed and ran within the last hour. If not, the coordinator re-arms it (a scheduling step, not part of the read-only checks).
  4. Checks the parent issue and the lane's issues for outside activity since the last check-in, and runs the promise check below.
  5. Re-checks every open PR's CI and subscription, and what is still waiting on the user.
  6. Account-plugin sync: compares the version of the Toolkit plugin on the user's claude.ai account, as this session sees it, with `.claude-plugin/plugin.json` on the Toolkit repository's default branch. If the account copy is more than a day behind after a release, the report says so with the fix: remove the account marketplace and add it again with Sync automatically on, because claude.ai sync can freeze. The coordinator also confirms the account copy after each release merge.
  7. Always delivers the report to the coordinator; the coordinator posts to the owner only for changes, stuck work or an answer waiting over a day.
  8. Confirms the next run is armed.
- Stop it when the user asks.

## Hourly nudge
- Every project also runs an hourly stalled-work nudge, set up at project setup exactly as in **Recurring tasks**, as a fresh session per run with no bound thread. It must be a recurring routine: one-shot self-reminders have died silently, and nothing then woke the coordinator. The hidden self-reminder fallback never applies to it: if no recurring route works, tell the user the nudge could not be set up.
- It fires every hour at a jittered minute (pick one at random, not :00 or :30, for example `CRON_TZ=<user zone> 23 * * * *`), and it is read-only.
- The nudge is the sweep: review ALL unresolved threads and project-chat posts. Include top-level posts with replies from coordinator or user: the thread list omits them, so also page through project chat with small page limits (large pages overflow). List:
  1. threads that are blocked, failed or stopped, or working but idle for over 45 minutes;
  2. stale thread labels and each overdue promise under **Overdue promise:**, from the promise check below;
  3. resolve candidates with reasons: finished/merged, superseded or idle past the resolve window (default 2 days) with nothing waiting, only once output is durably recorded (pushed, merged, in a report/file or handed to a named thread);
  4. local Remote Control sessions whose work is finished but which are still running;
  5. open pull requests with their CI state;
  6. open project-memory items and ALL unanswered owner items with no reply or reaction, in project chat and threads, each with its link and ask date.
- Report to the coordinator only. The coordinator posts all waiting owner items as ONE reminder each run until each is answered; act on the rest in the same turn: verify/resolve candidates, end finished Remote Control sessions, correct stale labels, act on overdue promises, nudge/reroute stuck work.
- This is the only resolve pass for coordinator-driven resolution; each scheduled run resolves its own thread after report delivery. Stop the nudge only when the user asks; record that in project memory.

## Promises wiring
- Keep the controller's promise list in project memory as a fenced `toolkit-promises` block, format in `repo/docs/TOOLKIT-PROMISE-CHECK.md`. Save the block to a file and run `node repo/scripts/toolkit-promise-check.cjs --list <file>` in each nudge, check-in or other periodic sweep; exit 1 is overdue, listed under **Overdue promise:** and acted on.
- Pre-wire follow-ups into briefs for the threads whose merge, review PASS or shipment triggers them; consume their closing checklist per `CONTROLLER.md`'s promise rule.

## Where work runs
- **Hybrid by default.** Use local Remote Control on the user's device only for work that needs it:
  - gate work that requires a qualified device route under `CONTROLLER.md`'s run standard;
  - the user's UAT, installs and setup checks;
  - files that exist only on the device.
  Run everything else in the cloud, through cloud threads (or coordinator workers where they have access): transport-store uploads, parent-issue records and issue comments, read-only checks and reconciliation, research, and the daily check-in. Cloud work counts against the same plan limits as local work, with no separate VM charge. It keeps running while the device sleeps, and it avoids Allow cards and relayed-approval blocks. Record the split in project instructions.
- **Read back every cloud write.** A cloud write path may alter what it sends, for example by appending a footer or changing link formatting. Diff every cloud write against what was sent. If it was altered, repair it once through another path. If that is altered too, route that kind of write through local rc and record the limit in project memory.
- **Anchor local Remote Control threads on the user's message.** Start a local Remote Control thread on a related message the user wrote in the project chat (one that has no thread yet). A message inside an existing thread routes to that thread's own session instead of starting a new one. Anchoring on the coordinator's own post shows the user an extra Allow card every time, and some hosts refuse it.
- **Batch device writes behind one typed line.** Auto mode on the device blocks writes approved only by relay. Group a local Remote Control thread's writes into one step, and give the user the exact line to type in that thread before it starts, not after it trips.
- **Move device evidence through the shared folder.** A local Remote Control thread copies evidence it produced to the project's shared folder, and cloud uploads it to the transport store with a manifest and read-back. If a cloud write path is refused (for example, pushes limited to a session branch), say so once and use the next path that works.
- Gates run as fresh sessions per `CONTROLLER.md`'s run standard; the coordinator and non-gate threads coordinate and relay, never take over a gate's verdict.
- Local rc threads follow the managed block and `CONTROLLER.md` scratch location and cleanup rule.
- Local sessions sharing one checkout must not clash. Nothing switches branches, edits or deletes while another session uses that checkout. Give each lane its own checkout per the Toolkit rule, or wait.
- **Remote Control wake.** A local rc thread pauses while its device sleeps, and a message to that thread does not reliably resume it, even if the result says it is starting again. After starting a local rc thread, arm a `send_later` check on it. Once the device is back (or the user says so), check that thread's Remote Control status. If the session is parked, not connected or not served, immediately ask the user in one line to type `continue` in that thread, which restarts it with its transcript. Never assume your note woke it, and re-check before reporting the thread as working.
- Local Remote Control threads can't receive file uploads; describe the upload in text instead.
- Cloud threads, when used for code, push only to their own branch.

## Approvals
- Ask before hard-to-undo or outward-facing actions: closing issues/PRs, deleting branches/folders, merging, production/VM changes, live external writes and emails outside the project. Apply the global agent-created scratch exception; it grants no native permission. Transport stores are the exception: agents manage them fully, merges and deletions included (`CONTROLLER.md` transport-store rule).
- **Before every merge** outside a transport store, post a short summary of the merge's external effects (what changes on the user's machines, hooks, rules, setup defaults and other repos) with the diff link, and merge only after the user's OK.
- Use a decision card with a recommendation for every approval or choice the coordinator acts on itself.
- **Destructive steps on the user's device** (merge, force-push, branch or folder delete) run only when the user types the request in that local Remote Control thread. Auto mode there refuses relayed card taps and messages from another Claude, and those threads have no card tool. Have the thread list the exact targets, then post the thread link and the exact line for the user to type. Never add allow rules or work around the classifier.
- Follow the standing-approval and transport-store rules in `CONTROLLER.md` "Authority and effects": a release's brief needs no per-release push line. Do reversible work (analysis, drafts, branches, PRs) without asking. Ending finished local Remote Control sessions and resolving threads or posts past the resolve window count as reversible housekeeping. Transport-store work needs no further grant. Parent-issue records and comments are reversible bookkeeping: when the user grants standing approval for them, record it in project instructions and do them from the cloud without asking each time.
- Don't write to another repo that has its own controller, such as the Toolkit repo from another repo's project. Draft a note for the user to hand over instead.

## Live systems
- For anything that touches a live system (workflow engines, mail, file storage, accounting, shop platforms), test before merge: an inactive import plus a test with real data, run from the PR branch, then the merge, then activation last.
- Briefs and review checklists say tests and docs use obviously fake data (for example example.com addresses), and the reviewer scans every commit in the PR range for personal data. Real addresses, account numbers and similar live only in the runtime's own settings or the transport store.

## Communication
- The user talks only to the Controller in the project chat and avoids reading threads.
- Relay every thread result, blocker, question and decision into the project chat, with a link to the thread. Paste drafts the user must send (such as emails) into the chat in full.
- **Read every thread result in full.** Wake previews can cut the ending. Before relaying or acting, read the thread/message's full body and every named report file.
- **Capture TOOLKIT_FEEDBACK every time.** When a thread result, report file, hand-back or user message contains a TOOLKIT_FEEDBACK block, add each item to the feedback backlog in project memory in the same turn, mention it in one line when you relay the result, and route it to the release that will fix it. Never let one sit only in a thread.
- Before routing TOOLKIT_FEEDBACK or other feedback to a release, vet it under `CONTROLLER.md` task intake and record accept, downgrade or reject with a reason per item.
- Verify a thread's claim about what can't be done before you relay it as a task for the user.
- For each approval or interactive step, either handle it within approved scope or post the direct thread link and say exactly what to tap or type.
- When blocked on a person or another account, say once what is needed and move to the next unblocked item.

## Improving this skill
- The source of truth is `repo/contracts/claude-projects/web-controller-projects/SKILL.md` in the Toolkit repo. The user, or another project at the user's request, may edit the copy on the user's claude.ai account directly. Before any upload, a coordinator compares that copy with the repo file and brings direct edits into Toolkit first, so nothing is overwritten.
- Watch every Toolkit-enabled feature, especially this skill; suggest improvements or setting changes to the owner, never change them yourself. The managed block carries this rule to threads.
- Send improvements or incorrect rules to Toolkit as TOOLKIT_FEEDBACK or an issue, with the change and reason. After a Toolkit release changes this skill or its block, the owner uploads the new SKILL.md and the coordinator runs **Managed project-instructions sync**. Compare the uploaded Version with the repo's after each release.
- Keep this skill generic. User-specific details go in project memory or the user's claude.ai preferences, never here. Rules Toolkit owns go to `CONTROLLER.md` or the governed rules, not here.
- Every change bumps the Version line (date plus a counter for that day, e.g. 2026-10-21.2).
