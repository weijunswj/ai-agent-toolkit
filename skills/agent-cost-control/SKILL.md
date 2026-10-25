---
name: agent-cost-control
description: Use when setting up or reviewing any scheduled task, routine, loop, automation, helper agent, subagent, spawned thread or workflow step that calls a model, when choosing its model or effort, or when agent usage costs too much. Picks the cheapest model tier and effort that can do the job, records every raise with its reason, and keeps long-running threads short by rotating them with handoff files. Coding gates keep their pinned routes.
---

# Agent Cost Control

Every automation and every non-gate worker starts on the cheapest model and effort that can do its job, set on purpose, never inherited from a default. Going higher needs a written reason. Works in any harness and with any model vendor.

## Ladder

| Step | Tier | Effort | Fits |
| --- | --- | --- | --- |
| 1 | Small | medium | Checks, sweeps, reminders, status reads, record keeping, anything someone verifies before acting on it |
| 2 | Mid | medium | Summaries across many sources, triage, drafting, routine helper work, tasks that drive automatic changes elsewhere |
| 3 | Top | high | Verdicts people act on without rechecking: vets, reviews, licence or security calls, controller decisions |

- **Medium is the floor.** Never pick the lowest effort a host offers; it skips checks on multi-step work. Where "medium" does not exist, use the closest setting above the lowest.
- **Set both, every time:** the model tier and the effort, in the place the host reads them (table below). A host with no effort setting gets the model alone and a note in the task saying "effort: not settable here".
- **Gates are outside the ladder.** G0, G1, G2 and reviewers keep the models, effort and routes their gate rules pin.

## Raising and lowering

- A step up needs one written reason, kept where the setting lives (the task prompt, the brief, the agent file or the workflow notes): it missed a check or got a fact wrong at the lower step (name the run); its output is a verdict people act on without rechecking; it carries security, licence, money or irreversible effects; or its input is too large or ambiguous for the smaller model (say what).
- **Raise straight away when output falls short.** When a controller sees a missed check, a wrong fact or a shallow review, it proposes the next step up at once, naming the task or thread, the run that fell short and the new model or effort. A task changes at its next rebuild; a thread is restarted on the new step.
- **Raises survive rebuilds.** Record each raise beside the task's record (`raised <tier>/<effort> <YYYY-MM-DD>: <reason>`). A rebuild or template update uses the higher of the template and the recorded raise, for model and effort separately, and never lowers it; only the owner or the controller removes a raise.
- **Step down** after about a week of clean runs at a raised step with no reason left: try one step lower.

## Where the setting lives

Model names change often: confirm the current names in the host before using them.

| Host | Small / Mid / Top | Model | Effort |
| --- | --- | --- | --- |
| Claude (Projects threads and tasks, Claude Code, routines) | Haiku / Sonnet / Opus | The thread or session model; a routine's model selector; a subagent file's `model` field | `/effort` or the session effort; a subagent file's `effort` field (levels depend on the model) |
| Codex | the account's small, standard and top models | `model` in config, or the automation's model menu | `model_reasoning_effort`; `[agents] default_subagent_reasoning_effort` for spawned agents (levels depend on the model) |
| OpenCode and other multi-vendor harnesses | the vendor's small, mid and top models | the agent's `model` (`provider/model`) | the model variant where the vendor offers one (`provider/model#variant`) |
| n8n nodes, CI steps and other workflow model calls | the vendor's small, mid and top models | the node or step setting | the node or step setting; the reason for a raise goes in its notes or a comment beside it |

A task that fires into a thread or session it is bound to runs on that thread's model and effort, not on what a task panel shows as its default. Start that thread on the task's tier, and check the served model in the run's own record.

## Threads and sessions

- **One job per thread or session.** A finished thread is never reused for new work, even on the same topic: start a new one and link the old one.
- **Rotate long-lived workers automatically** (integrators, review runners, record keepers, task home threads): after each milestone (a merge, a release, a finished review round), when the thread shows its context was summarised, or when its context use passes about 40% of the window. The old thread writes a short handoff file (state, open items, ids, next step, under about 2 KB) where the next one can read it, the controller starts a fresh thread on the same tier with a brief that points to that file, and the old one closes once its output is saved and relayed.
- **Never rotate the controller's own thread.** In plain chats the user starts a fresh chat now and then.
- **Briefs point to files.** Link plans, handoffs and reports by path; never paste history or earlier thread text.
- **Closing:** a work thread closes as soon as its output is saved and relayed and nothing is open for it. A chat reply thread closes after 6 hours with no new messages. A task's home thread is never closed. Host skills (for Claude Projects, `web-controller-projects`) say which pass does the closing.

## Output

When setting up or reviewing an automation, report per item: its step and tier, model and effort as set, the raise reason when it sits above the step its job fits, and any gap (unset model, inherited default, effort below medium, raise without a reason).
