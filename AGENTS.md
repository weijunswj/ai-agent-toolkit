# AI Agent Toolkit Repo Rules

This repo is the canonical reusable AI Agent Toolkit. It owns reusable skills, guides, templates, packs, registries, and MCP design documents.

## What Belongs Here

- Reusable AI skills under `skills/`.
- Product-neutral guides under `guides/` and `docs/`.
- Agent-rule, MCP config, n8n helper, and CI/CD templates under `templates/`.
- Installable bundle manifests under `packs/*/pack.json`.
- JSON-only discovery registries under `registry/`.
- Future-facing MCP design documents under `mcp/`.

## What Does Not Belong Here

- Product repo code.
- Customer or business workflow JSON.
- Trading app code.
- Credentials, credential exports, credential binding files, private keys, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, or live n8n import/export files.
- Auto-merge, auto-commit, or production deployment automation.

## Validation

Before reporting completion, run the relevant checks:

```powershell
node scripts/validate-toolkit.cjs
node --test tests/*.test.cjs
node scripts/package-skills.cjs --check
node scripts/package-packs.cjs --check
```

For the full migration validation sequence, see `MIGRATION_CHECKLIST.md`.

## n8n Safety

Do not run live n8n import, export, activation, deactivation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo unless a future user request explicitly asks for that live action and confirms the target instance.
