<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/skill-product-review/README.md
-->
# Skill Product Review

Review third-party AI agent skills before import or adaptation, then publish only approved material with source identity, licence, attribution, source locks, and direct canonical ownership preserved.

Use this skill to turn "strip the unsafe stuff out" into a repeatable decision:

- `allow`.
- `reject`.
- `constrain`.

The skill is intentionally passive. It does not install, run, import, clone, activate, deploy, publish, or execute third-party skill material by itself.

For approved conversions, follow the target repository's documented canonical ownership and validation workflow. In this Toolkit, approved material is maintained directly under `skills/**` and `repo/**`; this audit decides whether and what to convert without requiring a separate project or publisher handoff.

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
- Canonical target-repository handoff and placement.
- Proposed `skills/**` placement and any required `repo/**` contract or provenance updates.
- Validation and remaining risks.
