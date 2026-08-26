# Surface Fidelity Audit

This audit verifies the direct canonical Toolkit surfaces. It does not rebuild, publish, or compare a second project tree.

## Current Surface

- `skills/**` contains the portable skill folders.
- `.codex-plugin/**` and `.claude-plugin/**` contain native plugin package metadata.
- `repo/contracts/**` contains machine contracts, templates, agent-rule inputs, and the Toolkit Local Bridge package source.
- `repo/source-watch/provenance/**` contains only active third-party attribution locks.
- No repo-wide `mcp/**` surface is shipped or maintained. Official n8n Skills and instance-level MCP references remain inside `skills/n8n-local-setup/`.
- No secondary routing metadata, duplicate package-build path, or privileged publication workflow is part of the maintained topology.

## Deterministic Audit

The direct-surface audit is backed by `repo/scripts/audit-published-surfaces.cjs`:

```powershell
node repo/scripts/audit-published-surfaces.cjs
node repo/scripts/audit-published-surfaces.cjs --check
```

The audit checks that every skill has a usable entrypoint and README/install note, that skill names match their folders, that native plugin metadata is present and internally consistent, that no retired `skills/knowledge-index-updater/` surface or pack manifest remains, and that no required local surface points back to the deleted project/publisher tree.

It does not call the network, execute external source, install packages, write generated outputs, or touch live n8n.

## Related Checks

- `node repo/scripts/audit-skill-portability.cjs` checks local skill references and required support files.
- `node repo/scripts/audit-project-source-locks.cjs` checks the active third-party provenance records.
- `node repo/scripts/validate-toolkit.cjs` checks the repository contract, routing, safety matrix, plugin version alignment, and forbidden files.
- `node --test repo/tests/skill-routing.test.cjs` checks routing and skill-table coverage.
