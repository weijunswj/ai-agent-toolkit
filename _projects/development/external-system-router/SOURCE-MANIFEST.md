# Source Manifest: External System Router

## Preserved Source

- `_main/source-provenance.md` records first-party provenance and the authoritative implementation base.
- `_main/skill/**` owns the complete first-party skill, runtime, schemas, guidance, and optional advisory template.

## Generated Surface

- `skills/external-system-router/**` is generated as an exact copy of `_main/skill/**` and is the install unit.

## Factual Documentation Review

Current official documentation was reviewed at implementation time for Codex MCP/configuration/approval/tool scoping, Claude Code MCP scopes/trust, Coolify API/MCP, and n8n Skills/API/CLI/MCP. These sources support factual contracts only and are not copied into the published skill.

## Excluded

- Credentials, tokens, OAuth clients, cookies, environment values, private origins/IDs, provider responses, browser history, screenshots, customer/private data, live-system state, and product repository files.
- Generic unrestricted HTTP, shell, MCP, connector, or browser executors.
- Live provider calls and native live UAT evidence.
