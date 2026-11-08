# Web Controller for Claude Projects: setup extras

Reference for the `web-controller-projects` skill. The skill's precedence, style and approvals apply; where they differ, the skill wins.

## Generic journey first

Open the library's `takeover.md` first, copied from the [canonical takeover playbook](https://github.com/weijunswj/ai-agent-toolkit/blob/main/repo/docs/agent-playbooks/controller-takeover.md). Run its generic steps 1-10 in order, then P1-P6 below, in every mode: new controller, takeover or no repo. Do not duplicate the generic checklist here; preserve every `stopped by owner` entry. Save evidence and progress to memory after each step; resume verified progress after interruption. Never stop after the generic journey without these Projects steps.

No controller actions (records, gates or GitHub writes) until its last step except a setup step's own brief: generic step 7's record and claim, and guarded step 9b's task apply. These exceptions never allow general controller work or transfer identity to a thread. Evidence before done; unknown is incomplete. Show the combined checklist once, with evidence, applicability reasons or the exact dependent hold. Run independent work while owner-dependent effects wait. Do not guess UI locations or treat silence as verification.

## Projects notes on the generic steps

- Mode and repo: attach the exact named repo and its verified transport store, asking the owner only when settings are unreachable; read the default branch and a file. With no repo, keep coding gates and evidence-store state, no programme records.
- Toolkit current: check guidebook VERSION against a fresh Toolkit main copy using the guidebook reference; refresh under its safeguards. Check the actual device Toolkit before effects there. A failed refresh preserves the last usable copy, progress and every `stopped by owner` entry.
- Binding: save BINDING and GATE ROUTE from the exact bound Controller/stack and the owner's rule on where gates run. Keep folder and placement in step with it. No gate launch until that line and launch-route proof are present.
- Custody and orientation: use the first proven route for read-only state checks. Compare the outgoing writer's branch heads and latest comment ids twice, or obtain the owner's own direct confirmation. Never run two controllers that both write. Preserve every named file in the verified evidence store before sessions are archived; push and one fetch is Git custody read-back. Generic step 7, not a second Projects record, carries the takeover.
- Governance and tasks: use the first proven route on the actual device. All graph, sharding and scheduled-task checks require fresh merged ENABLED. With governance off, all other generic steps run. No pending proposal or memory line grants effects. Before a device is named, step 9b reports "not checked here" and P2 runs it when work runs on this device.

## Projects extras

P1. **Project memory on.** Have the owner turn it on only if the coordinator cannot. Verify by saving one entry and reading it back. Setup never asks the user to choose models or effort in the project's settings. Thread effort is never a project setting: every launch pins its own route under the skill; scheduled tasks start their home thread on the tier and effort in their prompt's params, which carry any recorded raise, preserving `stopped by owner`.

P2. **Device folder and keep-awake** (only when work runs locally).
- Use the named device and repo folder, else ask once. Have a read-only local Remote Control thread verify the checkout and default branch.
- When gates run on this device (placement `remote_control`), write the folder into the `GATE ROUTE:` line, which generic step 5 saved before the device was named. If generic step 9b reported "not checked here" for want of a device, run it on this device now, under its own fresh ENABLED guard and standing approval.
- Verify Toolkit is installed and current there through the supported read-only check. Installation or refresh remains subject to existing approvals and native permissions; preserve every `stopped by owner` entry.
- Have the owner enable the desktop app's keep-awake for Remote Control if that setting is unreachable (Settings > Claude Code). Closing the lid still sleeps it. Save device and folder to memory.

P3. **Project instructions, project lines and lanes.**
- A cloud thread renders `node repo/scripts/toolkit-projects-instructions.cjs --render` from bound Toolkit main, saves the block to the shared folder and reads it back.
- Draft only project facts: repos, transport, device/folder, work placement, owner-granted approvals and project-specific roles. Never copy base rules into those lines.
- Write `- Lanes: <n> working lanes (owner, <date>)` only when the owner gives a number. Otherwise tell them once that the project runs 1 lane at a time, and that "lanes 3" changes it.
- Block first, one blank line, project lines after; preserve and deduplicate existing owner text below it. Follow `reference/instructions-sync.md`: saved and read-back copy first, markers verified, conflicts held, final saved instructions read back. Record the block's Toolkit version.

P4. **Daily check-in and hourly nudge.**
- The goal comes from generic step 10. Pick a morning check-in time in the owner's time zone and tell them. Set up Daily check-in and Hourly nudge exactly through `reference/recurring-tasks.md`, rendered Toolkit prompts, and save/read back SCHEDULED TASKS. Preserve every `stopped by owner` entry in every mode.
- Only when `node repo/scripts/toolkit-governance.cjs status`, run on P2's actual device, confirms a fresh merged enabled binding and P2 named a device: also set up the **Programme sweep on a device** through the recurring-tasks reference, reusing the generic task check rather than creating a duplicate. A pending yes, open proposal, stale read or failed read grants no governance effects. With governance in any other state, or no device, do not create it or suggest it. An entry marked `stopped by owner` remains stopped. Cloud-only work cannot prove installed device tasks.

P5. **Confirm it works.** Read a thread result and relay it to project chat with its title link; get one native decision card answered; run a test check-in and test nudge now and read both full results, with the owner's confirmation in the Scheduled tasks panel. Do not wait for the next wake. When the programme sweep was armed, run once and read its result under the applicable approval; otherwise mark that check not applicable. Missing proof holds only the dependent extra.

P6. **Done and first post.** One completion line: skill version, bound Toolkit commit and Controller blob, device/folder, guidebook VERSION, check-in time, nudge state, programme sweep when armed, recurring-task home and next work item. Include any supplied-by-user evidence and dependent holds. Then post the board in the skill's current house format. Only after the generic journey and these extras are complete may normal controller work start.

## Repository governance
After the owner merges a governance decision, the coordinator immediately relays the merged decision to the named device lane. That lane reads fresh status from origin's default branch, runs `node <Toolkit>/repo/scripts/toolkit-windows-tasks.cjs plan --repo-root <repo>`, applies a verified mismatch with `node <Toolkit>/repo/scripts/toolkit-windows-tasks.cjs apply --repo-root <repo>` under standing approval, then reads back installed tasks, enrolments and the cleaner's first result. Update `SCHEDULED TASKS:` only after that read-back. A pending proposal never triggers a switch. If this chat has ended, nothing runs on its behalf. Session start on the device informs an agent when recorded Windows tasks mismatch fresh confirmed governance; the agent must follow the same fresh-status and plan/apply route within existing approval, asking the owner if needed. Offline or stale reads stay silent. An entry marked `stopped by owner` stays stopped; host denials still hold.
- Read the programme file from origin's default branch. It decides on or off on every device; project memory only mirrors that read. Historical local answers and unmerged files decide nothing.
- A confirmed undecided github.com repository holds for the owner's yes, no or later. Yes and no prepare one decision pull request through the shared proposal service; a matching open proposal is pending in every chat, not another yes/no question. Show its effects and checks, then ask the owner to merge it immediately. Missing adoption settings are owner choices, never invented.
- Governance decision pull requests always require the owner's typed `merge N`, even when task auto-merge is On. Proposals grant no authority.
- Later records no repository decision and asks next chat. If GitHub cannot be checked, ordinary work continues with a plain "couldn't check governance" note. No governance effects or standing task auto-merge until it can be checked. Direct eligible owner deliveries, replay receipts and local typed merge/native permission rules still apply.
