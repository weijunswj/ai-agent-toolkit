# Surface Fidelity Audit

Date: 2026-05-18
Branch: `codex/surface-fidelity-audit`
Latest update: 2026-05-19 (`codex/declare-secure-cicd-remaining-templates`)

## Executive summary

The audit found repo-wide fidelity risk, but not a reason to wipe or rebuild the repo in one uncontrolled change.

The confirmed Secure CI/CD prompt truncation was real. Before this PR, `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md` was a short 30-line prompt while `_projects/cicd/secure-installer/_main/README.md` preserves a full prompt under `# Copy this prompt into your AI coding agent`. This PR fixes that by adding an exact deterministic `extract` recipe and regenerating the published prompt from the preserved source section.

The broader audit found:

- 4 project modules under `_projects/`.
- 6 current skill folders.
- 25 tracked files under `mcp/`.
- 162 tracked published-surface files under `skills/` and `mcp/`.
- 111 expanded declared/generated project outputs after the Secure CI/CD template declaration pass.
- 51 tracked published-surface files still manually present and not declared by project sync recipes.
- 21 files covered by a pack install path but still not individually declared by project sync recipes.
- 0 suspicious source/output size findings remain.
- 0 exact duplicate-content groups across `_projects`, excluding generated previews.

The highest remaining risks are now the cross-owned n8n workflow-sync helper ownership, n8n workflow-sync pack-installed reference ownership, manual MCP registry/spec surfaces, and UI/UX manual surface provenance. The `n8n-local-setup` runtime reference portability issue and the Secure CI/CD remaining template declaration issue have been addressed.

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

## Curated Output Boundary Audit

This audit now classifies every expanded `toolkit.project.json` output recipe against the `_main` versus `curated_output_for_ai` boundary rule from [Project Module Standard](PROJECT-MODULE-STANDARD.md).

Summary counts from `npm run audit:surfaces:check`:

- 111 expanded recipe outputs classified.
- 49 `main_full_fidelity` outputs.
- 10 `curated_index` outputs, including short reviewed overviews/safety wrappers.
- 5 `curated_metadata` outputs.
- 1 `curated_pack_readme` output.
- 3 `curated_router` outputs.
- 15 `curated_shim` outputs.
- 3 `curated_spec` outputs.
- 2 `curated_template` outputs.
- 6 `curated_template_index` outputs.
- 17 `linked_exception` outputs.
- 0 `suspicious_curated_runtime` outputs.
- 0 `suspicious_main_adapter` outputs.
- 0 curated-directory heuristic findings.

Confirmed violations:

- None newly confirmed by this focused boundary audit. Full runtime guides restored in earlier n8n local setup work still publish from `_main` via exact `copy` recipes.
- The former published-surface finding for `skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md` is resolved by declaring it as a reviewed curated template output.

Suspected violations:

- No `curated_output_for_ai/playbooks/**` recipes remain. The former workflow-sync and Secure CI/CD playbooks were reclassified as short reviewed overviews/safety wrappers and moved to `curated_output_for_ai/overviews/**`.
- None for the n8n platform overview/router files reviewed in this pass. They remain short curated platform notes and route to full-fidelity local references/templates.

Allowed curated-output categories:

- `SKILL.md` routers.
- Skill README and local README/index files.
- Pack manifests and generated metadata.
- Pack READMEs when they are short skill-local pack indexes.
- MCP project/spec summaries.
- Reference-link compatibility shims.
- Small reviewed template snippets and template indexes that do not replace full runtime instructions.
- Small reviewed overview, safety wrapper, packaging, and adapter text that is not a lossy substitute for required runtime instructions.

Recommended fixes:

- Continue resolving the remaining pack-installed undeclared findings in focused PRs. Do not broaden this pass into n8n workflow-sync ownership, MCP registry/spec ownership, or UI/UX provenance cleanup.

Follow-up PRs are still needed for non-playbook findings outside Secure CI/CD. The playbook-specific recipe findings and Secure CI/CD remaining template findings are resolved.

## Secure CI/CD Template Declaration Pass

Classification rule: full working instructions publish from `_main` directly; short reviewed templates, indexes, metadata, routers, shims, specs, and overviews may publish from `curated_output_for_ai/`.

Files reviewed:

| Source file | Published output | Classification | Outcome | Reason |
| --- | --- | --- | --- | --- |
| `_projects/cicd/secure-installer/curated_output_for_ai/templates/cicd/CURRENT_CICD_STATUS.template.md` | `skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md` | `curated_template` | Became curated. | Short status-file template for consumer repos; the full Secure CI/CD prompt remains exact-extracted from `_main/README.md`. |
| `_projects/cicd/secure-installer/curated_output_for_ai/templates/cicd/safe-source-update-policy.md` | `skills/secure-cicd-installer/templates/cicd/safe-source-update-policy.md` | `curated_template` | Became curated. | Short reviewed policy template; it preserves approval and blocked-content constraints without replacing the full installer prompt. |
| `_projects/cicd/secure-installer/curated_output_for_ai/templates/github-actions/README.md` | `skills/secure-cicd-installer/templates/github-actions/README.md` | `curated_template_index` | Became curated. | Template-folder index and safety notes, not a full workflow implementation guide. |
| `_projects/cicd/secure-installer/curated_output_for_ai/packs/secure-cicd/README.md` | `skills/secure-cicd-installer/packs/secure-cicd/README.md` | `curated_pack_readme` | Became curated. | Short skill-local pack README; `pack.json` remains deterministic generated JSON from curated source. |

Pack manifest and audit outcome:

- Every `skills/secure-cicd-installer/packs/secure-cicd/pack.json` install path is now declared by `_projects/cicd/secure-installer/toolkit.project.json`.
- No Secure CI/CD file remains in `packInstalledUndeclared`.
- `CURRENT_CICD_STATUS.template.md` no longer appears in `suspiciousPublishedSurfaces`.
- No Secure CI/CD linked/manual exception remains for these four reviewed surfaces.

Audit baseline changes:

- `declaredOutputFiles`: 107 -> 111.
- `undeclaredPublishedFiles`: 55 -> 51.
- `packInstalledUndeclared`: 24 -> 21.
- `suspiciousPublishedSurfaces`: 1 -> 0.
- `boundaryRecipeOutputs`: 107 -> 111.

Remaining Secure CI/CD follow-up actions:

- None for the four remaining template/manual surfaces reviewed in this pass.
- Cross-owned n8n sync helper ownership remains a separate follow-up and was intentionally not rehomed here.

## n8n Platform Reference Boundary Review

Classification rule: a platform overview may stay curated only when it is a short router or safety wrapper that does not replace required runtime setup instructions.

Files reviewed:

| Source file | Published output | Classification | Outcome | Reason |
| --- | --- | --- | --- | --- |
| `_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/chatgpt-web.md` | `skills/n8n-local-setup/references/ai-agent-platforms/chatgpt-web.md` | `allowed_platform_overview` | Stayed curated and was rewritten as a clearer platform overview. | It explains ChatGPT web limitations and manual-use routing, then points to full local references/templates. |
| `_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/claude-web.md` | `skills/n8n-local-setup/references/ai-agent-platforms/claude-web.md` | `allowed_platform_overview` | Stayed curated and was rewritten as a clearer platform overview. | It explains Claude web limitations and routes to the full Claude Code Desktop guide plus local setup references. |
| `_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md` | `skills/n8n-local-setup/references/ai-agent-platforms/codex.md` | `allowed_platform_overview` | Stayed curated and was rewritten as a platform router. | It routes to `references/n8n/local-setup.md`, `templates/agent-rules/AGENTS.md`, and `templates/mcp-configs/codex-mcp-config.md` instead of duplicating runtime setup detail. |

Why this follows [Project Module Standard](PROJECT-MODULE-STANDARD.md):

- Full runtime guides and templates remain exact `_main` `copy` or `concat` outputs.
- The reviewed curated files are short platform overview/router notes with an explicit `## Boundary` section.
- The audit exception is narrow: explicit platform overview/router files may pass only when they are not large and do not contain many code fences or a large guide body.

Remaining follow-up actions:

- None for these three n8n platform references.

## Playbook Boundary Review

Conclusion: `playbooks/` is not needed as a default repo concept. The narrow allowed meaning is only a short reviewed operating overview, routing guide, or safety wrapper that does not replace required runtime instructions. Existing runtime-critical material should publish from `_main` into `references/` or `templates/` with exact `copy`, `extract`, or `concat` recipes.

Files reviewed:

| Source file | Published output(s) | Current recipe before review | Classification | Reason | Recommended action |
| --- | --- | --- | --- | --- | --- |
| `_projects/n8n/workflow-templates/curated_output_for_ai/playbooks/workflow-sync.md` | `skills/n8n-workflow-sync/references/n8n/workflow-sync.md` | `curated`, `fidelity: exact` | `allowed_overview_or_safety_wrapper` | Short safety wrapper for credential-safe repo/live workflow sync; helper detail remains in local references and templates. | Moved to `curated_output_for_ai/overviews/workflow-sync.md`, changed recipe notes to call it an overview/safety wrapper, and regenerated the published reference. |
| `_projects/cicd/secure-installer/curated_output_for_ai/playbooks/secure-cicd-installer.md` | `skills/secure-cicd-installer/references/secure-cicd-installer.md` | `curated`, `fidelity: exact` | `allowed_overview_or_safety_wrapper` | Short CI/CD safety wrapper and router; the full copyable CI/CD prompt is already extracted from `_main/README.md`. | Moved to `curated_output_for_ai/overviews/secure-cicd-installer.md`, changed recipe notes to call it an overview/safety wrapper, and regenerated the published reference. |
| `_projects/n8n/local-setup/curated_output_for_ai/playbooks/local-setup.md` | None | None | `obsolete_or_duplicate` | Unpublished curated source that duplicated the shape of full-fidelity local setup references now copied from `_main`. | Removed the unused curated file. No preserved `_main` source was deleted. |

Files moved or removed:

- Moved workflow-sync and Secure CI/CD curated sources from `curated_output_for_ai/playbooks/` to `curated_output_for_ai/overviews/`.
- Removed the unused local-setup curated playbook source.

Files intentionally kept:

- `mcp/registry/playbooks.registry.json` remains because it is a manual legacy discovery registry over existing reference paths. It is documented as pending cleanup and must not be treated as a source folder or proof that full runtime instructions belong under `playbooks/`.

Remaining follow-up actions:

- Decide whether `mcp/registry/playbooks.registry.json` should be renamed or replaced by a references-oriented registry in a later MCP registry cleanup.
- Review the remaining curated-directory findings for ChatGPT web, Claude web, and Codex platform references.

## n8n local setup fidelity pass

The `n8n-local-setup` skill now carries full-fidelity local copies of the required preserved setup guides inside `skills/n8n-local-setup/references/`. The copied guide bodies are generated by exact `copy` recipes from `_projects/n8n/local-setup/_main/`, with generated notices added by sync. Small link-compatibility shims keep original source-relative links resolvable inside the copyable skill folder without rewriting the full guide text.

Restored full-fidelity references:

- `references/n8n/local-setup.md`
- `references/n8n/upgrading.md`
- `references/n8n/tunnelling.md`
- `references/n8n/docker-compose-ngrok.md`
- `references/n8n/vps-hosting.md`
- `references/ai-agent-platforms/claude-code.md`
- `references/ai-agent-platforms/opencode.md`
- `references/ai-agent-platforms/antigravity.md`

The skill router now points agents to local skill-folder references for runtime detail. `_projects/n8n/local-setup/_main/` remains provenance/source material for toolkit maintainers, not a required runtime dependency for copied skills.

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
- `skills/n8n-local-setup/references/n8n/*.md` required setup guides, via exact copy recipes from `_main/*.md`.
- `skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md`, `opencode.md`, and `antigravity.md`, via exact copy recipes from `_main/*.md`.
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
Severity: resolved high
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
Before the fidelity pass, the copyable skill entrypoint said to read `_projects/n8n/local-setup/_main/` when exact setup detail mattered. Several published local references were short summaries of much longer preserved source guides. That broke standalone skill portability because required runtime instructions could live outside the copied skill folder.
Recommended fix:
Fixed in the n8n local setup fidelity pass. The required setup, upgrade, tunneling, Docker Compose plus ngrok, VPS hosting, Claude Code, OpenCode, and Antigravity guides are now declared exact copy outputs in `toolkit.project.json` and generated into `skills/n8n-local-setup/references/`. The `SKILL.md` router now uses local reference files for runtime detail.

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
These files were installed by `skills/secure-cicd-installer/packs/secure-cicd/pack.json` but were not declared by `toolkit.project.json`, so the audit could not prove their source fidelity or freshness.
Recommended fix:
Fixed in the Secure CI/CD template declaration pass. Reviewed source copies now live under `_projects/cicd/secure-installer/curated_output_for_ai/`, publish through curated recipes, and regenerate into the skill folder.

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

After the Secure CI/CD template declaration pass, 51 tracked `skills/` or `mcp/` files remain outside expanded project sync outputs. These are not necessarily wrong, but they are manual surfaces from the perspective of this audit.

Major groups:

- MCP repo-level/spec surfaces: `mcp/README.md`, `mcp/installer-mcp/**`, `mcp/registry-mcp/**`, `mcp/references/**`.
- Manual registries: `mcp/registry/consumers.registry.json`, `packs.registry.json`, `playbooks.registry.json`, `skills.registry.json`, `source-repos.registry.json`, `templates.registry.json`, `tools.registry.json`.
- Skills with no `_projects` module: `skills/knowledge-index-updater/**`, `skills/windows-localhost-workflows/**`.
- n8n local setup remaining manual indexes: pack READMEs and `templates/agent-rules/README.md`. Required runtime references are now recipe-declared.
- n8n workflow sync compatibility/reference surfaces not recipe-declared: `skills/n8n-workflow-sync/references/credential-safety.md`, `import-export-flow.md`, `workflow-template-hygiene.md`, `references/n8n/credential-safety.md`, `templates/workflow-policy/credential-migration-map-example.md`, pack README, and `agents/openai.yaml`.
- UI/UX manual surfaces: skill README/install/license files, examples, instruction references, frontend-design pack, pack READMEs, OpenAI agent metadata, and generator tests.

Pack-covered but undeclared files were found in these install surfaces:

```text
skills/n8n-workflow-sync/references/credential-safety.md
skills/n8n-workflow-sync/references/import-export-flow.md
skills/n8n-workflow-sync/references/n8n/credential-safety.md
skills/n8n-workflow-sync/references/workflow-template-hygiene.md
skills/n8n-workflow-sync/templates/workflow-policy/credential-migration-map-example.md
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

Manual surfaces include the 51 undeclared files listed by group above, plus linked outputs by design. The largest manual buckets are registry/spec MCP docs, `knowledge-index-updater`, `windows-localhost-workflows`, UI/UX instruction references, and several workflow-sync pack-installed references.

5. Which current generated outputs should be replaced by exact source extraction?

- Secure CI/CD prompt: done in this PR.
- n8n local setup detailed guides: done. Required runtime guides are exact copy outputs in `skills/n8n-local-setup/references/`.
- Secure CI/CD status/deployment/security policy snippets: done in the Secure CI/CD template declaration pass. They are reviewed curated templates; the full prompt remains exact-extracted from `_main/README.md`.

6. Is a clean rebuild recommended?

Not as a wipe. A staged source-first rebuild is recommended. The repo should keep `_projects/` as the source vault and progressively convert manually present skill/MCP files into declared linked, curated, copy, concat, json, or extract outputs.

## Recommended fixes

Completed fixes:

- Preserve the full Secure CI/CD prompt locally in the skill folder.
- Declare the prompt in the Secure CI/CD project recipe.
- Add deterministic `extract` recipe support.
- Add tests that prove the prompt matches the preserved README section and fails on source drift.
- Add this repo-local audit report.
- Add the deterministic published-surface audit command and baseline check.
- Restore full-fidelity `n8n-local-setup` runtime references inside the copyable skill folder.
- Declare the remaining Secure CI/CD pack-installed status/policy/GitHub Actions template files and pack README as curated generated outputs.

Recommended follow-up fixes:

- Rehome or explicitly shared-own the n8n sync helpers currently owned by the Secure CI/CD project.
- Bring manual MCP registry/spec surfaces under project modules or a deterministic shared surface plan.
- Clarify UI/UX skill manual surface ownership and attribution in recipes.

## Recommended PR sequence

1. Current PR: audit report, Secure CI/CD prompt exact extract, tests, and generated registry update.
2. PR 2: Add a deterministic surface audit command and CI test for undeclared project-like published files. Done by `repo/scripts/audit-published-surfaces.cjs` and its baseline check.
3. PR 3: n8n local setup fidelity pass. Publish full local references or declare short files as non-runtime overviews. Done for required runtime references.
4. PR 4: Secure CI/CD remaining template declaration pass for status, source update policy, GitHub Actions notes, and pack README. Done in `codex/declare-secure-cicd-remaining-templates`.
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

