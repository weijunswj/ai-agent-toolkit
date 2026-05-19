# Source Manifest: Windows Localhost Workflows

## Preserved In `_main/`

- `source-provenance.md`

The preserved file records that this module adopts first-party standalone skill material that already lived under the root `skills/` surface.

## AI-Facing Surfaces

- `skills/windows-localhost-workflows/SKILL.md` is generated from project-owned curated AI output.
- `skills/windows-localhost-workflows/README.md` is generated from project-owned curated AI output.
- `skills/windows-localhost-workflows/agents/openai.yaml` is generated from project-owned curated AI output.

The curated source files mirror the existing standalone skill content so this PR changes ownership and generated-surface declaration without redesigning the skill.

## Link Shims

No compatibility shims are used in this module.

## Excluded

- Credentials, `.env*`, private keys, credential exports, local dev logs, package artifacts, and product repo files.
- Live service state or localhost process data.
- MCP output. This module publishes only the standalone skill surface plus the generated project registry update.
