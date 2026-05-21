<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.mcp-ready-registry
Source: _projects/repo-methodology/mcp-ready-registry/_main/registry-mcp/SECURITY.md
Update the project source and run sync.
-->
# Registry MCP Security

The registry MCP must be read-only.

## Allowed

- Read JSON registry files.
- Return trusted paths inside the toolkit.
- Return selected skill context from approved skill folders.
- Produce install plans without writing files.

## Forbidden

- Shell execution.
- Arbitrary file reads.
- Arbitrary file writes.
- Dynamic tool descriptions from untrusted skill text.
- Secrets in logs or responses.
- Loading product repo files.

All registry parsing must use `JSON.parse`.
