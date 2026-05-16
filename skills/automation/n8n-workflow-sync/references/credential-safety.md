# Credential Safety

Never commit real n8n credentials, credential exports, credential IDs, credential binding files, or token values.

## Safe Defaults

- Use n8n credential objects in the live instance.
- Keep local credential binding metadata in ignored `.n8n-local/` only.
- Keep live import/export payloads in ignored `.tmp/` only.
- Use obvious placeholders for template values.
- Document manual credential assignment by node and field, not by secret value.

## Unsafe

- Hardcoded authorization headers.
- Token values in Set nodes.
- Credential IDs in committed workflow JSON.
- Sticky notes containing credential names that reveal private systems.
- Live export files committed to repo.
