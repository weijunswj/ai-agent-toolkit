# Project Rehaul Checklist

Use this checklist when reviewing the project-module architecture.

## Module Shape

- [ ] Each project has `README.md`, `SOURCE-MANIFEST.md`, `SOURCE-LOCK.json`, `toolkit.project.json`, and `_main/`.
- [ ] `_main/` preserves actual source files without truncating full guides.
- [ ] `curated_output_for_ai/` exists only when reviewed AI-facing source material is needed.
- [ ] No `source-repos/`, generic `original/`, or generic `derived/` pattern is introduced.

## AI-Facing Surfaces

- [ ] [skills/](../../skills/) and [mcp/](../../mcp/) remain obvious as the only published AI-facing root surfaces.
- [ ] Skills and MCP docs are generated from declared recipes where practical, with rare linked root surfaces justified in manifests.
- [ ] Generated Markdown outputs include a generated-source notice.
- [ ] Root agent-rule templates are generated from declared `_main/` and linked partial sources, and unmanaged root partial duplicates do not exist.
- [ ] `SOURCE-LOCK.json` files pass the source-lock audit.

## Safety

- [ ] `toolkit.project.json` declares allowed writes and denied writes.
- [ ] Live actions are explicit-confirmation only.
- [ ] CI live actions are disabled.
- [ ] Forbidden files and private/generated artifacts are absent.
- [ ] Instruction-only skills contain no executable files.

## Design Generator

- [ ] Optional generator lives under [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../skills/ui-ux-secure-frontend-design/tools/design-system-generator/).
- [ ] It searches local CSV data only.
- [ ] It contains no network, shell, browser, subprocess, or installer code.
- [ ] Third-party MIT attribution is preserved.

## Validation

Run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/package-packs.cjs --check
node repo/scripts/run-design-tests.cjs
git diff --check
```
