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
