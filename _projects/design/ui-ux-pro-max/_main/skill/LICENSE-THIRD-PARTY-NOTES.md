# License and Third-Party Notes

This skill was inspired by the public UI/UX Pro Max workflow idea:

- https://ui-ux-pro-max-skill.nextlevelbuilder.io/
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

This repository does not vendor the upstream package wrapper, generated outputs, templates, CLI installer, website assets, browser automation, dependency setup, or remote-service tooling from that project.

This is an independently written, instruction-first skill inspired by the high-level workflow idea. It captures the broad idea of moving from product brief to design system to page-level overrides to component planning to implementation review, with additional privacy, security, safety, accessibility, and maintainability guardrails.

The skill includes a reviewed local-only design-system generator subset with bundled CSV data for design creation and revision. That subset is documented under `tools/design-system-generator/` and is constrained to local data reads, no network downloads, no package installs, no shell expansion beyond the documented local Python command, and no writes outside the documented generator output folder.

The upstream repository should be audited separately before any additional executable pieces, generated assets, package dependencies, command-line tools, datasets, or templates are adopted.

## Google DESIGN.md Reference

This skill also includes a Toolkit-local reference for the Google Labs `DESIGN.md` / `design.md` format:

- https://github.com/google-labs-code/design.md
- License: Apache-2.0
- Toolkit source module: `_projects/design/google-design-md/`

The Toolkit adapts the upstream `docs/spec.md` concept into `references/design-md-contract.md` as documentation/reference support for reading and proposing design contracts. It does not vendor or execute the upstream CLI, package tooling, examples, workflows, lockfiles, generated assets, remote validators, package install paths, or `npx @google/design.md` commands.

The upstream format is alpha and actively tracked through `SOURCE-LOCK.json` with manual review required for updates.
