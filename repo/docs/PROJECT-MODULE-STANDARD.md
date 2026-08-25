# Canonical Surface Standard

This repository uses direct canonical surfaces. It no longer maintains project manifests, curated-output trees, generated previews, or project-to-skill publishing.

## Surface Roles

- `skills/<skill-name>/` is a complete copyable skill folder containing `SKILL.md` and any required README, references, templates, agents, tools, or tests.
- `repo/contracts/` contains machine-readable contracts and reviewed source inputs that are not themselves portable skills.
- `repo/scripts/` contains deterministic runtime and maintenance helpers.
- `repo/tests/` contains focused contract, parser, safety, and runtime tests.
- `repo/source-watch/provenance/` contains active third-party attribution locks.
- `repo/docs/` contains policy, safety, architecture, and validation guidance.
- `.codex-plugin/` and `.claude-plugin/` contain native plugin package metadata; their source manifests are under `repo/contracts/toolkit-local-bridge/`.

## Skill Creation And Routing

Before adding a skill, inspect existing `skills/**`, README skill tables, the Skill Safety Matrix, and `repo/contracts/agent-rules/toolkit-skill-routing.md`. Prefer extending an existing skill when the trigger, safety boundary, local assets, and validation path fit without making it ambiguous or bloated.

Every concrete `skills/<skill-name>/SKILL.md` must have:

- A matching folder name and frontmatter name.
- A concise, accurate description with the exact trigger and non-trigger boundary.
- Local runtime context for required instructions; external links may support provenance but must not be required for normal use.
- A README or install/use note.
- A routing entry or an intentional omission with a concrete reason.
- A row in `repo/docs/SKILL-SAFETY-MATRIX.md`.

If a skill uses third-party material, run `agent-skill-supply-chain-audit` before copying, importing, executing, or adapting it. Preserve attribution and keep the active source lock under `repo/source-watch/provenance/`.

## Agent Rules

The source inputs for managed instruction blocks and portable repo-local templates live under `repo/contracts/agent-rules/`. Keep `AI-AGENT-TOOLKIT` markers intact and use `repo/scripts/sync-agent-instruction-shims.cjs` for the root shims and manual templates. Portable templates must not depend on Toolkit-only paths.

## Validation

Use targeted checks while editing:

```powershell
node repo/scripts/sync-agent-instruction-shims.cjs --check
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/audit-published-surfaces.cjs --check
node repo/scripts/audit-skill-portability.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/<focused-test>.test.cjs
git diff --check
```

The read-only CI workflow owns the full validation gate. Do not run project scripts, live n8n actions, network downloads, or package installation as part of surface validation.
