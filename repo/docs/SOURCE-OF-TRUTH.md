# Source Of Truth

This repo owns reusable AI-agent toolkit assets.

## Toolkit-Owned

- Reusable skills.
- Reusable guides.
- Agent-rule templates.
- MCP config templates.
- n8n helper-template sources.
- CI/CD installer guides and templates.
- Optional local-only tools.
- Pack manifests.
- Registry metadata.
- MCP design specs.

## Product-Owned

Product repos own:

- Product code.
- Product workflows.
- Product configs.
- Customer data.
- Live n8n workflow exports.
- Local helper outputs such as `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, and `.sanitised/**`.
- Production deployment settings.

Do not move product-owned assets into this toolkit.

## Registries

The JSON registries under `for_ai/registry/` are the source of truth for toolkit discovery.

## Packs

Pack manifests under [for_ai/packs](../../for_ai/packs/) are the source of truth for installable bundles.

## Retired Source Provenance

The toolkit is now the canonical source of truth. Historical provenance for retired internal source repos lives in [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md); permanent docs should link to toolkit-owned paths or third-party attribution notes.
