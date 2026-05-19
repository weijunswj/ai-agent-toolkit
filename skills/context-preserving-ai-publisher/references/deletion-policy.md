<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.context-preserving-ai-publisher
Source: _projects/repo-methodology/context-preserving-ai-publisher/_main/deletion-policy.md
Update the project source and run sync.
-->
# Deletion Policy

Deletion is a source-of-truth change. Treat it as higher risk than adding a generated output.

## Before Deleting

Identify:

- Owning project/module.
- Source file or generated output status.
- Manifest recipe.
- Published output path.
- Any pack, registry, MCP, skill, or template reference.
- Source-lock or provenance entry.
- Audit baseline entry.

## Safe Deletion Order

1. Remove or update references to the file.
2. Update the manifest.
3. Update source-lock or provenance notes.
4. Run sync.
5. Run generated freshness checks.
6. Run audits.
7. Inspect whether baselines need intentional movement.
8. Report the deletion and validation.

## Do Not Delete

Do not delete:

- Full source docs just because a generated copy exists.
- Compatibility shims without checking copied-doc links.
- Preserved source without updating provenance.
- Generated outputs manually when sync should remove or recreate them.
- Audit baselines to make checks pass.
- Safety docs, credential warnings, or live-action gates unless the task is explicitly to replace them with stronger rules.

## Retirement Instead Of Removal

When history matters, prefer retirement notes over silent removal. A retired source can remain in provenance metadata while no longer being an active upstream dependency.
