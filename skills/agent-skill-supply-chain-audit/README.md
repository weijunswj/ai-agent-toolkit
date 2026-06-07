<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.agent-skill-supply-chain-audit
Source: _projects/repo-methodology/agent-skill-supply-chain-audit/_main/skill/README.md
Update the project source and run sync.
-->
# Agent Skill Supply-Chain Audit

Audit third-party AI agent skills before importing or converting them into a source-owned toolkit.

Use this skill to turn "strip the unsafe stuff out" into a repeatable decision:

- Reject.
- Use as inspiration only.
- Convert with required edits.
- Safe to port after attribution.

The skill is intentionally passive. It does not install, run, import, clone, activate, deploy, publish, or execute third-party skill material by itself.

## Typical Inputs

- A GitHub repository or folder that contains `SKILL.md` files.
- A local skill folder, archive, or pasted `SKILL.md`.
- A candidate skill from Claude Code, Codex, Copilot, OpenClaw, Antigravity, Cursor, Gemini, or similar agent ecosystems.
- A request to convert a third-party skill into a toolkit project under `_projects/**` and generated `skills/**`.

## Expected Output

The audit should produce a concise verdict with:

- Sources inspected.
- License and attribution status.
- Unsafe or rejected material.
- Safe reusable material.
- Required conversion edits.
- Proposed `_projects/**` source placement and generated `skills/**` outputs.
- Validation and remaining risks.
