# Surface Fidelity Audit

Date: 2026-05-18
Latest update: 2026-06-21 (Toolkit Local Bridge v2 native plugin metadata and bridge skills)

## Current state

This audit is now a skills-first published-surface audit. The current generated/published root surface is `skills/**` plus generated native plugin metadata under `.codex-plugin/**` and `.claude-plugin/**`.

Repo-wide MCP generated/published output is intentionally absent for now:

- `mcp/**` is not shipped.
- `_projects/repo-methodology/mcp-ready-registry/**` is not shipped.
- Project manifests must not declare repo-wide `mcp/**` outputs or `publish_as: "mcp"` / `publish_as: "both"`.
- Future PRs that change published skill or native plugin metadata surfaces should run the published-surface audit and keep new `skills/**`, `.codex-plugin/**`, and `.claude-plugin/**` outputs source-owned.

The n8n local setup [official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are preserved as secondary AI-coding-agent setup material, not as repo-wide MCP support:

- `_projects/n8n/local-setup/_main/mcp setup - *.md`
- `_projects/n8n/local-setup/_main/templates/mcp-configs/**`
- `skills/n8n-local-setup/references/ai-agent-platforms/*.md`
- `skills/n8n-local-setup/templates/mcp-configs/**`

## Current audit snapshot

Current output from `node repo/scripts/audit-published-surfaces.cjs --check`:

| Metric | Current value |
| --- | ---: |
| projects | 15 |
| publishedFiles | 220 |
| declaredOutputFiles | 220 |
| packInstalledFiles | 74 |
| undeclaredPublishedFiles | 0 |
| packInstalledUndeclared | 0 |
| crossOwnedOutputs | 0 |
| sharedSurfaceOutputs | 3 |
| sharedSurfaceMetadataFindings | 0 |
| suspiciousPublishedSurfaces | 0 |
| duplicateProjectContentGroups | 0 |
| boundaryRecipeOutputs | 220 |
| boundaryRecipeFindings | 0 |
| curatedDirectoryFindings | 0 |

Current published-file classifications:

| Classification | Count |
| --- | ---: |
| declared_generated | 146 |
| pack_installed_declared | 74 |

Current boundary recipe classifications:

| Classification | Count |
| --- | ---: |
| curated_adapter | 3 |
| curated_agent_metadata | 1 |
| curated_index | 18 |
| curated_metadata | 3 |
| curated_pack_readme | 3 |
| curated_reference | 7 |
| curated_repo_local_agent_template | 4 |
| curated_router | 15 |
| curated_template | 2 |
| curated_template_index | 7 |
| generated_cross_skill_reference | 3 |
| main_full_fidelity | 154 |

Known baseline context:

- There are no current curated output boundary findings.
- There are no current curated directory boundary findings.
- The three shared-surface outputs are intentional generated n8n-agent-rules references used by dependent n8n skills. The count movement from the previous snapshot is explained by adding the first-party `toolkit-local-bridge` project, seven generated bridge command skill folders, and four generated native plugin metadata files, while preserving the existing n8n shared-surface references.

## Current project modules

- `_projects/cicd/secure-installer`
- `_projects/design/ui-ux-pro-max`
- `_projects/development/ai-coding-agent-rules`
- `_projects/development/local-ai-stack-safety`
- `_projects/development/managed-app-foundation-review`
- `_projects/development/project-completion-audit`
- `_projects/development/hostinger-coolify-production-guide`
- `_projects/development/self-hosted-service-safety`
- `_projects/development/toolkit-local-bridge`
- `_projects/development/windows-localhost-workflows`
- `_projects/knowledge/knowledge-index-updater`
- `_projects/n8n/local-setup`
- `_projects/n8n/workflow-toolkit`
- `_projects/repo-methodology/agent-skill-supply-chain-audit`
- `_projects/repo-methodology/context-preserving-ai-publisher`

## Current skill folders

- `skills/agent-skill-supply-chain-audit/`
- `skills/ai-coding-agent-rules/`
- `skills/audit-local-toolkit-bridge/`
- `skills/context-preserving-ai-publisher/`
- `skills/codex-ssh-hostinger-coolify-setup-maintainer/`
- `skills/disable-local-toolkit-bridge/`
- `skills/knowledge-index-updater/`
- `skills/local-ai-stack-safety/`
- `skills/managed-app-foundation-review/`
- `skills/project-completion-audit/`
- `skills/n8n-agent-rules/`
- `skills/n8n-local-setup/`
- `skills/n8n-workflow-helper-scripts/`
- `skills/n8n-workflow-templates/`
- `skills/self-hosted-service-safety/`
- `skills/secure-cicd-installer/`
- `skills/setup-ag2-bridge/`
- `skills/setup-all-non-native-bridges/`
- `skills/setup-local-toolkit-bridge/`
- `skills/setup-opencode-bridge/`
- `skills/sync-enabled-bridges/`
- `skills/ui-ux-secure-frontend-design/`
- `skills/windows-localhost-workflows/`

## Current native plugin metadata

- `.codex-plugin/plugin.json`
- `.codex-plugin/hooks/hooks.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/hooks/hooks.json`

## Deterministic audit command

This audit is backed by `repo/scripts/audit-published-surfaces.cjs`.

Use:

```powershell
node repo/scripts/audit-published-surfaces.cjs
node repo/scripts/audit-published-surfaces.cjs --check
```

The command inspects local Git-tracked `skills/**`, `.codex-plugin/**`, and `.claude-plugin/**` files, `_projects/**/toolkit.project.json`, and `skills/**/packs/**/pack.json`. It does not call the network, run project scripts, install packages, summarize with AI, or touch live n8n.

`--check` compares the current findings with `repo/docs/published-surface-audit-baseline.json`. If a PR intentionally resolves or reclassifies a known issue, update the baseline in the same PR after reviewing the exact count movement.

## Curated output boundary policy

Full working instructions should publish from `_projects/**/_main/**` directly or from deterministic source-side generated templates. Short reviewed adapters may publish from `_projects/**/curated_output_for_ai/**` when they do not replace full runtime instructions.

Allowed current curated-output categories:

- `SKILL.md` routers.
- Skill README and local README/index files.
- Pack manifests and generated metadata.
- Pack READMEs when they are short skill-local pack indexes.
- Agent metadata such as `agents/openai.yaml`.
- Reference-link compatibility shims.
- Short reviewed skill-local references that do not replace full runtime helper guides.
- Small reviewed template snippets and template indexes that do not replace full runtime instructions.
- Small reviewed template examples for local-only policy inputs.
- Small reviewed overview, safety wrapper, packaging, and adapter text that is not a lossy substitute for required runtime instructions.

Not allowed as current curated-output categories:

- Repo-wide MCP project/spec summaries.
- Repo-wide MCP registry metadata.
- Full runtime guides summarized into short curated files.

## Source-first rebuild assessment

The current repo can rebuild published skill surfaces from source-owned project recipes:

- `skills/**` outputs are declared in `_projects/**/toolkit.project.json`.
- Full runtime guides and helper assets publish from `_main/**` where full fidelity matters.
- Reviewed adapters, routers, indexes, and pack metadata publish from `curated_output_for_ai/**` only when they remain short AI-facing source.
- No tracked root `mcp/**` file is part of the current generated/published surface.

A clean wipe/rebuild is not recommended. Keep using staged source-first PRs: update source or curated files, run sync, run audit, then update the baseline only when intentional movement is understood.

## Historical and superseded audit notes

Earlier audit passes are retained here only as historical context. They do not describe the current published surface when they mention repo-wide MCP output.

Completed historical passes:

- Secure CI/CD prompt exact-extract pass: fixed a real truncation by generating `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md` from the preserved `_main/README.md` prompt section.
- n8n local setup fidelity pass: restored full-fidelity local setup references inside `skills/n8n-local-setup/references/**` and kept n8n AI-coding-agent setup references as secondary setup material.
- Secure CI/CD template declaration pass: declared remaining short status, policy, GitHub Actions, and pack README outputs as curated generated outputs.
- n8n workflow toolkit reshape: rehomed sanitizer/import/export helpers and reusable workflow templates under `n8n.workflow-toolkit`, removing the old workflow-sync skill surface.
- Standalone skill declaration pass: made `knowledge-index-updater` and `windows-localhost-workflows` project-owned generated skill surfaces.
- Category cleanup pass: renamed project categories to the current `_projects/development/**` and `_projects/repo-methodology/**` topology.
- UI/UX skill ownership pass: promoted UI/UX skill-local surfaces into project-owned source and deterministic skill outputs.

Superseded MCP-ready registry pass:

- A previous pass declared repo-wide MCP registry/design/spec files under `mcp/**` and `_projects/repo-methodology/mcp-ready-registry/**`.
- PR #113 supersedes that state by removing the repo-wide MCP generated/published surface and the dedicated MCP-ready registry module.
- Treat old MCP-ready registry ownership material as historical only. It must not be used as evidence that repo-wide MCP is currently shipped, maintained, or supported.

## Current recommended follow-up

- Keep future changes focused on `skills/**` and source-owned project recipes unless a separate approved PR deliberately reintroduces a repo-wide MCP strategy.
- Keep [official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references in the n8n local setup skill, not in a repo-wide MCP surface.
- Continue clarifying UI/UX skill attribution and source ownership in separate narrow PRs when needed.
