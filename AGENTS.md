# AI Agent Toolkit Repo Rules

This repo is the canonical reusable AI Agent Toolkit.

<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->
## Source-of-Truth Contract

This repo has a source layer and a published layer.

- `_projects/**/_main/` preserves full source material and original docs. Do not casually rewrite preserved source.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source material. Curated files may be AI-assisted, but they are source files and must be reviewed before publishing.
- `_projects/**/toolkit.project.json` is the routing contract. It declares which `_main/` or `curated_output_for_ai/` files publish to `skills/` and `mcp/` outputs.
- `skills/` contains copyable AI-agent skill folders. The whole skill folder is the install unit.
- `mcp/` contains MCP-ready registry, design/spec docs, metadata, and status documentation for future MCP usage.
- Generated `skills/` and `mcp/` files must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved generated/synced outputs in `README.md`, `AGENTS.md`, `skills/**`, `mcp/**`, and the declared source-side agent-rule templates generated from `_projects/**/_main/_partials/**`. It must not update other source files, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync must not run full repo validation against raw PR heads; this avoids blocking otherwise valid behind-main PR branches.
- Auto-sync static checks are limited to generated-surface freshness checks and git diff checks before committing generated output.
- Auto-sync may run only deterministic generation, sync, check, or validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- Auto-sync is optional convenience writeback, not the merge gate. `npm run validate:all` is the required full validation gate for PRs and `main`.
- If a PR includes `_projects/**/_main/**` source/provenance changes other than declared agent-rule partial inputs and generated source-side agent-rule templates, auto-sync must skip successfully without checkout, writeback, commit, or push. The author or Codex must commit required generated outputs, source-lock/provenance updates, and audit baseline updates, then pass `npm run validate:all`.
- If a writeback-eligible PR mixes eligible source/routing/contract edits with forbidden workflow, maintenance-script, test, docs, package, lockfile, or other unsafe paths, auto-sync must fail instead of pushing.
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

## Mandatory Repo Docs By Task

Before changing this repo, read the docs that match your task. These docs are part of the repo contract, not optional background reading.

| Task | Required docs |
|---|---|
| Any AI-agent change | [`repo/docs/FOR_AI_AGENTS.md`](repo/docs/FOR_AI_AGENTS.md), [`repo/docs/SOURCE-OF-TRUTH.md`](repo/docs/SOURCE-OF-TRUTH.md) |
| New or changed project module | [`repo/docs/PROJECT-MODULE-STANDARD.md`](repo/docs/PROJECT-MODULE-STANDARD.md), [`repo/docs/SURFACE-FIDELITY-AUDIT.md`](repo/docs/SURFACE-FIDELITY-AUDIT.md) |
| New or changed skill/MCP/published surface | [`repo/docs/PROJECT-MODULE-STANDARD.md`](repo/docs/PROJECT-MODULE-STANDARD.md), [`repo/docs/SURFACE-FIDELITY-AUDIT.md`](repo/docs/SURFACE-FIDELITY-AUDIT.md) |
| Source locks, retired repos, provenance | [`repo/docs/RETIRED-SOURCE-PROVENANCE.md`](repo/docs/RETIRED-SOURCE-PROVENANCE.md), [`repo/docs/PROJECT-MODULE-STANDARD.md`](repo/docs/PROJECT-MODULE-STANDARD.md) |
| Third-party-attributed source | [`repo/docs/THIRD-PARTY-SOURCE-NOTES.md`](repo/docs/THIRD-PARTY-SOURCE-NOTES.md), [`repo/docs/PROJECT-MODULE-STANDARD.md`](repo/docs/PROJECT-MODULE-STANDARD.md) |
| Generated-output writeback, sync, or privileged workflow changes | [`repo/docs/WRITE-SAFETY-MODEL.md`](repo/docs/WRITE-SAFETY-MODEL.md), [`repo/docs/SAFE-UPDATES.md`](repo/docs/SAFE-UPDATES.md) |
| Cleanup, deletion, or retirement | [`repo/docs/CLEANUP-POLICY.md`](repo/docs/CLEANUP-POLICY.md), [`repo/docs/RETIRED-SOURCE-PROVENANCE.md`](repo/docs/RETIRED-SOURCE-PROVENANCE.md) |
| Human usage/docs/navigation changes | [`repo/docs/HOW-TO-USE.md`](repo/docs/HOW-TO-USE.md), [`README.md`](README.md) |

If a task touches multiple areas, read all matching docs.

For new or changed project modules, `repo/docs/PROJECT-MODULE-STANDARD.md` is the detailed rulebook. `AGENTS.md` is the router; the project standard is the implementation contract.

## New Or Changed Project Checklist

When adding a new project module or changing a published skill/MCP surface:

- Treat `_projects/**/_main/**` as preserved source/provenance.
- Keep `SKILL.md` concise, but keep required runtime instructions local inside the copied skill folder.
- Do not replace full working docs, prompts, templates, setup guides, troubleshooting notes, or examples with lossy summaries.
- Use deterministic recipes in `toolkit.project.json`: `copy`, `extract`, `concat`, `curated`, `json`, or rare justified `linked`.
- If publishing a full source doc into a skill folder, prefer exact `copy` or `extract`.
- If exact copied docs contain old relative links that would break after publishing, add small compatibility shims under `curated_output_for_ai/reference-link-shims/` and declare them in `toolkit.project.json`.
- Do not add shims by default. Add them only when exact copied docs would otherwise have broken relative links.
- Update `SOURCE-MANIFEST.md` when a project uses shims, linked outputs, third-party source, or cross-surface composition.
- Update `SOURCE-LOCK.json` when preserved/source-locked material changes.
- Run `npm run validate:all` and `npm run audit:surfaces:check` before reporting completion.

Keep the topology simple:

- `_projects/` preserves canonical human/source material. Full original docs and guides live in `_projects/**/_main/`.
- Current `_projects/` categories are `cicd/`, `design/`, `development/`, `knowledge/`, `n8n/`, and `repo-methodology/`.
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

For expensive validation work, follow `repo/docs/VALIDATION-STRATEGY.md`: use targeted checks while developing, then run full validation before final PR-ready reporting. Do not loop `npm run validate:all` repeatedly when a narrower failing check can be isolated.

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
