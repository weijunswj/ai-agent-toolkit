# Source Manifest: Knowledge Index Updater

## Preserved In `_main/`

- `source-provenance.md`
- `standalone-skill-readme.md`

The preserved files record that this module adopts first-party standalone skill material that already lived under the root `skills/` surface.

## AI-Facing Surfaces

- `skills/knowledge-index-updater/SKILL.md` is generated from project-owned curated AI output.
- `skills/knowledge-index-updater/README.md` is generated from project-owned curated AI output as a concise install/use note.
- `skills/knowledge-index-updater/agents/claude.md` is generated from project-owned curated AI output.
- `skills/knowledge-index-updater/agents/openai.yaml` is generated from project-owned curated AI output.

The curated skill entrypoint and platform metadata mirror the existing standalone skill content so this PR changes ownership and generated-surface declaration without redesigning the skill. The previous detailed standalone README is preserved under `_main/standalone-skill-readme.md`; the published README now stays a concise skill-local index because the full runtime workflow already lives in `SKILL.md`.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- Credentials, `.env*`, private keys, credential exports, live service exports, package artifacts, and product repo files.
- Live Notion, GitHub, or scheduler data.
- MCP output. This module publishes only the standalone skill surface plus the generated project registry update.
