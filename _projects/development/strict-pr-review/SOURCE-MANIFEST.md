# Source Manifest: Strict PR Review

## Preserved In `_main/`

- `source-provenance.md`
- `skill/README.md`
- `skill/SKILL.md`
- `skill/agents/openai.yaml`

`_main/skill/**` contains first-party instruction-only skill source authored for this toolkit.

## Provenance

This module is first-party toolkit-authored source. No third-party text, scripts, schemas, assets, generated files, or installer code were copied into this module. External PR-review practices were treated only as general ecosystem context.

## AI-Facing Surfaces

- `skills/strict-pr-review/README.md` is generated from `_main/skill/README.md`.
- `skills/strict-pr-review/SKILL.md` is generated from `_main/skill/SKILL.md`.
- `skills/strict-pr-review/agents/openai.yaml` is generated from `_main/skill/agents/openai.yaml`.

The published skill outputs are deterministic copies from `_main/skill/**`. Markdown outputs receive the standard generated notice required by the sync system.

## Excluded

- Scripts, helper tools, package manifests, generated dependency folders, binaries, archives, and vendored dependencies.
- Credentials, `.env*`, private keys, credential exports, customer data, product repo files, live service state, and deployment outputs.
- MCP output. This module publishes only the standalone skill surface.
