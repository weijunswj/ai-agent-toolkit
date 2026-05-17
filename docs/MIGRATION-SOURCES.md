# Migration Sources

Reviewed date: 2026-05-16.

Permanent docs use source repo names and source-relative paths. Local checkout paths are inspection-only and are not part of this migration record.

After this migration, `_projects/**/_main/` is canonical for retired internal migration sources. The personal source repos below remain in SOURCE-LOCK metadata as historical provenance only; they are not permanent public dependencies, are not source-watch targets, and may be deleted after migration. File-level `source_blob_sha` values remain local exact-byte drift checks.

Public attribution is not required for retired internal migration sources owned by `weijunswj`. Public attribution remains required for active third-party source material.

## `weijunswj/ai-agent-toolkit`

Inspected:

- `README.md`
- `.gitattributes`
- `design/**`
- `development/**`
- `portfolio/**`

Migrated:

- Existing design skill to `skills/design/ui-ux-secure-frontend-design/`.
- Existing Windows localhost skill to `skills/development/windows-localhost-workflows/`.
- Existing knowledge index skill to `skills/portfolio/knowledge-index-updater/`.
- Reusable skill metadata into `registry/skills.registry.json`.

Intentionally not migrated:

- Old root category README files.
- Old `AI Skills Templates` positioning.

Skipped for safety:

- None found.

Remaining:

- None inaccessible.

## `weijunswj/codex-n8n-local-setup`

Lifecycle:

- Historical migration input only.
- Not an active upstream dependency after migration.
- Not watched by source-watch planning.
- May be deleted after migration because `_projects/n8n/local-setup/_main/` is canonical.
- SOURCE-LOCK file hashes remain local provenance and drift checks.

Inspected:

- `README.md`
- `1. local setup.md`
- `2. upgrading.md`
- `3. tunneling guide.md`
- `3a. docker compose + ngrok.md`
- `4. vps hosting.md`
- `5. extra - claude code integration.md`
- `6. extra - opencode integration.md`
- `7. extra - antigravity integration.md`
- `templates/AGENTS.md`
- `templates/CLAUDE.md`
- `templates/GEMINI.md`
- `templates/partials/ai-coding-agent-execution.md`
- `templates/partials/n8n-mcp-rules.md`
- `templates/*-mcp-config.md`
- `scripts/build-templates.ps1`
- `.github/workflows/build-templates.yml`
- `scripts/windows/start-n8n-ngrok.bat`

Migrated:

- Platform setup guidance into `guides/ai-agent-platforms/`.
- n8n local setup, upgrade, tunnelling, Docker Compose + ngrok, VPS, workflow sync, and credential safety guidance into `guides/n8n/`.
- Agent-rule partials from `_projects/n8n/local-setup/_main/templates/partials/` plus the linked root toolkit partial `templates/agent-rules/partials/skill-routing-rules.md`; root `templates/agent-rules/*.md` files are generated from declared concat recipes.
- MCP config templates into `templates/mcp-configs/`.
- Deterministic agent-rule generator into `scripts/build-agent-rule-templates.ps1`.
- CMD generator wrapper into `scripts/- build-agent-rule-templates.cmd`.
- Scoped generated-template CI behavior into `.github/workflows/build-agent-rule-templates.yml`.

Intentionally not migrated:

- Source repo navigation that belongs only to that repo.
- Local-machine-specific prose.
- Large runtime launcher script as trusted toolkit runtime.

Skipped for safety:

- `scripts/windows/start-n8n-ngrok.bat` was not copied as a runtime launcher.
- `.github/workflows/build-templates.yml` was not copied directly. Its behavior was replaced with a scoped workflow that may auto-commit only generated agent-rule outputs on same-repo PR branches and never on `main`.

Remaining:

- None inaccessible.

## `weijunswj/ai-cicd-installer`

Lifecycle:

- Historical migration input only.
- Not an active upstream dependency after migration.
- Not watched by source-watch planning.
- May be deleted after migration because `_projects/cicd/secure-installer/_main/` is canonical.
- SOURCE-LOCK file hashes remain local provenance and drift checks.

Inspected:

- `README.md`
- `.gitignore`
- `templates/n8n/*.cjs`
- `templates/n8n/*.ps1`
- `templates/n8n/*.cmd`
- `docs/n8n/n8n-credential-migration-map.example.json`
- `tests/n8n-helper-scripts.test.js`

Migrated:

- Security-first CI/CD installer concepts into `guides/cicd/secure-cicd-installer.md`.
- Prompt and status template material into `templates/cicd/`.
- n8n helper-template scripts into `templates/n8n/sync-helpers/`.
- Credential migration-map example into `templates/n8n/workflow-policy/`.
- Test concepts into toolkit tests.
- Reusable n8n helper tests into `tests/n8n-helper-scripts.test.cjs`.

Intentionally not migrated:

- Product-specific CI/CD generation promises.
- Direct deployment enablement.
- Broad commit, push, PR, and merge automation outside generated-template parity.

Skipped for safety:

- Helper scripts are stored only as review-required template assets. They may write scoped local outputs in consumer repos after review.
- No live import/export commands were run.

Remaining:

- None inaccessible.

## `weijunswj/n8n-workflow-templates`

Lifecycle:

- Historical migration input only.
- Not an active upstream dependency after migration.
- Not watched by source-watch planning.
- May be deleted after migration because `_projects/n8n/workflow-templates/_main/` is canonical.
- SOURCE-LOCK file hashes remain local provenance and drift checks.

Inspected:

- `README.md`
- `.gitignore`
- `.gitattributes`
- `scripts/sanitise-n8n-template.ps1`
- `scripts/prepare-n8n-template.js`
- `scripts/- sanitise-n8n-template.cmd`
- `templates/00-error-handler/00-error-handler.template.json`

Migrated:

- Sanitizer workflow and staging-folder rules into `templates/n8n/README.md`.
- Sanitizer scripts into `templates/n8n/sanitizer/`.
- Template hygiene guidance into the n8n workflow sync skill references.
- Dry-run and sanitizer smoke test coverage into `tests/n8n-helper-scripts.test.cjs`.

Intentionally not migrated:

- `.to-sanitise/`.
- `.sanitised/`.

Skipped for safety:

- `templates/00-error-handler/00-error-handler.template.json` was not migrated in v1 because it is a full workflow JSON with Code, Google Sheets, email, and Telegram behavior.

Remaining:

- None inaccessible.

## `nextlevelbuilder/ui-ux-pro-max-skill`

Lifecycle:

- Active third-party attribution source.
- Public MIT attribution is required.
- Source updates require strict allowlist, draft/manual review, and local-only script checks.

Inspected:

- Public GitHub repo, README, license, selected scripts, and selected data files.

Migrated:

- Selected CSV data into `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/`.
- Selected local-only adapted script material into `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/scripts/`.
- Root design generator scripts and data through declared project recipes and source locks.
- Third-party attribution notes into `tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md`.

Intentionally not migrated:

- CLI tools.
- Generated templates.
- Assets.
- Screenshots.
- Package metadata.
- Install commands.

Skipped for safety:

- Package metadata, dependency/install flow, non-allowlisted data, and non-local tooling.

Remaining:

- Ongoing third-party updates require manual review and strict allowlist checks.
