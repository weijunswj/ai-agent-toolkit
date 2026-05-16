# Migration Checklist

Keep this file until validation passes and the user explicitly approves final cleanup.

## Scope And Audit

- [x] Scope confirmation: reusable toolkit assets only.
- [x] Product repo code excluded.
- [x] Customer/business workflow JSON excluded.
- [x] Trading app code excluded.
- [x] Current repo audit completed.
- [x] Source repo inspection completed for local checkouts.

## Skills

- [x] Design skill repaired.
- [x] Design skill moved to `skills/design/ui-ux-secure-frontend-design/`.
- [x] Windows localhost skill moved to `skills/development/windows-localhost-workflows/`.
- [x] Portfolio knowledge index skill moved to `skills/portfolio/knowledge-index-updater/`.
- [x] Automation skill created at `skills/automation/n8n-workflow-sync/`.
- [x] Old root skill folders removed after moves.

## Source Migration

- [x] `weijunswj/ai-agent-toolkit` migration documented.
- [x] `weijunswj/codex-n8n-local-setup` migration documented.
- [x] `weijunswj/ai-cicd-installer` migration documented.
- [x] `weijunswj/n8n-workflow-templates` migration documented.
- [x] `nextlevelbuilder/ui-ux-pro-max-skill` inspiration-only use documented.
- [x] Inaccessible items documented.
- [x] Safety skips documented.

## Repository Areas

- [x] Root identity docs updated.
- [x] Docs created.
- [x] Guides created.
- [x] Templates created.
- [x] Packs created.
- [x] JSON registries created.
- [x] MCP design docs created.
- [x] Scripts created.
- [x] Tests created.
- [x] CI/CD workflows created.
- [x] Safe update policy created.

## Format And Safety

- [x] Registries use JSON only.
- [x] Pack manifests use `pack.json` only.
- [x] No registry YAML target references.
- [x] No pack YAML manifests.
- [x] `.gitignore` blocks unsafe local files and generated artifacts.
- [x] No credentials, credential exports, credential bindings, `.env`, `.n8n-local/`, `.tmp/`, private keys, or live import/export files added.
- [x] Generated package artifacts are not committed.

## Final Validation

- [x] `git status --short --branch`
- [x] `node --check scripts/validate-toolkit.cjs`
- [x] `node scripts/validate-toolkit.cjs`
- [ ] `pwsh -NoProfile -File scripts/build-agent-rule-templates.ps1` blocked locally because `pwsh` is not installed; `powershell -NoProfile -File scripts/build-agent-rule-templates.ps1` passed.
- [x] `node --test tests/*.test.cjs`
- [x] `node scripts/package-skills.cjs --check`
- [x] `node scripts/package-packs.cjs --check`
- [x] `git diff --check`

## Cleanup

- [x] Old root skill folders removed.
- [x] Source repo archive/delete policy documented.
- [ ] Final user approval received before deleting `MIGRATION_CHECKLIST.md`.
