# Packs

Packs are approval-gated install bundle manifests. Each pack has a `pack.json` file that lists source files, allowed writes, denied writes, approval requirements, and notes.

Packs are not installed automatically in v1. Review a pack before copying any files into a consumer repo.

Project-owned pack manifests are AI-facing published surfaces declared in [_projects/**/toolkit.project.json](../../_projects/). Keep `requires_approval` true and `run_commands` false by default.
