# AI Agent Toolkit

Reusable AI-agent skills, templates, packs, registries, MCP design notes, and local-only tools.

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

## How Humans Should Use This Repo

Start here if you are browsing or copying things manually:

1. Use [_projects/**/_main/](_projects/) as the human source library. These folders hold the full preserved guides and original docs.
2. Use [for_ai/templates/](for_ai/templates/) when you need a copy-paste template, such as agent rules, MCP config notes, n8n helper docs, or CI/CD snippets.
3. Use [for_ai/packs/](for_ai/packs/) as checklists before copying multiple files. Packs are approval-gated manifests, not automatic installers in v1.
4. Use [repo/](repo/) only for maintaining this toolkit: validation scripts, tests, policy docs, provenance notes, and CI support.

The [for_ai/](for_ai/) tree is the published AI-facing layer. Humans can review it, but it is not the primary manual documentation layer. Many internal `for_ai/` files are generated from project-owned `_main/` or `curated_output_for_ai/` sources; update the project source and run sync instead of editing generated outputs directly. In particular:

- [for_ai/skills/](for_ai/skills/) contains portable instruction packs for AI agents.
- [for_ai/mcp/](for_ai/mcp/) contains future-facing MCP design documents. No MCP server implementation is shipped in v1.
- [for_ai/registry/](for_ai/registry/) contains JSON discovery metadata for tools and future installers.
- [for_ai/playbooks/](for_ai/playbooks/) contains short routing notes for agents and operators, not full replacement docs.

## Manual Skills And MCP Guide

For humans who want to use the skills manually:

1. Pick the skill folder under [for_ai/skills/](for_ai/skills/).
2. Read its `README.md` first, then its `SKILL.md`.
3. Copy the whole skill folder into the target agent's skill location so relative references, examples, and helper files stay together.
4. If a pack exists for that use case, review the matching [for_ai/packs/*/pack.json](for_ai/packs/) before copying files.
5. Do not copy secrets, `.env` files, credential exports, live n8n exports, or product/customer workflow JSON into this repo or out of it.

For humans who want to use the MCP material manually:

1. Read [for_ai/mcp/README.md](for_ai/mcp/README.md) first.
2. Treat [for_ai/mcp/projects/](for_ai/mcp/projects/) as project-specific MCP specs and safety notes.
3. Treat [for_ai/mcp/registry-mcp/](for_ai/mcp/registry-mcp/) and [for_ai/mcp/installer-mcp/](for_ai/mcp/installer-mcp/) as design references for future servers, not runnable services.
4. Use [for_ai/templates/mcp-configs/](for_ai/templates/mcp-configs/) for copy-paste MCP configuration notes when a consumer repo or agent needs them.
5. Keep live MCP credentials and local machine config outside this repo.

## Mental Model

| Path | Purpose |
| --- | --- |
| [_projects/](_projects/) | Canonical project-owned source layer. Humans should use `_projects/**/_main/` for preserved full source docs and `curated_output_for_ai/` for reviewed AI-facing source material. |
| [for_ai/](for_ai/) | AI-facing published assets: skills, MCP notes, templates, packs, registries, tools, and operator playbooks. Generated files include source notices. |
| [repo/](repo/) | Repo maintenance assets: validation scripts, tests, policy docs, provenance notes, and CI support. |

Root stays intentionally small: `README.md`, `AGENTS.md`, `package.json`, `.gitignore`, `.gitattributes`, `.github/`, `_projects/`, `for_ai/`, and `repo/`.

## Source Library

Project modules keep preserved source material in:

```text
_projects/<category>/<project>/_main/
```

Each project module also carries `toolkit.project.json`, `SOURCE-MANIFEST.md`, `SOURCE-LOCK.json`, and a tiny landing `README.md`. Those landing cards point to `_main/` and do not replace the preserved source docs.

Internal modules may also keep reviewed AI-facing source material in:

```text
_projects/<category>/<project>/curated_output_for_ai/
```

When `_main/` or `curated_output_for_ai/` changes, regenerate published outputs with `node repo/scripts/sync-toolkit-projects.cjs --write`.

Current project modules:

- [Local n8n Setup](_projects/n8n/local-setup/)
- [n8n Workflow Templates](_projects/n8n/workflow-templates/)
- [Secure CI/CD Installer](_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/)

## AI Surfaces

Use [for_ai/](for_ai/) for published assets that agents or installers consume:

- [Skills](for_ai/skills/)
- [MCP design notes](for_ai/mcp/)
- [Templates](for_ai/templates/)
- [Packs](for_ai/packs/)
- [Registries](for_ai/registry/)
- [Tools](for_ai/tools/)
- [AI/operator playbooks](for_ai/playbooks/)

`for_ai/playbooks/` contains concise routing and operating notes. It is not the canonical human documentation layer; use `_projects/**/_main/` for full source docs.

## Maintenance

Repo-local policy, validation, and CI support live under [repo/](repo/):

- [Docs](repo/docs/)
- [Scripts](repo/scripts/)
- [Tests](repo/tests/)

Source-watch is advisory and read-only. It renders update candidates from source-lock metadata but does not fetch upstream commits, copy files, update `SOURCE-LOCK.json`, create branches, create PRs, run live n8n actions, or mutate credentials.

Retired internal source repos remain provenance-only; see [Retired Source Provenance](repo/docs/RETIRED-SOURCE-PROVENANCE.md). The active third-party source `nextlevelbuilder/ui-ux-pro-max-skill` remains manual-review and attribution-gated.

## Validation

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/package-packs.cjs --check
python -m unittest discover -s for_ai/tools/design-system-generator/tests
git diff --check
```
