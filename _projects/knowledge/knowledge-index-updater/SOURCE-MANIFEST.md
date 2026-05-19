# Source Manifest: Knowledge Index Updater

## Preserved In `_main/`

- `source-provenance.md`
- `skill/README.md`
- `skill/SKILL.md`
- `skill/agents/claude.md`
- `skill/agents/openai.yaml`

`_main/skill/**` contains the canonical full standalone skill source promoted from the existing root `skills/knowledge-index-updater/` folder in the pinned source commit.

## AI-Facing Surfaces

- `skills/knowledge-index-updater/README.md` is generated from `_main/skill/README.md`.
- `skills/knowledge-index-updater/SKILL.md` is generated from `_main/skill/SKILL.md`.
- `skills/knowledge-index-updater/agents/claude.md` is generated from `_main/skill/agents/claude.md`.
- `skills/knowledge-index-updater/agents/openai.yaml` is generated from `_main/skill/agents/openai.yaml`.

The published skill outputs are deterministic copies from `_main/skill/**`. Markdown outputs receive the standard generated notice required by the sync system; the underlying standalone skill content is preserved in `_main/skill/**`.

`curated_output_for_ai/**`, if present in the future, is reserved for short adapter, index, wrapper, or metadata surfaces. It is not the canonical home for the full skill instructions.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- Credentials, `.env*`, private keys, credential exports, live service exports, package artifacts, and product repo files.
- Live Notion, GitHub, or scheduler data.
- MCP output. This module publishes only the standalone skill surface plus the generated project registry update.
