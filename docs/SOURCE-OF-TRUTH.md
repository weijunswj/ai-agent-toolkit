# Source Of Truth

This repo owns reusable AI-agent toolkit assets.

## Toolkit-Owned

- Reusable skills.
- Reusable guides.
- Agent-rule templates.
- MCP config templates.
- n8n helper-template sources.
- CI/CD installer guides and templates.
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

The JSON registries under `registry/` are the source of truth for toolkit discovery.

## Packs

Pack manifests under `packs/*/pack.json` are the source of truth for installable bundles.

## Source Repos

Source repos are migration and update inputs. They are not runtime dependencies. Use source repo names and source-relative paths when documenting migrated material.
