# Source Manifest: Google DESIGN.md Design Reference

## Preserved In `_main/`

- `design-md-contract.md`: Toolkit-local reference adapted from upstream `docs/spec.md` and reviewed for the UI/UX skill's local-only safety boundary.

## AI-Facing Surfaces

- `skills/ui-ux-secure-frontend-design/references/design-md-contract.md` is generated from `_main/design-md-contract.md` using a `copy` recipe.
- This is a shared-surface output: source provenance belongs to `design.google-design-md`; the published reference belongs inside the existing `design.ui-ux-pro-max` UI/UX skill because agents need it while doing frontend design work.

## Skill Routing Decision

- Agent-usable skill: no new skill.
- Listed in toolkit skill routing: no separate route.
- If omitted from routing, reason: this extends the existing `ui-ux-secure-frontend-design` skill instead of adding a new trigger surface.
- `SKILL.md` description supports implicit invocation: not applicable because no new `SKILL.md` entrypoint is published.
- Local support folders needed inside the skill folder: `references/design-md-contract.md` in the existing UI/UX skill.
- README, registry, and routing updates needed: UI/UX skill README and license notes are updated; no new route is needed.
- Validation proving source/generated alignment: `node repo/scripts/sync-toolkit-projects.cjs --check`, `node repo/scripts/audit-project-source-locks.cjs`, and `node repo/scripts/watch-project-sources.cjs --json`.

## Third-Party Review

- Verdict: `convert-with-edits`.
- Reason: upstream `docs/spec.md` is useful instruction/spec material under Apache-2.0, but the Toolkit should re-author a local, safety-bounded reference and exclude upstream executable/package tooling.
- Publisher workflow: `context-preserving-ai-publisher`.
- Supply-chain boundary: no upstream CLI, package manager, workflow, lockfile, example app, remote asset, or executable wrapper is copied or run.

## Link Shims

- None.

## Excluded

- Upstream CLI package files, TypeScript source, tests, examples, package manifests beyond provenance review, workflow files, lockfiles, generated assets, package install paths, and remote tooling.
- Credentials, private keys, live exports, local-only output, product files, package artifacts, and anything else this repo forbids.

