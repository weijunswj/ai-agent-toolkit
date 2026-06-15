# Codex SSH Hostinger Coolify Setup Maintainer

This module is first-party toolkit-authored material for a production-sensitive Codex SSH Hostinger VPS plus Coolify setup and maintainer workflow. It replaces the prior Hostinger/Coolify repository-preparation guide with setup, deployment, daily security check, upgrade advisory, maintenance, and incident response guidance that preserves owner approval gates.

It is separate from `n8n-local-setup`: that project keeps the local n8n guide and the n8n-specific Hostinger Coolify VPS deployment reference for use after Coolify exists.

Published skill identity: `codex-ssh-hostinger-coolify-setup-maintainer`.

For Hostinger VPS plus Coolify deployment setup/maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer`.

## Source layout

- [_main/](_main/) - preserved first-party workflow source.
- `_main/hostinger-coolify-production-guide.md` - full first-party workflow reference.
- `_main/skill/checklists/` - source checklists published into the skill folder.
- `_main/skill/templates/` - source evidence and approval templates published into the skill folder.
- `_main/skill/scripts/` - source daily security check scripts published into the skill folder.
- `curated_output_for_ai/skills/codex-ssh-hostinger-coolify-setup-maintainer/` - reviewed skill entrypoint and README.
- `toolkit.project.json` - source-to-surface publishing contract.
