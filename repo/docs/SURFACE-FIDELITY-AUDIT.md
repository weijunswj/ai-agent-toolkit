# Surface Fidelity Audit

Date: 2026-05-18
Branch: `codex/surface-fidelity-audit`

## Executive summary

The audit found repo-wide fidelity risk, but not a reason to wipe or rebuild the repo in one uncontrolled change.

The confirmed Secure CI/CD prompt truncation was real. Before this PR, `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md` was a short 30-line prompt while `_projects/cicd/secure-installer/_main/README.md` preserves a full prompt under `# Copy this prompt into your AI coding agent`. This PR fixes that by adding an exact deterministic `extract` recipe and regenerating the published prompt from the preserved source section.

The broader audit found:

- 4 project modules under `_projects/`.
- 6 current skill folders.
- 25 tracked files under `mcp/`.
- 146 tracked files under `skills/` and `mcp/`.
- 80 expanded declared/generated project outputs after this PR.
- 66 tracked published-surface files still manually present and not declared by project sync recipes.
- 28 files covered by a pack install path but still not individually declared by project sync recipes.
- 0 exact duplicate-content groups across `_projects`, excluding generated previews.

The highest remaining risk is not Secure CI/CD after this PR. It is that some copyable skill folders still depend on `_projects/**/_main/**` for exact runtime detail, or include short summary references for long preserved source guides. That is a portability and fidelity problem because copied skill folders may not include `_projects/`.

## Deterministic audit command

This audit is now backed by `repo/scripts/audit-published-surfaces.cjs`.

Use:

```powershell
npm run audit:surfaces
npm run audit:surfaces:check
```

The command inspects local Git-tracked `skills/` and `mcp/` files, `_projects/**/toolkit.project.json`, and `skills/**/packs/**/pack.json`. It does not call the network, run project scripts, install packages, summarize with AI, or touch live n8n.

`--check` compares the current findings with `repo/docs/published-surface-audit-baseline.json`. The baseline intentionally records the current known manual, pack-installed undeclared, cross-owned, and suspicious surfaces so validation can fail when new surfaces appear before the existing follow-up cleanup is complete.

Future PRs that change skill or MCP surfaces should run `npm run audit:surfaces:check` before reporting completion. If a PR intentionally resolves or reclassifies a known issue, update the baseline in the same PR with `node repo/scripts/audit-published-surfaces.cjs --write-baseline`.

## Projects audited

Project modules:

- `_projects/cicd/secure-installer`
- `_projects/design/ui-ux-pro-max`
- `_projects/n8n/local-setup`
- `_projects/n8n/workflow-templates`

Inventory audited:

- `_projects/**/toolkit.project.json`
- `_projects/**/SOURCE-LOCK.json`
- `_projects/**/SOURCE-MANIFEST.md`
- `_projects/**/_main/**`
- `_projects/**/curated_output_for_ai/**`
- `repo/scripts/**`
- `repo/tests/**`

## Skills audited

Current skill folders:

- `skills/knowledge-index-updater/`
- `skills/n8n-local-setup/`
- `skills/n8n-workflow-sync/`
- `skills/secure-cicd-installer/`
- `skills/ui-ux-secure-frontend-design/`
- `skills/windows-localhost-workflows/`

Declared full-fidelity or deterministic generated surfaces include:

- `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md` after this PR, via exact extract from `_main/README.md`.
- `skills/n8n-local-setup/templates/agent-rules/AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`, via exact concat recipes from declared partials.
- `skills/n8n-local-setup/templates/mcp-configs/*-mcp-config.md`, via exact copy recipes.
- `skills/n8n-workflow-sync/templates/sanitizer/*`, via linked/source-locked sanitizer helper surfaces.
- `skills/n8n-workflow-sync/templates/sync-helpers/*`, via Secure CI/CD-owned linked/copy recipes.
- `skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/*` and `data/**`, via exact copy recipes from the preserved local-only subset.

Summary or reviewed-entrypoint surfaces include:

- Project `SKILL.md` and `README.md` entrypoints generated from `curated_output_for_ai/`.
- `mcp/projects/*.md` project notes generated from `curated_output_for_ai/` or linked for the UI/UX special case.
- Template folder README files that are indexes, not full operating guides.

## MCP files audited

MCP surface areas audited:

- `mcp/projects/**`
- `mcp/registry/**`
- `mcp/registry-mcp/**`
- `mcp/installer-mcp/**`
- `mcp/references/**`
- `mcp/README.md`

Declared MCP project outputs:

- `mcp/projects/secure-cicd-installer.md`
- `mcp/projects/ui-ux-pro-max.md`
- `mcp/projects/n8n-local-setup.md`
- `mcp/projects/n8n-workflow-templates.md`
- `mcp/registry/projects.registry.json`

Manual MCP surfaces not currently declared by project sync recipes include `mcp/README.md`, `mcp/installer-mcp/**`, `mcp/registry-mcp/**`, `mcp/references/**`, and every registry JSON except `mcp/registry/projects.registry.json`.

## Confirmed fidelity failures

Finding:
Severity: blocker
Source file(s):
- `_projects/cicd/secure-installer/_main/README.md`
Published file(s):
- `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md`
Problem:
The preserved README contains a long copy-ready prompt under `# Copy this prompt into your AI coding agent`, but the published prompt had been reduced to a short high-level summary. The pack manifest installs this prompt, so consumers would receive the truncated behavior.
Recommended fix:
Fixed in this PR. The prompt is now generated by an exact `extract` recipe from `_main/README.md`, declared in `toolkit.project.json`, regenerated into the skill folder, and covered by tests that fail on future truncation or source drift.

Finding:
Severity: high
Source file(s):
- `_projects/n8n/local-setup/_main/README.md`
- `_projects/n8n/local-setup/_main/1. local setup.md`
- `_projects/n8n/local-setup/_main/2. upgrading.md`
- `_projects/n8n/local-setup/_main/3. tunneling guide.md`
- `_projects/n8n/local-setup/_main/3a. docker compose + ngrok.md`
- `_projects/n8n/local-setup/_main/4. vps hosting.md`
- `_projects/n8n/local-setup/_main/5. extra - claude code integration.md`
- `_projects/n8n/local-setup/_main/6. extra - opencode integration.md`
- `_projects/n8n/local-setup/_main/7. extra - antigravity integration.md`
Published file(s):
- `skills/n8n-local-setup/SKILL.md`
- `skills/n8n-local-setup/references/n8n/local-setup.md`
- `skills/n8n-local-setup/references/n8n/upgrading.md`
- `skills/n8n-local-setup/references/n8n/tunnelling.md`
- `skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md`
- `skills/n8n-local-setup/references/n8n/vps-hosting.md`
- `skills/n8n-local-setup/references/ai-agent-platforms/*.md`
Problem:
The copyable skill entrypoint says to read `_projects/n8n/local-setup/_main/` when exact setup detail matters. Several published local references are short summaries of much longer preserved source guides. That breaks standalone skill portability and matches the audit failure pattern: required runtime instructions may live outside the skill folder.
Recommended fix:
Follow-up PR: either publish full local copies/extracts of the detailed setup guides inside `skills/n8n-local-setup/references/`, or make the short files clearly non-runtime overviews and add local full-fidelity references for the actual setup workflows.

Finding:
Severity: medium
Source file(s):
- `_projects/cicd/secure-installer/_main/README.md`
Published file(s):
- `skills/secure-cicd-installer/references/secure-cicd-installer.md`
- `mcp/projects/secure-cicd-installer.md`
Problem:
These are useful reviewed entrypoints, but they are summaries of the preserved CI/CD source. Their existence is fine as routers, but they must not be treated as the full CI/CD installer instructions. The prompt fix now gives the skill a local full-fidelity prompt.
Recommended fix:
No immediate rewrite. Keep `SKILL.md` and MCP docs short. Ensure any required runtime instructions live in local templates/references, not only in `_projects`.

## Suspected fidelity failures

Finding:
Severity: medium
Source file(s):
- `_projects/cicd/secure-installer/_main/README.md`
Published file(s):
- `skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md`
- `skills/secure-cicd-installer/templates/cicd/safe-source-update-policy.md`
- `skills/secure-cicd-installer/templates/github-actions/README.md`
Problem:
These files are installed by `skills/secure-cicd-installer/packs/secure-cicd/pack.json` but are not currently declared by `toolkit.project.json`. They may be legitimate hand-authored toolkit templates, but the audit cannot prove their source fidelity or freshness.
Recommended fix:
Follow-up PR: declare them as linked surfaces with explicit reasons, or move reviewed source copies under `_projects/cicd/secure-installer/curated_output_for_ai/` and generate them.

Finding:
Severity: medium
Source file(s):
- `_projects/n8n/local-setup/_main/templates/AGENTS.md`
- `_projects/n8n/local-setup/_main/templates/CLAUDE.md`
- `_projects/n8n/local-setup/_main/templates/GEMINI.md`
- `_projects/n8n/local-setup/_main/templates/partials/*.md`
Published file(s):
- `skills/n8n-local-setup/templates/agent-rules/AGENTS.md`
- `skills/n8n-local-setup/templates/agent-rules/CLAUDE.md`
- `skills/n8n-local-setup/templates/agent-rules/GEMINI.md`
Problem:
The generated agent-rule templates are full-fidelity for the declared partial sources, but they intentionally differ from the preserved original full templates by dropping install wrapper prose and adding skill routing. This appears intentional, not truncation, but should stay documented as transformed exact concat, not an exact copy of the original preserved template files.
Recommended fix:
No immediate code change. Keep the concat recipes and tests. Consider documenting the transform in the audit/manifest if confusion persists.

Finding:
Severity: medium
Source file(s):
- `_projects/design/ui-ux-pro-max/_main/**`
- `_projects/design/ui-ux-pro-max/SOURCE-LOCK.json`
Published file(s):
- `skills/ui-ux-secure-frontend-design/README.md`
- `skills/ui-ux-secure-frontend-design/references/*.md`
- `skills/ui-ux-secure-frontend-design/packs/frontend-design-skill/pack.json`
Problem:
The UI/UX project is a special linked third-party-attributed case. Several published instruction/reference files are manually maintained and not declared by project recipes. The current preserved `_main/` layer contains the local-only generator subset, not a full source for every instruction reference.
Recommended fix:
Follow-up PR: declare the manual UI/UX instruction surfaces as linked with explicit attribution/fidelity notes, or create reviewed curated sources for them. Do not import excluded upstream executable surfaces.

## Undeclared published files

After adding the Secure CI/CD prompt recipe, 66 tracked `skills/` or `mcp/` files remain outside expanded project sync outputs. These are not necessarily wrong, but they are manual surfaces from the perspective of this audit.

Major groups:

- MCP repo-level/spec surfaces: `mcp/README.md`, `mcp/installer-mcp/**`, `mcp/registry-mcp/**`, `mcp/references/**`.
- Manual registries: `mcp/registry/consumers.registry.json`, `packs.registry.json`, `playbooks.registry.json`, `skills.registry.json`, `source-repos.registry.json`, `templates.registry.json`, `tools.registry.json`.
- Skills with no `_projects` module: `skills/knowledge-index-updater/**`, `skills/windows-localhost-workflows/**`.
- n8n local setup summary/helper surfaces not recipe-declared: `skills/n8n-local-setup/references/ai-agent-platforms/**`, `skills/n8n-local-setup/references/n8n/upgrading.md`, `tunnelling.md`, `docker-compose-ngrok.md`, `vps-hosting.md`, pack READMEs, and `templates/agent-rules/README.md`.
- n8n workflow sync compatibility/reference surfaces not recipe-declared: `skills/n8n-workflow-sync/references/credential-safety.md`, `import-export-flow.md`, `workflow-template-hygiene.md`, `references/n8n/credential-safety.md`, `templates/workflow-policy/credential-migration-map-example.md`, pack README, and `agents/openai.yaml`.
- Secure CI/CD remaining manual templates: `CURRENT_CICD_STATUS.template.md`, `safe-source-update-policy.md`, `templates/github-actions/README.md`, and pack README.
- UI/UX manual surfaces: skill README/install/license files, examples, instruction references, frontend-design pack, pack READMEs, OpenAI agent metadata, and generator tests.

Pack-covered but undeclared files were found in these install surfaces:

```text
skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md
skills/n8n-local-setup/references/ai-agent-platforms/codex.md
skills/n8n-local-setup/references/n8n/tunnelling.md
skills/n8n-local-setup/references/n8n/upgrading.md
skills/n8n-workflow-sync/references/credential-safety.md
skills/n8n-workflow-sync/references/import-export-flow.md
skills/n8n-workflow-sync/references/n8n/credential-safety.md
skills/n8n-workflow-sync/references/workflow-template-hygiene.md
skills/n8n-workflow-sync/templates/workflow-policy/credential-migration-map-example.md
skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md
skills/secure-cicd-installer/templates/cicd/safe-source-update-policy.md
skills/secure-cicd-installer/templates/github-actions/README.md
skills/ui-ux-secure-frontend-design/**
```

Recommended fix:
Create one or more follow-up PRs that either declare these as linked surfaces with reasons, or move reviewed source into `_projects/**/curated_output_for_ai/` and generate them. Do not bulk rewrite content without checking fidelity against source.

## Cross-project ownership issues

Finding:
Severity: high
Source file(s):
- `_projects/cicd/secure-installer/_main/templates/n8n/**`
- `_projects/cicd/secure-installer/SOURCE-LOCK.json`
- `_projects/cicd/secure-installer/toolkit.project.json`
Published file(s):
- `skills/n8n-workflow-sync/templates/sync-helpers/**`
Problem:
The Secure CI/CD project owns and publishes n8n sync helper outputs into the `n8n-workflow-sync` skill surface. This is declared and partly source-locked, but it is cross-owned: a CI/CD project writes into an n8n skill. The n8n workflow-sync pack also installs that folder.
Recommended fix:
Do not rehome in this PR. Follow-up PR: move ownership to `_projects/n8n/workflow-templates` if the helpers are now n8n workflow-sync assets, or introduce a small deterministic shared-surface recipe layer such as `_projects/_surfaces/` with explicit ownership notes.

Finding:
Severity: low
Source file(s):
- `_projects/design/ui-ux-pro-max/SOURCE-LOCK.json`
Published file(s):
- `skills/ui-ux-secure-frontend-design/**`
Problem:
The UI/UX project is third-party-attributed and writes into a first-party named skill surface. Attribution exists, and `SOURCE-LOCK.json` marks the source as active third-party with manual review required. The remaining issue is declaration completeness for manual instruction surfaces, not hidden cross-ownership.
Recommended fix:
Keep attribution. Declare manual surfaces or curated sources in follow-up PRs.

## Duplicate content findings

The duplicate-content hash audit across `_projects`, excluding generated previews, found no exact duplicate groups spanning more than one project.

Classification:

```text
intentional_provenance: none
intentional_published_copy: none
needs_rehome: none from exact duplicates
needs_delete: none
needs_doc: none from exact duplicates
unknown: none
```

## Source-first rebuild assessment

1. Are `_projects/**/_main/**` files complete enough to rebuild all skills/MCP surfaces?

No. They are complete enough for several exact surfaces, including n8n agent rules, n8n MCP configs, n8n sanitizer helpers, n8n sync helpers, UI/UX generator scripts/data, and the Secure CI/CD prompt after this PR. They are not complete enough to rebuild all current skill/MCP surfaces because many manual surfaces live only under `skills/` or `mcp/`.

2. Are original old repos still needed?

For retired internal sources, no routine old-repo dependency is needed; `SOURCE-LOCK.json` preserves provenance. For the active third-party UI/UX source, the upstream repo remains relevant for attribution and future manually reviewed updates.

3. Which published surfaces can be regenerated from source without loss?

- Declared copy/concat/extract/json outputs in `toolkit.project.json`.
- Source-locked linked script/helper surfaces when the source-lock audit passes.
- `mcp/registry/projects.registry.json` from project manifests.

4. Which surfaces currently rely on manually maintained files?

Manual surfaces include the 66 undeclared files listed by group above, plus linked outputs by design. The largest manual buckets are registry/spec MCP docs, `knowledge-index-updater`, `windows-localhost-workflows`, UI/UX instruction references, and several n8n/CI/CD pack-installed references.

5. Which current generated outputs should be replaced by exact source extraction?

- Secure CI/CD prompt: done in this PR.
- n8n local setup detailed guides: recommended follow-up, likely exact copy/extract into `skills/n8n-local-setup/references/n8n/`.
- Secure CI/CD status/deployment/security policy snippets: evaluate in follow-up and either extract from README or declare as reviewed curated templates.

6. Is a clean rebuild recommended?

Not as a wipe. A staged source-first rebuild is recommended. The repo should keep `_projects/` as the source vault and progressively convert manually present skill/MCP files into declared linked, curated, copy, concat, json, or extract outputs.

## Recommended fixes

Immediate fixes in this PR:

- Preserve the full Secure CI/CD prompt locally in the skill folder.
- Declare the prompt in the Secure CI/CD project recipe.
- Add deterministic `extract` recipe support.
- Add tests that prove the prompt matches the preserved README section and fails on source drift.
- Add this repo-local audit report.

Recommended follow-up fixes:

- Convert n8n local setup summaries into full local references or make them explicit overview files with separate full-fidelity local docs.
- Declare Secure CI/CD pack-installed status/policy/GitHub Actions template files.
- Rehome or explicitly shared-own the n8n sync helpers currently owned by the Secure CI/CD project.
- Bring manual MCP registry/spec surfaces under project modules or a deterministic shared surface plan.
- Clarify UI/UX skill manual surface ownership and attribution in recipes.

## Recommended PR sequence

1. Current PR: audit report, Secure CI/CD prompt exact extract, tests, and generated registry update.
2. PR 2: Add a deterministic surface audit command and CI test for undeclared project-like published files. Done by `repo/scripts/audit-published-surfaces.cjs` and its baseline check.
3. PR 3: n8n local setup fidelity pass. Publish full local references or declare short files as non-runtime overviews.
4. PR 4: Secure CI/CD remaining template declaration pass for status, source update policy, and GitHub Actions notes.
5. PR 5: Cross-owned n8n sync helper ownership cleanup.
6. PR 6: MCP registry/spec ownership cleanup.
7. PR 7: UI/UX linked/manual surface provenance cleanup.

## Validation evidence

Starting baseline from `main`:

```text
git checkout main
git pull
npm run validate:all
git status --short
```

Results:

- `git checkout main`: succeeded after Git metadata permission escalation.
- `git pull`: already up to date after Git metadata permission escalation.
- `npm run validate:all`: passed.
- `git status --short`: clean.

Audit commands run:

- Project/skill/MCP inventory via `rg --files`.
- Declared output/undeclared surface inventory via `node` script using `repo/scripts/sync-toolkit-projects.cjs`.
- Source/published Markdown size heuristic script.
- Prompt/template grep checks for `Copy this prompt`, `You are my AI coding agent`, `Manual step needed`, `Do not commit`, `Do not push`, `Do not deploy`, and `Troubleshooting`.
- Cross-ownership grep checks for `output` paths, `root_surface_path`, `skills/n8n-workflow-sync/templates/sync-helpers`, and `_main/templates/n8n`.
- Duplicate-content hash audit across `_projects`, excluding `_generated`.

