<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/agent-skill-supply-chain-audit/README.md
-->
# Agent Skill Supply-Chain Audit

Audit third-party AI agent skills before importing or converting them into a source-owned toolkit.

Use this skill to turn "strip the unsafe stuff out" into a repeatable decision:

- Reject.
- Use as inspiration only.
- Convert with required edits.
- Safe to port after attribution.

The skill is intentionally passive. It does not install, run, import, clone, activate, deploy, publish, or execute third-party skill material by itself.

For approved conversions in this toolkit, pair the audit result with `context-preserving-ai-publisher`. This skill decides whether and what to convert; the publisher workflow handles the source-to-surface repo mechanics.

## Typical Inputs

- A GitHub repository or folder that contains `SKILL.md` files.
- A local skill folder, archive, or pasted `SKILL.md`.
- A candidate skill from Claude Code, Codex, Copilot, OpenClaw, Antigravity, Cursor, Gemini, or similar agent ecosystems.
- A request to convert a third-party skill into a Toolkit skill under `skills/**`, with provenance recorded under `repo/source-watch/provenance/**` when required.

## Expected Output

The audit should produce a concise verdict with:

- Sources inspected.
- License and attribution status.
- Unsafe or rejected material.
- Safe reusable material.
- Usefulness and token-bloat decision.
- Required conversion edits.
- Conversion handoff for the source-preserving publisher workflow.
- Proposed canonical `skills/**` placement and any required `repo/contracts/**` or provenance updates.
- Validation and remaining risks.
