# Source Of Truth

This repo owns reusable AI-agent toolkit assets.

The compact shared contract lives in [_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md](../../_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md) and is synced into the main entry points with `node repo/scripts/sync-repo-doc-contract.cjs --write`.

## Toolkit-Owned

- Reusable skills.
- Reusable guides.
- Agent-rule templates.
- MCP config templates.
- n8n helper-template sources.
- CI/CD installer guides and templates.
- Optional local-only tools.
- Pack manifests.

## Product-Owned

Product repos own:

- Product code.
- Product workflows.
- Product configs.
- Customer data.
- Live n8n workflow exports.
- Local helper outputs such as `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, and `.sanitised/**`.
- Production deployment settings.

Do not move product-owned assets into this toolkit.

## Published Surfaces

The repo-wide generated surface is skills-first plus native plugin metadata. Humans use `_projects/**` for source review and maintenance, agents use generated `skills/**` folders after sync, and native plugin installers read generated `.codex-plugin/**` or `.claude-plugin/**` metadata. Repo-wide MCP is intentionally not shipped or maintained as a generated surface for now.

Native plugin metadata is not source of truth:

- `.codex-plugin/**` is generated Codex package metadata.
- `.claude-plugin/**` is generated Claude Code package metadata.
- Neither native package may install or update the other native platform.
- OpenCode and AG2 adapter outputs are generated under the user-local Toolkit Local Bridge Hub after explicit target enablement.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

## Project Versions And Source Locks

`toolkit.project.json` owns the toolkit project module version and routing contract. Every project manifest must include `version`, `version_policy: "semver"`, and non-empty `version_notes`.

`SOURCE-LOCK.json` owns source/upstream provenance: source repo, source ref, locked commit, source lifecycle, source role, update policy, public attribution requirement, allowlisted files, and blob pins.

For third-party projects, the toolkit project version is the toolkit adaptation version, not the upstream third-party version. Scheduled source-watch tasks must read normal upstream tracking from `SOURCE-LOCK.json`, not `toolkit.project.json`, including `source_update_policy`. Separate actionable advisory targets may live in `repo/source-watch/advisory-targets.json` until they are implemented, rejected, or moved into SOURCE-LOCK tracking. Periodic host-harness capability drift review also lives under `repo/source-watch/` and may only recommend separate evidence-backed PRs. Notification PRs may report that an upstream ref moved or a manual review is due, but they must not update source pins, advisory baselines, advisory target documents, toolkit components, or copy upstream files. Git tags, package tags, and GitHub release tags are not substitutes for toolkit project versions, and this repo does not use per-file versions.

## Protected Generated-Surface Fidelity

Candidate-controlled generated auto-sync and PR-branch writeback are retired. The protected App-dispatched repository-security authority now owns deterministic generated-surface verification.

- The exact default-branch authority and exact candidate head are checked out into separate roots.
- Candidate workflows, controllers, generators, actions, and tests are inert data and cannot select the generator or publish a result.
- Protected generator paths, bytes, dependency lock, source manifest, authority tree, candidate tree, expected output manifest, and comparison result are digest-bound.
- Generation occurs only in an operation-owned directory. No candidate branch commit, push, force push, token, secret, or writeback path exists.
- An aligned candidate passes. A mismatch fails with bounded path-only evidence and local regeneration guidance; the author commits source-first outputs normally.
- Forks and same-repository PRs use the same no-secret, read-only comparison. Missing, stale, redirected, mutable, or ambiguous evidence fails closed.

## Skill-Local Packs

Pack manifests are not a first-class root surface. When a pack is still useful as a review checklist, keep it inside the related skill folder under `skills/<skill-name>/packs/`. For internal generated packs, author the project-owned source under `_projects/**/curated_output_for_ai/packs/` and run sync.

## Retired Source Provenance

The toolkit is now the canonical source of truth. Historical provenance for retired internal source repos lives in [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md); permanent docs should link to toolkit-owned paths or third-party attribution notes.
