# AI Agent Toolkit Repo Rules

This repo is the canonical reusable AI Agent Toolkit.

<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->
## Source-of-Truth Contract

This repo has a source layer and a published layer.

- `_projects/**/_main/` preserves full source material and original docs. Do not casually rewrite preserved source.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source material. Curated files may be AI-assisted, but they are source files and must be reviewed before publishing.
- `_projects/**/toolkit.project.json` is the routing contract. It declares which `_main/` or `curated_output_for_ai/` files publish to `skills/` and `mcp/` outputs.
- `skills/` contains copyable AI-agent skill folders. The whole skill folder is the install unit.
- `mcp/` contains MCP specs, command/tool notes, registries, and status documentation.
- Generated `skills/` and `mcp/` files must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved generated/synced outputs in `README.md`, `AGENTS.md`, `skills/**`, and `mcp/**`. It must not update source files, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync must not run full repo validation against raw PR heads; this avoids blocking otherwise valid behind-main PR branches.
- Auto-sync static checks are limited to generated-surface freshness checks and git diff checks before committing generated output.
- Auto-sync may run only deterministic sync/check/validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- If a PR mixes eligible source/routing/contract edits with forbidden workflow, maintenance-script, test, docs, package, lockfile, or preserved-source paths, auto-sync must fail instead of pushing.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
- A generated/public surface must not replace a full working document with a lossy summary. Summaries are allowed only for catalogues, descriptions, navigation tables, or clearly marked overview files.
- Required runtime context for a skill or MCP surface must be local, complete enough to use, and traceable to the project source. External links may support provenance or further reading, but must not be required for normal execution.
<!-- END SOURCE-OF-TRUTH-CONTRACT -->

## Agent Routing Rules

- Do not edit generated `skills/` or `mcp/` outputs directly unless that output is declared as `linked` in the relevant `_projects/**/toolkit.project.json`.
- If changing an internal skill, MCP doc, skill-local template, skill-local pack, or registry-backed MCP note, edit `_projects/**/curated_output_for_ai/` first, then run sync.
- If changing preserved source, edit `_projects/**/_main/`.
- If adding or moving a generated output, update the relevant `toolkit.project.json` recipe and `writes.allowed`.
- Do not generate curated files automatically from `_main`; curated content is reviewed source.
- Do not weaken safety rules around credentials, `.env`, `.tmp`, `.n8n-local`, live n8n actions, approval, attribution, or local-only constraints.
- Run sync, check, and relevant tests before reporting completion.

Keep the topology simple:

- `_projects/` preserves canonical human/source material. Full original docs and guides live in `_projects/**/_main/`.
- `skills/` contains copyable agent skills. Copy the whole skill folder, not only `SKILL.md`.
- `mcp/` contains MCP specs, registries, project MCP notes, and any implemented commands/tools.
- `repo/` contains repo maintenance assets: docs, scripts, tests, validation policy, and CI support.

## What Belongs Here

- Reusable AI skills under `skills/`.
- Skill-specific references, examples, templates, helper scripts, tools, and pack metadata inside the owning `skills/<skill-name>/` folder.
- JSON-only discovery registries and MCP design/spec material under `mcp/`.
- Repo policy, scripts, and tests under `repo/`.
- Preserved source material and reviewed source material under `_projects/`.

## What Does Not Belong Here

- Product repo code.
- Customer or business workflow JSON.
- Trading app code.
- Credentials, credential exports, credential binding files, private keys, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, or live n8n import/export files.
- Auto-merge, production deployment automation, or unscoped auto-commit. Any generated-output writeback must be same-repo PR-only, explicit, and validation-gated.
- Deprecated compatibility placeholders for removed layout surfaces.

## Documentation Rules

- Humans should use `_projects/**/_main/` for full source docs and original guides.
- `_projects/**/README.md` files should stay tiny landing cards.
- `skills/<skill-name>/README.md` files should explain how to copy/install/use the skill folder.
- `mcp/README.md` must say plainly whether the MCP surface is runnable today or design/spec-only.
- Do not present packs, playbooks, templates, registries, or tools as primary root user entrypoints.
- Do not edit preserved source docs inside `_projects/**/_main/` unless needed for safety or broken internal references caused by a refactor.

## Validation

Before reporting completion, run the relevant checks:

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/audit-skill-portability.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/package-packs.cjs --check
node repo/scripts/run-design-tests.cjs
git diff --check
```

## n8n Safety

Do not run live n8n import, export, activation, deactivation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo unless a future user request explicitly asks for that live action and confirms the target instance.
