# Source Manifest: Windows Localhost Workflows

## Preserved In `_main/`

- `source-provenance.md`
- `skill/README.md`
- `skill/SKILL.md`
- `skill/agents/openai.yaml`

`_main/skill/**` contains the canonical full standalone skill source promoted from the existing root `skills/windows-localhost-workflows/` folder in the pinned source commit.

## AI-Facing Surfaces

- `skills/windows-localhost-workflows/README.md` is generated from `_main/skill/README.md`.
- `skills/windows-localhost-workflows/SKILL.md` is generated from `_main/skill/SKILL.md`.
- `skills/windows-localhost-workflows/agents/openai.yaml` is generated from `_main/skill/agents/openai.yaml`.

The published skill outputs are deterministic copies from `_main/skill/**`. Markdown outputs receive the standard generated notice required by the sync system; the underlying standalone skill content is preserved in `_main/skill/**`.

`curated_output_for_ai/**`, if present in the future, is reserved for short adapter, index, wrapper, or metadata surfaces. It is not the canonical home for the full skill instructions.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- Credentials, `.env*`, private keys, credential exports, local dev logs, package artifacts, and product repo files.
- Live service state or localhost process data.
- MCP output. This module publishes only the standalone skill surface plus the generated project registry update.
