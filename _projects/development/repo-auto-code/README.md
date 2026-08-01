# Repo-Scoped Scheduled Auto-Code Protocol Design

First-party, source-only design material for issue #329 under Design Lock `DL-329-AUTO-CODE-001`.

## Status

The design preserves `G1 architecture -> G2 controller Design Lock -> G3 implementation/amendment -> fresh exact-head G4`.

This module has no installed skill entrypoint or consumer-facing output. It does not install or activate a skill, managed `AGENTS.md` block, GitHub workflow, scheduler, claim mechanism, PR enrolment, or runtime controller. The templates are inert design material. Global Toolkit installation and refresh never enable the future repository-scoped capability.

## Source

The full design, templates, and executable design-state fixtures are in [_main/](_main/). `SOURCE-MANIFEST.md` records ownership and the intentionally empty output boundary. `SOURCE-LOCK.json` records first-party provenance without copied or third-party file entries.

## Validation

The focused test discovers and executes every fixture: `node --test repo/tests/repo-auto-code-design.test.cjs`. Repository checks are `node repo/scripts/sync-toolkit-projects.cjs --check`, `node repo/scripts/audit-project-source-locks.cjs`, and `node repo/scripts/validate-toolkit.cjs`.
