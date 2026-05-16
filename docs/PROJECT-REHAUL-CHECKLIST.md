# Project Rehaul Checklist

Use this checklist when reviewing the project-module architecture.

## Module Shape

- [ ] Each project has `README.md`, `SOURCE-MANIFEST.md`, `toolkit.project.json`, `main/`, `exports/`, and `_generated/`.
- [ ] `main/` preserves actual source files without truncating full guides.
- [ ] `exports/` contains only curated sources for root-level outputs.
- [ ] No `source-repos/`, generic `original/`, or generic `derived/` pattern is introduced.

## Root Surfaces

- [ ] Root [skills/](../skills/), [mcp/](../mcp/), [templates/](../templates/), [packs/](../packs/), [tools/](../tools/), [registry/](../registry/), and [guides/](../guides/) remain obvious.
- [ ] Skills and MCP docs are generated from explicit exports, not summarised from arbitrary `main/` files.
- [ ] Generated Markdown outputs include a generated-source notice.

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
node scripts/validate-toolkit.cjs
node --test tests/*.test.cjs
node scripts/package-skills.cjs --check
node scripts/package-packs.cjs --check
python -m unittest discover -s tools/design-system-generator/tests
git diff --check
```
