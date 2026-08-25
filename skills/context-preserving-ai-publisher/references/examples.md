<!--
Canonical Toolkit reference. Edit this file directly.
Source: skills/context-preserving-ai-publisher/references/examples.md
-->
# Examples

These examples map the generic model to one reference implementation. They are not mandatory global structure.

## Generic Concept To Reference Implementation

| Generic concept | Reference implementation example |
| --- | --- |
| Source layer | `skills/**`, `repo/contracts/**`, and `repo/source-watch/provenance/**` |
| Reviewed adapter layer | `repo/contracts/**` and owning skill support files |
| Routing contract | `repo/contracts/agent-rules/toolkit-skill-routing.md` |
| Portable surfaces | `skills/**` |
| Local law/docs | `repo/docs/**` and `AGENTS.md` |
| Deterministic maintenance | retained managed-block synchronizers and validators |
| Source locks | `repo/source-watch/provenance/**/SOURCE-LOCK.json` |
| Audit baseline | `repo/docs/published-surface-audit-baseline.json` |

## Example: Full Reference Doc

A full guide belongs in its canonical skill or contract surface. The skill entrypoint should route to the local reference instead of summarising the guide.

## Example: Curated Skill Entrypoint

A `SKILL.md` file can be a short operational router. It should explain when to use the skill, what to inspect, and which local references or templates to load.

## Example: Compatibility Shim

If an exact-copied source guide links to `../README.md` but the published skill folder has a different layout, add a tiny shim at the expected published path. Do not rewrite the full guide just to change the link.

## Example: Maintenance Mode

In a repo that already has canonical surface standards and audit scripts, an agent should read those local rules first. This generic skill helps reason about source, adapters, provenance, and audits, but it does not replace the repo's own commands.
