Title: Work queue named at session start

### Changed

- The Claude Code and Codex session-start attention line now names the longest-stalled work-queue task, its code, when it was flagged and its next step, read from this computer's attention cache.
- A task natively blocked by another open task on the graph that is itself moving is no longer raised as idle; a blocker written only on the page is answered by a dispose naming it.
- A refresh that could not read every open pull request raises no work-queue findings.
- Work-queue rows show the acknowledged marker for a stalled-task finding acknowledged before acknowledgements were refused.
- The controller takeover playbook says a work-queue finding takes an action or a dispose, never an acknowledgement.
