# Surface Fidelity Audit

Date: 2026-05-18
Branch: `codex/surface-fidelity-audit`
Latest update: 2026-05-21 (`codex/mcp-ready-registry-ownership`)

## Executive summary

The audit found repo-wide fidelity risk, but not a reason to wipe or rebuild the repo in one uncontrolled change.

The confirmed Secure CI/CD prompt truncation was real. Before the Secure CI/CD prompt pass, `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md` was a short 30-line prompt while `_projects/cicd/secure-installer/_main/README.md` preserves a full prompt under `# Copy this prompt into your AI coding agent`. That pass fixed the issue by adding an exact deterministic `extract` recipe and regenerating the published prompt from the preserved source section.

The current audit finds:

- 8 project modules under `_projects/`.
- 8 current skill folders.
- 25 tracked files under `mcp/`.
- 188 tracked published-surface files under `skills/` and `mcp/`.
- 188 expanded declared/generated project outputs after the MCP-ready registry ownership pass.
- 0 tracked published-surface files still manually present and not declared by project sync recipes.
- 0 files covered by a pack install path but still not individually declared by project sync recipes.
- 0 unresolved cross-owned outputs.
- 0 declared shared-surface outputs.
- 0 shared-surface metadata findings.
- 0 suspicious source/output size findings.
- 0 exact duplicate-content groups across `_projects`, excluding generated previews and the explicit retired Secure CI/CD n8n helper provenance copies now owned by `n8n.workflow-toolkit`.
- 0 curated output boundary recipe findings.
- 0 curated directory boundary findings.

The MCP-ready registry docs/specs/metadata are now source-owned by `_projects/repo-methodology/mcp-ready-registry/`. The `n8n-local-setup` runtime reference portability issue, remaining n8n local setup skill-side indexes, Secure CI/CD remaining template declaration issue, n8n sync helper shared-surface ownership issue, n8n workflow-sync pack-installed reference issue, UI/UX skill-side ownership issue, standalone knowledge/localhost skill ownership issue, and repo-level MCP-ready registry ownership issue have been addressed.

## Standalone Skill Declaration Pass

The former orphan root skill folders are now owned by focused project modules:

- `_projects/knowledge/knowledge-index-updater/` owns `skills/knowledge-index-updater/`.
- `_projects/development/windows-localhost-workflows/` owns `skills/windows-localhost-workflows/`.

The existing standalone skill folders are promoted into `_main/skill/**` and regenerated into the published `skills/` folders through exact `copy` recipes. Markdown outputs receive the standard generated notice, while `_main/skill/**` preserves the former standalone skill content exactly.

Audit baseline movement from the previous baseline:

- `projects`: 5 to 7.
- `publishedFiles`: 160 to 187 after refreshing the baseline against the current tracked `skills/` and `mcp/` files.
- `declaredOutputFiles`: 143 to 151.
- `undeclaredPublishedFiles`: 44 to 37.
- `boundaryRecipeOutputs`: 143 to 151.
- `crossOwnedOutputs`, `sharedSurfaceOutputs`, `sharedSurfaceMetadataFindings`, `suspiciousPublishedSurfaces`, `duplicateProjectContentGroups`, `boundaryRecipeFindings`, and `curatedDirectoryFindings`: stayed 0.

Amendment movement from the prior PR #29 baseline:

- `declaredOutputFiles`: 150 to 151.
- `boundaryRecipeOutputs`: 150 to 151.
- `boundaryRecipeFindings`: stayed 0 after recognising promoted `_main/skill/**` standalone skill sources as full-fidelity copies.

Remaining follow-up actions:

- None for `knowledge-index-updater` or `windows-localhost-workflows`.

## Category Cleanup Amendment

The project category names were clarified without adding or removing declared skill/MCP routes:

- `_projects/dev/windows-localhost-workflows/` became `_projects/development/windows-localhost-workflows/`.
- Project id `dev.windows-localhost-workflows` became `development.windows-localhost-workflows`.
- `_projects/meta/context-preserving-ai-publisher/` became `_projects/repo-methodology/context-preserving-ai-publisher/`.
- Project id `meta.context-preserving-ai-publisher` became `repo-methodology.context-preserving-ai-publisher`.
- `_projects/cicd/`, `_projects/design/`, `_projects/knowledge/`, and `_projects/n8n/` intentionally remain first-class categories.

Audit baseline movement recorded with this cleanup:

- `publishedFiles`: 187 to 188 after the generated `skills/context-preserving-ai-publisher/references/validation-strategy.md` file became tracked.
- `declared_generated`: 88 to 89.
- `projects`, `declaredOutputFiles`, `undeclaredPublishedFiles`, `boundaryRecipeOutputs`, `boundaryRecipeFindings`, and `curatedDirectoryFindings` stayed unchanged.

## UI/UX Skill Ownership Pass

The remaining UI/UX pack-installed ownership findings were resolved without attempting MCP registry or MCP reference cleanup.

The current `skills/ui-ux-secure-frontend-design/**` files covered by the skill-local packs were promoted into `_projects/design/ui-ux-pro-max/_main/skill/**` as canonical project-owned source:

- Skill entry and install docs: `SKILL.md`, `README.md`, `INSTALL.md`, `LICENSE-THIRD-PARTY-NOTES.md`, and `agents/openai.yaml`.
- Skill examples and references: `examples/prompts.md`, `references/component-patterns.md`, `references/design-system-workflow.md`, `references/frontend-quality-rubric.md`, `references/privacy-security-safety.md`, `references/project/ui-ux-pro-max.md`, and `references/stack-playbooks.md`.
- Skill-local packs: `packs/design-system-generator/README.md`, `packs/design-system-generator/pack.json`, `packs/frontend-design-skill/README.md`, and `packs/frontend-design-skill/pack.json`.
- Tool-local documentation and test: `tools/design-system-generator/README.md`, `tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md`, and `tools/design-system-generator/tests/test_local_only.py`.

These outputs now publish through deterministic `copy` recipes from `_main/skill/**`. The existing generator scripts and CSV data continue to publish from `_main/src/ui-ux-pro-max/**`. Markdown outputs receive the standard generated notice; the canonical `_main/skill/**` source files do not.

The UI/UX MCP project note `mcp/projects/ui-ux-pro-max.md` remains linked because this pass is limited to skill-folder ownership findings and deliberately does not broaden into MCP cleanup.

Audit baseline movement:

- `declaredOutputFiles`: 151 to 165.
- `undeclaredPublishedFiles`: 37 to 23.
- `packInstalledUndeclared`: 14 to 0.
- `boundaryRecipeOutputs`: 151 to 165.
- `pack_installed_declared`: 60 to 74.
- `linked_exception`: 7 to 2.
- `main_full_fidelity`: 91 to 110.
- `publishedFiles`, `projects`, `packInstalledFiles`, `crossOwnedOutputs`, `sharedSurfaceOutputs`, `sharedSurfaceMetadataFindings`, `suspiciousPublishedSurfaces`, `duplicateProjectContentGroups`, `boundaryRecipeFindings`, and `curatedDirectoryFindings` stayed unchanged.

## n8n Local Setup Skill Surface Declaration Pass

The last manually present `n8n-local-setup` skill-side pack files were declared project outputs:

- `skills/n8n-local-setup/packs/claude-code-n8n-local/README.md`
- `skills/n8n-local-setup/packs/codex-n8n-local/README.md`

Their reviewed source now lives under `_projects/n8n/local-setup/curated_output_for_ai/packs/**`. The old local setup `agent-rules/` index was later removed when full n8n rules moved to `skills/n8n-agent-rules/`.

These files are short skill-local pack READMEs, not full runtime setup guides. They therefore use curated `reviewed_entrypoint` recipes. Full local setup, upgrade, tunneling, hosting, platform, MCP config, and generated n8n-agent-rules bodies publish from preserved `_main` source or exact concat/copy recipes.

Audit baseline movement:

- `undeclaredPublishedFiles`: 23 to 20.
- `declaredOutputFiles`: 165 to 168.
- `boundaryRecipeOutputs`: 165 to 168.
- `curated_pack_readme`: 1 to 3.
- `curated_template_index`: 7 to 8.
- `packInstalledUndeclared`, `crossOwnedOutputs`, `sharedSurfaceOutputs`, `sharedSurfaceMetadataFindings`, `suspiciousPublishedSurfaces`, `boundaryRecipeFindings`, and `curatedDirectoryFindings`: stayed 0.

The remaining 20 undeclared published files at that point were MCP repo-level/spec and registry surfaces. They are resolved by the MCP-ready registry ownership pass below.

## MCP-Ready Registry Ownership Pass

The repo-level MCP-ready registry docs/specs and registry metadata are now owned by a dedicated project module:

- `_projects/repo-methodology/mcp-ready-registry/`

This module owns MCP-ready registry/design/spec material only. It does not ship a runnable MCP server, npm package, CLI, server entrypoint, network service, API integration, or executable MCP tools.

The 20 formerly undeclared files became declared outputs:

- `mcp/README.md`
- `mcp/installer-mcp/README.md`
- `mcp/installer-mcp/SECURITY.md`
- `mcp/installer-mcp/SPEC.md`
- `mcp/references/README.md`
- `mcp/references/installer-mcp.md`
- `mcp/references/local-mcp-setup.md`
- `mcp/references/mcp-security.md`
- `mcp/references/registry-mcp.md`
- `mcp/registry-mcp/README.md`
- `mcp/registry-mcp/SECURITY.md`
- `mcp/registry-mcp/SPEC.md`
- `mcp/registry/README.md`
- `mcp/registry/consumers.registry.json`
- `mcp/registry/packs.registry.json`
- `mcp/registry/playbooks.registry.json`
- `mcp/registry/skills.registry.json`
- `mcp/registry/source-repos.registry.json`
- `mcp/registry/templates.registry.json`
- `mcp/registry/tools.registry.json`

Markdown docs publish through deterministic `copy` recipes from `_main/`. Registry JSON files publish through deterministic `json` recipes. `mcp/registry/projects.registry.json` remains generated by toolkit project sync from all project manifests and is not owned by this module.

Why this is MCP-ready registry/design/spec material, not a runnable MCP server:

- `mcp/registry/**` is machine-readable metadata for future discovery and installer flows.
- `mcp/registry-mcp/**` and `mcp/installer-mcp/**` are future design/spec-only docs.
- `mcp/references/**` are supporting operator notes.
- `mcp/projects/**` remains project-specific MCP notes owned by each project module.

Audit baseline movement:

- `projects`: 7 to 8.
- `declaredOutputFiles`: 168 to 188.
- `undeclaredPublishedFiles`: 20 to 0.
- `boundaryRecipeOutputs`: 168 to 188.
- `main_full_fidelity`: 110 to 130.
- `packInstalledUndeclared`, `crossOwnedOutputs`, `sharedSurfaceOutputs`, `sharedSurfaceMetadataFindings`, `suspiciousPublishedSurfaces`, `boundaryRecipeFindings`, and `curatedDirectoryFindings`: stayed 0.

No skill-side surfaces remain undeclared. No real MCP runtime/server/package/CLI was added.

## n8n Workflow Toolkit Reshape

The former `_projects/n8n/workflow-templates/` module mixed sanitizer scripts, import/export sync helpers, workflow-template JSON, and workflow-sync published surfaces. It is now reshaped as `_projects/n8n/workflow-toolkit/` with project id `n8n.workflow-toolkit`.

Final published surfaces:

- `skills/n8n-workflow-helper-scripts/` owns sanitizer and import/export sync helper templates.
- `skills/n8n-workflow-templates/` owns reusable public n8n workflow JSON templates.
- `mcp/projects/n8n-workflow-toolkit.md` is a concise spec-only project note.

The old `skills/n8n-workflow-sync/` generated surface and `mcp/projects/n8n-workflow-templates.md` were removed with no compatibility shim. Secure CI/CD retains its retired `_main/templates/n8n/**` provenance copies, but those files no longer declare or own published n8n helper outputs. The audit has a narrow duplicate-source exception for those retired exact provenance copies against the new canonical workflow-toolkit helper source.

Audit baseline movement from the previous baseline:

- `publishedFiles`: 188 to 160.
- `declaredOutputFiles`: 144 to 143.
- `packInstalledFiles`: 101 to 74.
- `sharedSurfaceOutputs`: 11 to 0.
- `boundaryRecipeOutputs`: 144 to 143.
- `crossOwnedOutputs`, `sharedSurfaceMetadataFindings`, `suspiciousPublishedSurfaces`, `duplicateProjectContentGroups`, `boundaryRecipeFindings`, and `curatedDirectoryFindings`: stayed 0.

## Deterministic audit command

This audit is now backed by `repo/scripts/audit-published-surfaces.cjs`.

Use:

```powershell
npm run audit:surfaces
npm run audit:surfaces:check
```

The command inspects local Git-tracked `skills/` and `mcp/` files, `_projects/**/toolkit.project.json`, and `skills/**/packs/**/pack.json`. It does not call the network, run project scripts, install packages, summarize with AI, or touch live n8n.

`--check` compares the current findings with `repo/docs/published-surface-audit-baseline.json`. The baseline intentionally records the current known manual, pack-installed undeclared, unresolved cross-owned, declared shared-surface, and suspicious surfaces so validation can fail when new surfaces appear before the existing follow-up cleanup is complete.

Future PRs that change skill or MCP surfaces should run `npm run audit:surfaces:check` before reporting completion. If a PR intentionally resolves or reclassifies a known issue, update the baseline in the same PR with `node repo/scripts/audit-published-surfaces.cjs --write-baseline`.

## Curated Output Boundary Audit

This audit now classifies every expanded `toolkit.project.json` output recipe against the `_main` versus `curated_output_for_ai` boundary rule from [Project Module Standard](PROJECT-MODULE-STANDARD.md).

Summary counts from `npm run audit:surfaces:check`:

- 188 expanded recipe outputs classified.
- 130 `main_full_fidelity` outputs.
- 0 `curated_agent_metadata` outputs.
- 9 `curated_index` outputs, including short reviewed overviews/safety wrappers.
- 4 `curated_metadata` outputs.
- 3 `curated_pack_readme` outputs.
- 7 `curated_reference` outputs.
- 5 `curated_router` outputs.
- 15 `curated_shim` outputs.
- 3 `curated_spec` outputs.
- 2 `curated_template` outputs.
- 8 `curated_template_index` outputs.
- 2 `linked_exception` outputs.
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
- Agent metadata such as `agents/openai.yaml`.
- MCP project/spec summaries.
- Reference-link compatibility shims.
- Short reviewed skill-local references that do not replace full runtime helper guides.
- Small reviewed template snippets and template indexes that do not replace full runtime instructions.
- Small reviewed template examples for local-only policy inputs.
- Small reviewed overview, safety wrapper, packaging, and adapter text that is not a lossy substitute for required runtime instructions.

Recommended fixes:

- Keep future skill and MCP-ready registry surface changes declared by project recipes in the same PR that adds or changes the published output.

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

- None for the four remaining template/manual surfaces reviewed in that pass.
- The former n8n sync helper shared-surface split has been superseded by the workflow-toolkit reshape.

## n8n Workflow Toolkit Ownership Review

Classification rule: import/export sync helpers and sanitizer helpers are n8n workflow toolkit assets, not Secure CI/CD published surfaces. Retired Secure CI/CD source copies may remain for provenance, but they must not own or declare generated n8n helper outputs.

Files reviewed:

- `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/*`
- `skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/*`
- `skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json`

Chosen outcome: rehome source ownership under `n8n.workflow-toolkit`.

The helpers now publish from `_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/` and `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/`. The reusable workflow JSON template now publishes from `_projects/n8n/workflow-toolkit/_main/workflow-templates/error-handling/global-error-handler.template.json`.

The old `skills/n8n-workflow-sync/` generated surface and its pack were removed. No compatibility shim was kept. `_projects/cicd/secure-installer/_main/templates/n8n/**` remains only as retired provenance for the original source material, and `_projects/cicd/secure-installer/toolkit.project.json` no longer declares n8n helper outputs.

Audit baseline changes:

- `publishedFiles`: 188 -> 160.
- `declaredOutputFiles`: 144 -> 143.
- `packInstalledFiles`: 101 -> 74.
- `sharedSurfaceOutputs`: 11 -> 0.
- `boundaryRecipeOutputs`: 144 -> 143.
- `crossOwnedOutputs`: 0 -> 0.
- `sharedSurfaceMetadataFindings`: 0 -> 0.
- `suspiciousPublishedSurfaces`: 0 -> 0.
- `duplicateProjectContentGroups`: 0 -> 0.
- `boundaryRecipeFindings`: 0 -> 0.
- `curatedDirectoryFindings`: 0 -> 0.

Remaining follow-up actions:

- None for n8n workflow helper ownership.

## n8n Platform Reference Boundary Review

Classification rule: a platform overview may stay curated only when it is a short router or safety wrapper that does not replace required runtime setup instructions.

Files reviewed:

| Source file | Published output | Classification | Outcome | Reason |
| --- | --- | --- | --- | --- |
| `_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/chatgpt-web.md` | `skills/n8n-local-setup/references/ai-agent-platforms/chatgpt-web.md` | `allowed_platform_overview` | Stayed curated and was rewritten as a clearer platform overview. | It explains ChatGPT web limitations and manual-use routing, then points to full local references/templates. |
| `_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/claude-web.md` | `skills/n8n-local-setup/references/ai-agent-platforms/claude-web.md` | `allowed_platform_overview` | Stayed curated and was rewritten as a clearer platform overview. | It explains Claude web limitations and routes to the full Claude Code Desktop guide plus local setup references. |
| `_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md` | `skills/n8n-local-setup/references/ai-agent-platforms/codex.md` | `allowed_platform_overview` | Stayed curated and was rewritten as a platform router. | It routes to `references/n8n/local-setup.md`, `skills/n8n-agent-rules`, the generated cross-skill reference, and `templates/mcp-configs/codex-mcp-config.md` instead of duplicating runtime setup detail. |

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
| `_projects/n8n/workflow-toolkit/curated_output_for_ai/references/workflow-sync.md` | `skills/n8n-workflow-helper-scripts/references/workflow-sync.md` | `curated`, `fidelity: reviewed_reference` | `allowed_overview_or_safety_wrapper` | Short safety wrapper for credential-safe repo/live workflow sync; helper detail remains in local templates. | Supersedes the earlier workflow-sync playbook path after the n8n workflow toolkit reshape. |
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
- `_projects/development/windows-localhost-workflows`
- `_projects/design/ui-ux-pro-max`
- `_projects/knowledge/knowledge-index-updater`
- `_projects/repo-methodology/context-preserving-ai-publisher`
- `_projects/n8n/local-setup`
- `_projects/n8n/workflow-toolkit`

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
- `skills/context-preserving-ai-publisher/`
- `skills/n8n-agent-rules/`
- `skills/n8n-local-setup/`
- `skills/n8n-workflow-helper-scripts/`
- `skills/n8n-workflow-templates/`
- `skills/secure-cicd-installer/`
- `skills/ui-ux-secure-frontend-design/`
- `skills/windows-localhost-workflows/`

Declared full-fidelity or deterministic generated surfaces include:

- `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md` after the Secure CI/CD prompt pass, via exact extract from `_main/README.md`.
- `skills/ai-coding-agent-rules/AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md`, via exact copy recipes from source-side generated templates.
- `skills/n8n-agent-rules/n8n-agent-rules.md`, via exact copy from the canonical n8n agent rules partial.
- `skills/n8n-local-setup/references/n8n-agent-rules.md`, `skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md`, and `skills/n8n-workflow-templates/references/n8n-agent-rules.md`, via generated cross-skill reference recipes with explicit shared-surface metadata.
- `skills/n8n-local-setup/templates/mcp-configs/*-mcp-config.md`, via exact copy recipes.
- `skills/n8n-local-setup/references/n8n/*.md` required setup guides, via exact copy recipes from `_main/*.md`.
- `skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md`, `opencode.md`, and `antigravity.md`, via exact copy recipes from `_main/*.md`.
- `skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/*`, via exact copy from workflow-toolkit `_main`.
- `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/*`, via exact copy from workflow-toolkit `_main`.
- `skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json`, via JSON recipe from workflow-toolkit `_main`.
- `skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/*` and `data/**`, via exact copy recipes from the preserved local-only subset.
- `skills/knowledge-index-updater/SKILL.md`, `README.md`, and `agents/**`, via exact copy recipes from `_projects/knowledge/knowledge-index-updater/_main/skill/**`.
- `skills/windows-localhost-workflows/SKILL.md`, `README.md`, and `agents/**`, via exact copy recipes from `_projects/development/windows-localhost-workflows/_main/skill/**`.
- `skills/context-preserving-ai-publisher/references/validation-strategy.md`, via exact copy from `_projects/repo-methodology/context-preserving-ai-publisher/_main/validation-strategy.md`.

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

- `mcp/README.md`
- `mcp/installer-mcp/README.md`
- `mcp/installer-mcp/SECURITY.md`
- `mcp/installer-mcp/SPEC.md`
- `mcp/registry-mcp/README.md`
- `mcp/registry-mcp/SECURITY.md`
- `mcp/registry-mcp/SPEC.md`
- `mcp/references/README.md`
- `mcp/references/installer-mcp.md`
- `mcp/references/local-mcp-setup.md`
- `mcp/references/mcp-security.md`
- `mcp/references/registry-mcp.md`
- `mcp/registry/README.md`
- `mcp/registry/consumers.registry.json`
- `mcp/registry/packs.registry.json`
- `mcp/registry/playbooks.registry.json`
- `mcp/registry/skills.registry.json`
- `mcp/registry/source-repos.registry.json`
- `mcp/registry/templates.registry.json`
- `mcp/registry/tools.registry.json`
- `mcp/projects/secure-cicd-installer.md`
- `mcp/projects/ui-ux-pro-max.md`
- `mcp/projects/n8n-local-setup.md`
- `mcp/projects/n8n-workflow-toolkit.md`
- `mcp/registry/projects.registry.json`

No MCP-ready registry, MCP reference, MCP design/spec, or MCP registry JSON surface remains undeclared. Project-specific MCP notes under `mcp/projects/**` remain owned by their project modules. `mcp/registry/projects.registry.json` remains generated from project manifests by toolkit sync.

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
Fixed in the Secure CI/CD prompt pass. The prompt is now generated by an exact `extract` recipe from `_main/README.md`, declared in `toolkit.project.json`, regenerated into the skill folder, and covered by tests that fail on future truncation or source drift.

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
- `_projects/development/ai-coding-agent-rules/_main/_partials/*.md`
- `_projects/development/ai-coding-agent-rules/_main/*.template.md`
- `_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md`
Published file(s):
- `skills/ai-coding-agent-rules/*.template.md`
- `skills/n8n-agent-rules/n8n-agent-rules.md`
- `skills/n8n-agent-rules/adapters/*.n8n-brief.template.md`
- `skills/*/references/n8n-agent-rules.md`
Problem:
The agent-rule templates are intentionally assembled from project-local `_main` partial sources into source-side inert `.template.md` files. Generic execution, toolkit skill-routing source, and the full n8n operating rules now belong to `development.ai-coding-agent-rules`. n8n local setup no longer owns the n8n MCP workflow safety rules.
Recommended fix:
Fixed in the inert template migration, cleanup, AI coding agent rules split, and n8n-agent-rules ownership pass. Keep the default generic templates slim, publish the full n8n rules through `skills/n8n-agent-rules/`, and use optional brief adapters only when a consumer repo wants active-file pointers.

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

No tracked `skills/` or `mcp/` files remain outside expanded project sync outputs or the generated project registry flow.

Pack-covered but undeclared files were found in these install surfaces:

```text
none
```

Recommended fix:
None for undeclared published files. Future PRs should keep new `skills/` and `mcp/` outputs source-owned through project modules.

## Cross-project ownership issues

Finding:
Severity: resolved
Source file(s):
- `_projects/cicd/secure-installer/_main/templates/n8n/**`
- `_projects/cicd/secure-installer/SOURCE-LOCK.json`
- `_projects/cicd/secure-installer/toolkit.project.json`
Published file(s):
- `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/**`
Problem:
The Secure CI/CD project retains n8n sync helper source provenance from `weijunswj/ai-cicd-installer`, while the outputs now belong in the `n8n-workflow-helper-scripts` skill surface.
Resolution:
The helpers are rehomed into `_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/` and are declared by `n8n.workflow-toolkit`. The retired Secure CI/CD `_main/templates/n8n/**` copies remain provenance-only, with no shared-surface output declarations.

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

Yes through declared project recipes and the generated project registry flow. Some published entrypoints intentionally use reviewed `curated_output_for_ai/` source or rare linked outputs, but no tracked `skills/` or `mcp/` file remains undeclared.

2. Are original old repos still needed?

For retired internal sources, no routine old-repo dependency is needed; `SOURCE-LOCK.json` preserves provenance. For the active third-party UI/UX source, the upstream repo remains relevant for attribution and future manually reviewed updates.

3. Which published surfaces can be regenerated from source without loss?

- Declared copy/concat/extract/json outputs in `toolkit.project.json`.
- Source-locked linked script/helper surfaces when the source-lock audit passes.
- `mcp/registry/projects.registry.json` from project manifests.

4. Which surfaces currently rely on manually maintained files?

No undeclared published files remain in the current audit baseline. The remaining directly maintained surfaces are the explicitly declared linked exceptions, such as the UI/UX MCP project note.

5. Which current generated outputs should be replaced by exact source extraction?

- Secure CI/CD prompt: done in the Secure CI/CD prompt pass.
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
- Rehome n8n sanitizer and import/export sync helpers under `n8n.workflow-toolkit`.
- Split the former workflow-sync published surface into `skills/n8n-workflow-helper-scripts/` and `skills/n8n-workflow-templates/`.
- Remove the obsolete `skills/n8n-workflow-sync/` generated surface and pack.
- Declare `skills/knowledge-index-updater/` and `skills/windows-localhost-workflows/` as project-owned generated skill surfaces.
- Declare repo-level MCP-ready registry docs/specs and registry metadata through `_projects/repo-methodology/mcp-ready-registry/`.

Recommended follow-up fixes:

- Clarify UI/UX skill manual surface ownership and attribution in recipes.

## Recommended PR sequence

1. Current PR: audit report, Secure CI/CD prompt exact extract, tests, and generated registry update.
2. PR 2: Add a deterministic surface audit command and CI test for undeclared project-like published files. Done by `repo/scripts/audit-published-surfaces.cjs` and its baseline check.
3. PR 3: n8n local setup fidelity pass. Publish full local references or declare short files as non-runtime overviews. Done for required runtime references.
4. PR 4: Secure CI/CD remaining template declaration pass for status, source update policy, GitHub Actions notes, and pack README. Done in `codex/declare-secure-cicd-remaining-templates`.
5. PR 5: Cross-owned n8n sync helper ownership cleanup. Done by explicit shared-surface metadata.
6. PR 6: n8n workflow-sync pack reference declaration pass. Done in `codex/declare-n8n-workflow-sync-references`.
7. PR 7: n8n workflow toolkit reshape. Done in `codex/reshape-n8n-workflow-toolkit`.
8. PR 8: MCP-ready registry ownership cleanup. Done in `codex/mcp-ready-registry-ownership`.
9. PR 9: UI/UX linked/manual surface provenance cleanup.

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
- Cross-ownership grep checks for `output` paths, `root_surface_path`, workflow helper-script outputs, and `_main/templates/n8n`.
- Duplicate-content hash audit across `_projects`, excluding `_generated`.
