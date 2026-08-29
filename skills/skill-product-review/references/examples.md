<!--
Canonical Toolkit reference. Edit this file directly.
Source: skills/skill-product-review/references/examples.md
-->
# Examples

These examples show direct-canonical review and publication. They are subordinate to the target repository's local rules.

## Generic Concept To Reference Implementation

| Generic concept | Reference implementation example |
| --- | --- |
| Canonical product | `skills/**` |
| Canonical contracts and runtime | `repo/contracts/**`, `repo/scripts/**`, and `repo/tests/**` |
| Routing contract | target-repo routing source; Toolkit routing lives at `repo/contracts/agent-rules/toolkit-skill-routing.md` |
| Local law/docs | `repo/docs/**` and `AGENTS.md` |
| Source locks | `repo/source-watch/provenance/**/SOURCE-LOCK.json` or the target repo's declared source-lock path |
| Audit baseline | `repo/docs/published-surface-audit-baseline.json` |

## Example: Full Reference Doc

A full approved guide belongs directly in the canonical skill reference path. The skill entrypoint should route to that reference instead of replacing it with a lossy summary.

## Example: Curated Skill Entrypoint

A `SKILL.md` file is the canonical operational router. It should explain when to use the skill, what to inspect, and which local references or templates to load.

## Example: Adapted Third-Party Reference

If an approved source guide needs path or safety changes, keep the adapted file in the canonical skill folder, record the upstream blob and adaptation in the source lock, preserve attribution, and test its links.

## Example: Maintenance Mode

In a repository that already has ownership standards and audit scripts, read those local rules first. This generic skill helps reason about provenance, review evidence, canonical placement, and validation, but it does not replace the repository's commands.
