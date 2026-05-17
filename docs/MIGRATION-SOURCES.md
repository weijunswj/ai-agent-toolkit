# Migration Sources

Reviewed date: 2026-05-16.

Permanent docs use source repo names and source-relative paths. Local checkout paths are inspection-only and are not part of this migration record.

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

Inspected:

- Public GitHub repo and README/tree.

Migrated:

- Inspiration-level note only: product brief to design system to page plan to implementation review.

Intentionally not migrated:

- Executable code.
- CLI tools.
- Python scripts.
- Data files.
- Generated templates.
- Assets.
- Screenshots.
- Package metadata.
- Install commands.

Skipped for safety:

- Everything except high-level attribution/inspiration notes.

Remaining:

- No local checkout was provided. Public repo inspection was sufficient for the inspiration-only scope.
