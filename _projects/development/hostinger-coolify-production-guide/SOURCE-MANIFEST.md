# Source Manifest: Hostinger Coolify Production Guide

## Preserved In `_main/`

- `hostinger-coolify-production-guide.md`

`_main/hostinger-coolify-production-guide.md` is the full runtime guide and preserved first-party source for the Hostinger VPS plus Coolify zero-to-production runbook.

## Curated AI-Facing Source

- `curated_output_for_ai/skills/hostinger-coolify-production-guide/SKILL.md`
- `curated_output_for_ai/skills/hostinger-coolify-production-guide/README.md`
- `curated_output_for_ai/skills/hostinger-coolify-production-guide/agents/openai.yaml`
- `curated_output_for_ai/references/hostinger-coolify-production-guide/README.md`

`curated_output_for_ai/skills/hostinger-coolify-production-guide/**` owns the AI-facing skill entrypoint, skill README, and skill-local agent metadata that route agents to safe repository-preparation work and to the local full guide reference when the user needs human-owned runbook context.

## Provenance

This module is first-party toolkit-authored source. No third-party text, scripts, schemas, assets, generated files, installer code, customer settings, production secrets, or product repository code were copied into this module. External vendor docs were treated only as factual context.

## AI-Facing Surfaces

- `skills/hostinger-coolify-production-guide/README.md` is generated from `curated_output_for_ai/skills/hostinger-coolify-production-guide/README.md`.
- `skills/hostinger-coolify-production-guide/SKILL.md` is generated from `curated_output_for_ai/skills/hostinger-coolify-production-guide/SKILL.md`.
- `skills/hostinger-coolify-production-guide/agents/openai.yaml` is generated from `curated_output_for_ai/skills/hostinger-coolify-production-guide/agents/openai.yaml`.
- `skills/hostinger-coolify-production-guide/references/hostinger-coolify-production-guide.md` is an exact generated copy of `_main/hostinger-coolify-production-guide.md`.
- `skills/hostinger-coolify-production-guide/references/README.md` is generated from `curated_output_for_ai/references/hostinger-coolify-production-guide/README.md` as a short skill-local index.

The full runtime guide is published with full fidelity from `_main/`. The curated output is limited to concise skill entrypoints, skill-local metadata, and navigation.

## Excluded

- Real secrets, API tokens, private keys, passwords, credential exports, `.env*` files except placeholder-only examples, and customer data.
- Real domains, production VPS IPs, billing information, production deployment settings, product repository code, database dumps, backup archives, and deployment outputs.
- Live Hostinger, Coolify, GitHub, DNS, SSL, deployment, migration, backup, restore, cutover, or rollback actions.
- MCP output. This module publishes only a standalone skill surface with local references.
