# Google DESIGN.md Design Reference

This module tracks [google-labs-code/design.md](https://github.com/google-labs-code/design.md) as an active third-party attribution source for the Toolkit UI/UX skill.

`DESIGN.md` is useful to the toolkit as an instruction-first design contract: it gives agents a portable place to read visual identity, design tokens, component styling intent, and design rationale before changing frontend visuals.

The preserved Toolkit-local source is in [_main/](_main/).

## Scope

- Preserve a Toolkit-local, stack-neutral reference in `_main/design-md-contract.md`.
- Publish that reference into `skills/ui-ux-secure-frontend-design/references/design-md-contract.md` as a shared-surface output owned by this source module.
- Track upstream `docs/spec.md` and license/provenance metadata in `SOURCE-LOCK.json`.
- Keep source-watch manual-review-only because the upstream format is alpha and actively changing.

## Out Of Scope

- No upstream CLI dependency.
- No package install or `npx @google/design.md` execution.
- No upstream code execution.
- No remote assets or network calls from the UI/UX skill.
- No vendoring of the upstream repository, package, examples, workflows, or lockfiles.
