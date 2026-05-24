# Source Manifest: <Project Title>

## Preserved In `_main/`

- `<full source file>`
- `<templates/**>`

## AI-Facing Surfaces

- `<published output>` is generated from `<source>` using `<recipe>`.
- `<curated output>` is generated from reviewed adapter source.

## Skill Routing Decision

- Agent-usable skill: `<yes/no>`.
- Listed in toolkit skill routing: `<yes/no>`.
- If omitted from routing, reason: `<short reason>`.
- `SKILL.md` description supports implicit invocation: `<yes/no>`.
- Local support folders needed inside the skill folder: `<references/examples/templates/tools/assets/packs/none>`.
- README, registry, and routing updates needed: `<yes/no and paths>`.
- Validation proving source/generated alignment: `<commands>`.

## Link Shims

- None.

If exact-copied docs contain source-relative links that break after publishing, add tiny compatibility shims, declare them in the manifest, and explain them here.

## Excluded

- Credentials, private keys, live exports, local-only output, product files, package artifacts, and anything else this repo forbids.
