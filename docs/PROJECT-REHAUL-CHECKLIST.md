# Project Rehaul Checklist

Use this checklist when reviewing the project-module architecture.

## Module Shape

- [ ] Each project has `README.md`, `SOURCE-MANIFEST.md`, `SOURCE-LOCK.json`, `toolkit.project.json`, and `_main/`.
- [ ] `_main/` preserves actual source files without truncating full guides.
- [ ] `curated_output_for_ai/` exists only when a reviewed transformation is needed.
- [ ] No `source-repos/`, generic `original/`, or generic `derived/` pattern is introduced.

## Root Surfaces

- [ ] Root [skills/](../skills/), [mcp/](../mcp/), [templates/](../templates/), [packs/](../packs/), [tools/](../tools/), [registry/](../registry/), and [guides/](../guides/) remain obvious.
- [ ] Skills and MCP docs are generated from declared recipes or maintained as linked root surfaces, not summarised from arbitrary `_main/` files.
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

- [ ] Optional generator lives under [tools/design-system-generator/](../tools/design-system-generator/).
- [ ] It searches local CSV data only.
- [ ] It contains no network, shell, browser, subprocess, or installer code.
- [ ] Third-party MIT attribution is preserved.

## Validation

Run:

```powershell
node scripts/sync-toolkit-projects.cjs --check
node scripts/audit-project-source-locks.cjs
node scripts/validate-toolkit.cjs
node --test tests/*.test.cjs
node scripts/package-skills.cjs --check
node scripts/package-packs.cjs --check
python -m unittest discover -s tools/design-system-generator/tests
git diff --check
```
