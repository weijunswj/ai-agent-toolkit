<!-- AI-AGENT-TOOLKIT:_projects/development/repo-auto-code/_main/templates/AGENTS.auto-code.managed.md:BEGIN REPO-AUTO-CODE v1 -->
## Toolkit Repo Auto-Code

- State: `ENABLED` only after repository-specific consent; otherwise `DISABLED`.
- Separate capabilities for this exact repository: `github_issue_governance: enabled` and `repo_auto_code: enabled`; generic consent is insufficient.
- Before every cycle, verify the healthy installed #299 governance skill, one canonical parent with the exact baseline, every direct material child exactly once, agreeing parent/child/PR projections, no reconciliation blocker or concurrent movement, and an actor authorised for the exact role. Failure is `AUTO_CODE_GOVERNANCE_UNREADY` and stops claim, pickup, prompt, substantive execution, G4, acceptance, merge, closure, and next-task selection.
- Protocol version: `1`.
- Canonical skill: `repo-auto-code`.
- Canonical rolling parent: `#<parent-number>`.
- Handoff markers: `[ ORCHESTRATOR TO EXECUTOR: START ]` / `[ ORCHESTRATOR TO EXECUTOR: END ]` and `[ EXECUTOR TO ORCHESTRATOR: START ]` / `[ EXECUTOR TO ORCHESTRATOR: END ]`.
- Fresh-chat reconstruction: every run rereads the exact repository, parent, child, enrolled PR, packet, claim, checks, reviews, and schedule state; it assumes no prior chat memory.
- PR enrolment: only a matching parent entry, child body, and PR body marker can authorise automated mutation.
- Web-controller ownership: the controller chooses Provider/Model/Reasoning, owns review mutation, and owns architecture, Design Locks, acceptance, and merge.
- Public-safe GitHub: names, booleans, presence/absence, and `[REDACTED]` only; never secret values, credentials, or environment dumps.
- Fail closed: if the skill, this block, routing, packet bindings, or authority is missing, malformed, duplicated, or contradictory, stop with `AUTO_CODE_SETUP_INVALID`, preserve bounded user work, and request source-owned controller/user repair. A cycle that fails governance readiness stops with `AUTO_CODE_GOVERNANCE_UNREADY`; an active `PARENT_RECONCILIATION_INCOMPLETE` also stops substantive execution, commits, pushes, and external mutation. Do not guess, self-authorise, install a fallback, or repair governance from an ordinary implementation cycle.
- A declared final whole-programme audit remains the last active item and is ineligible until all preceding material children are terminal; a blocked skip cannot bypass or move it. Only explicit owner/controller authority may change that invariant.

Do not place full prompts, historical packets, executor evidence, or a duplicate child issue in this block.
<!-- AI-AGENT-TOOLKIT:_projects/development/repo-auto-code/_main/templates/AGENTS.auto-code.managed.md:END REPO-AUTO-CODE -->
