# AI Agent Toolkit Repo Rules

This repo is the canonical reusable AI Agent Toolkit. Keep the topology simple:

- `_projects/` preserves canonical human/source material. Full original docs and guides live in `_projects/**/_main/`.
- `for_ai/` contains AI-facing published surfaces: skills, MCP design notes, templates, packs, registries, tools, and operator playbooks.
- `repo/` contains repo maintenance assets: docs, scripts, tests, validation policy, and CI support.

## What Belongs Here

- Reusable AI skills under `for_ai/skills/`.
- AI/operator playbooks under `for_ai/playbooks/`.
- Agent-rule, MCP config, n8n helper, and CI/CD templates under `for_ai/templates/`.
- Installable bundle manifests under `for_ai/packs/*/pack.json`.
- JSON-only discovery registries under `for_ai/registry/`.
- Future-facing MCP design documents under `for_ai/mcp/`.
- Local-only tooling under `for_ai/tools/`.
- Repo policy, scripts, and tests under `repo/`.

## What Does Not Belong Here

- Product repo code.
- Customer or business workflow JSON.
- Trading app code.
- Credentials, credential exports, credential binding files, private keys, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, or live n8n import/export files.
- Auto-merge, auto-commit, or production deployment automation.

## Documentation Rules

- Humans should use `_projects/**/_main/` for full source docs and original guides.
- `_projects/**/README.md` files should stay tiny landing cards.
- `for_ai/playbooks/` may contain concise AI/operator routing notes, but it must not compete with `_projects/**/_main/` as the canonical source layer.
- Do not edit preserved source docs inside `_projects/**/_main/` unless needed for safety or broken internal references caused by a refactor.

## Validation

Before reporting completion, run the relevant checks:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/package-packs.cjs --check
python -m unittest discover -s for_ai/tools/design-system-generator/tests
git diff --check
```

## n8n Safety

Do not run live n8n import, export, activation, deactivation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo unless a future user request explicitly asks for that live action and confirms the target instance.
