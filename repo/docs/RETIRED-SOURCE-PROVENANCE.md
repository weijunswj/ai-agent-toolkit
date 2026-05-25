# Retired Source Provenance

Reviewed date: 2026-05-16.

This is a historical provenance record for retired internal source repos and the active third-party attribution source used by this toolkit. It is not an active migration plan.

Permanent docs use source repo names and source-relative paths. Local checkout paths are inspection-only and are not part of this provenance record.

`_projects/**/_main/` is canonical for retired internal source material. The retired internal repos below remain in SOURCE-LOCK metadata as historical provenance only; they are not active dependencies, are not source-watch targets, and may be archived or deleted outside this repo. File-level `source_blob_sha` values remain local exact-byte drift checks.

Public attribution is not required for retired internal source repos owned by `weijunswj`. Public attribution remains required for active third-party source material.

`SOURCE-LOCK.json` source repo names, commits, source paths, and blob hashes are retained as provenance and local drift checks.

Retired internal source locks are not forced into active third-party scheduled-watch rules. They must keep `source_update_policy: "none"` and remain provenance-only records.

## `weijunswj/ai-agent-toolkit`

Inspected:

- `README.md`
- `.gitattributes`
- `design/**`
- `development/**`
- `portfolio/**`

Migrated:

- Existing design skill to `skills/ui-ux-secure-frontend-design/`.
- Existing Windows localhost skill to `skills/windows-localhost-workflows/`.
- Existing knowledge index skill to `skills/knowledge-index-updater/`.
- Reusable skill metadata into `mcp/registry/skills.registry.json`.

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
- Not an active upstream dependency.
- Not watched by source-watch planning.
- May be archived or deleted because `_projects/n8n/local-setup/_main/` is canonical.
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
- `skills/n8n-local-setup/templates/agent-rules/AGENTS.md`
- `skills/n8n-local-setup/templates/agent-rules/CLAUDE.md`
- `skills/n8n-local-setup/templates/agent-rules/GEMINI.md`
- `skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md`
- `templates/partials/n8n-mcp-rules.md`
- `skills/n8n-local-setup/templates/mcp-configs/*-mcp-config.md`
- `repo/scripts/build-templates.ps1`
- `.github/workflows/build-templates.yml`
- `repo/scripts/windows/start-n8n-ngrok.bat`

Migrated:

- Platform setup guidance into `skills/n8n-local-setup/references/ai-agent-platforms/`.
- n8n local setup, upgrade, tunnelling, Docker Compose + ngrok, VPS, workflow sync, and credential safety guidance into `skills/n8n-local-setup/references/n8n/`.
- Generic AI coding agent execution rules into `_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md`.
- Toolkit skill-routing rules into `_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md`.
- n8n MCP workflow safety rules into `_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md`; the generated `skills/n8n-agent-rules/` skill now owns and publishes the full n8n operating ruleset. The local setup skill references it instead of owning the full rules.
- MCP config templates into `skills/n8n-local-setup/templates/mcp-configs/`.
- Deterministic agent-rule generator into `repo/scripts/build-agent-rule-templates.ps1`.
- CMD generator wrapper into `repo/scripts/_build-agent-rule-templates.cmd`.
- Scoped generated-template CI behavior into `.github/workflows/build-agent-rule-templates.yml`.

Intentionally not migrated:

- Source repo navigation that belongs only to that repo.
- Local-machine-specific prose.
- Large runtime launcher script as trusted toolkit runtime.

Skipped for safety:

- `repo/scripts/windows/start-n8n-ngrok.bat` was not copied as a runtime launcher.
- `.github/workflows/build-templates.yml` was not copied directly. Its behavior was replaced with a scoped workflow that may auto-commit only generated agent-rule outputs on same-repo PR branches and never on `main`.

Remaining:

- None inaccessible.

## `weijunswj/ai-cicd-installer`

Lifecycle:

- Historical migration input only.
- Not an active upstream dependency.
- Not watched by source-watch planning.
- May be archived or deleted because `_projects/cicd/secure-installer/_main/` is canonical.
- SOURCE-LOCK file hashes remain local provenance and drift checks.

Inspected:

- `README.md`
- `.gitignore`
- `templates/n8n/*.cjs`
- `templates/n8n/*.ps1`
- `templates/n8n/*.cmd`
- `repo/docs/n8n/n8n-credential-migration-map.example.json`
- `repo/tests/n8n-helper-scripts.test.js`

Migrated:

- Security-first CI/CD installer concepts into `skills/secure-cicd-installer/references/secure-cicd-installer.md`.
- Prompt and status template material into `skills/secure-cicd-installer/templates/cicd/`.
- n8n helper-template scripts into `_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/`, published as `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/`.
- Credential migration-map concepts into n8n workflow helper safety references; live/local binding files remain ignored and are not published as reusable template data.
- Test concepts into toolkit tests.
- Reusable n8n helper tests into `repo/tests/n8n-helper-scripts.test.cjs`.

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
- Not an active upstream dependency.
- Not watched by source-watch planning.
- May be archived or deleted because `_projects/n8n/workflow-toolkit/_main/` is canonical.
- SOURCE-LOCK file hashes remain local provenance and drift checks.

Inspected:

- `README.md`
- `.gitignore`
- `.gitattributes`
- `repo/scripts/sanitise-n8n-template.ps1`
- `repo/scripts/prepare-n8n-template.js`
- `repo/scripts/- sanitise-n8n-template.cmd`
- `_projects/n8n/workflow-toolkit/_main/workflow-templates/error-handling/global-error-handler.template.json`

Migrated:

- Sanitizer workflow and staging-folder rules into `skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/README.md`.
- Sanitizer scripts into `skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/`.
- Template hygiene guidance into `skills/n8n-workflow-templates/templates/README.md`.
- `global-error-handler.template.json` into `skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json`.
- Dry-run and sanitizer smoke test coverage into `repo/tests/n8n-helper-scripts.test.cjs`.

Intentionally not migrated:

- `.to-sanitise/`.
- `.sanitised/`.

Safety review:

- `global-error-handler.template.json` remains the intended reviewed template name and is published only as an inactive, generic, credential-free workflow template.
- No live import/export JSON, credential bindings, webhook IDs, credential IDs, `.env`, `.n8n-local`, `.tmp`, private keys, or product/customer data were migrated.

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
- Third-party attribution notes into `skills/ui-ux-secure-frontend-design/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md`.

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
