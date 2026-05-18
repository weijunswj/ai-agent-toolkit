# AI-Facing Published Surface

`for_ai/` is the published AI-facing surface for this toolkit. It is useful for humans and AI consumers, but `_projects/` owns source for internal generated material.

<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->
## Source-of-Truth Contract

This repo has a source layer and a published layer.

- `_projects/**/_main/` preserves full source material and original docs. Do not casually rewrite preserved source.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source material. Curated files may be AI-assisted, but they are source files and must be reviewed before publishing.
- `_projects/**/toolkit.project.json` is the routing contract. It declares which `_main/` or `curated_output_for_ai/` files publish to which `for_ai/` outputs.
- `for_ai/` is the published AI-facing surface for skills, MCP notes, templates, packs, registries, tools, and playbooks.
- Generated `for_ai/` files must not be edited directly. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes declared generated/synced outputs. It must not update source files, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or address skill portability.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync may run only deterministic sync/check/validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- If a PR mixes eligible source/routing/contract edits with forbidden workflow, maintenance-script, test, docs, package, lockfile, or preserved-source paths, auto-sync must fail instead of pushing.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
<!-- END SOURCE-OF-TRUTH-CONTRACT -->

## Contents

- `for_ai/skills/`: published AI-agent skills.
- `for_ai/mcp/`: MCP design notes and project specs.
- `for_ai/templates/`: agent-rule, MCP, n8n, and CI/CD templates.
- `for_ai/packs/`: approval-gated bundle manifests.
- `for_ai/registry/`: JSON discovery metadata.
- `for_ai/tools/`: optional local-only tooling.
- `for_ai/playbooks/`: concise AI/operator playbooks.

Many internal files here are generated from `_projects/**/curated_output_for_ai/`. Generated files include source notices. To change generated content, edit the matching `_projects` source, then run `node repo/scripts/sync-toolkit-projects.cjs --write`.

`linked` exceptions must be declared in `toolkit.project.json`. Third-party or adapted tooling may have special attribution rules and must not be treated as personal or product-owned work.
