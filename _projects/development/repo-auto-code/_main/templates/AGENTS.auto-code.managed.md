<!-- AI-AGENT-TOOLKIT:_projects/development/repo-auto-code/_main/templates/AGENTS.auto-code.managed.md:BEGIN REPO-AUTO-CODE v1 -->
## Toolkit Repo Auto-Code

- State: `ENABLED` only after repository-specific consent; otherwise `DISABLED`.
- Protocol version: `1`.
- Canonical skill: `repo-auto-code`.
- Canonical rolling parent: `#<parent-number>`.
- Handoff markers: `[ ORCHESTRATOR TO EXECUTOR: START ]` / `[ ORCHESTRATOR TO EXECUTOR: END ]` and `[ EXECUTOR TO ORCHESTRATOR: START ]` / `[ EXECUTOR TO ORCHESTRATOR: END ]`.
- Fresh-chat reconstruction: every run rereads the exact repository, parent, child, enrolled PR, packet, claim, checks, reviews, and schedule state; it assumes no prior chat memory.
- PR enrolment: only a matching parent entry, child body, and PR body marker can authorise automated mutation.
- Web-controller ownership: the controller chooses Provider/Model/Reasoning, owns review mutation, and owns architecture, Design Locks, acceptance, and merge.
- Public-safe GitHub: names, booleans, presence/absence, and `[REDACTED]` only; never secret values, credentials, or environment dumps.
- Fail closed: if the skill, this block, routing, packet bindings, or authority is missing, malformed, duplicated, or contradictory, stop with `AUTO_CODE_SETUP_INVALID`, preserve bounded user work, and request source-owned controller/user repair. Do not guess or install a fallback.

Do not place full prompts, historical packets, executor evidence, or a duplicate child issue in this block.
<!-- AI-AGENT-TOOLKIT:_projects/development/repo-auto-code/_main/templates/AGENTS.auto-code.managed.md:END REPO-AUTO-CODE -->
