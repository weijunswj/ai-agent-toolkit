# Examples

These examples map the generic model to one reference implementation. They are not mandatory global structure.

## Generic Concept To Reference Implementation

| Generic concept | Reference implementation example |
| --- | --- |
| Source layer | `_projects/**/_main/` |
| Reviewed adapter layer | `_projects/**/curated_output_for_ai/` |
| Manifest/routing contract | `_projects/**/toolkit.project.json` |
| Portable generated surfaces | `skills/**` and `mcp/**` |
| Local law/docs | `repo/docs/**` and `AGENTS.md` |
| Deterministic publishing | `repo/scripts/sync-toolkit-projects.cjs` |
| Source locks | `_projects/**/SOURCE-LOCK.json` |
| Audit baseline | `repo/docs/published-surface-audit-baseline.json` |

## Example: Full Reference Doc

A full guide belongs in the source layer and publishes into a skill reference with an exact recipe. The skill entrypoint should route to the copied reference instead of summarising the guide.

## Example: Curated Skill Entrypoint

A `SKILL.md` file can be curated because it is a short operational router. It should explain when to use the skill, what to inspect, and which local references or templates to load.

## Example: Compatibility Shim

If an exact-copied source guide links to `../README.md` but the published skill folder has a different layout, add a tiny shim at the expected published path. Do not rewrite the full guide just to change the link.

## Example: Maintenance Mode

In a repo that already has project standards and audit scripts, an agent should read those local rules first. This generic skill helps reason about source, adapters, manifests, and generated outputs, but it does not replace the repo's own commands.
