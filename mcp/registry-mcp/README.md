# Registry MCP

The registry MCP is a future read-only server for discovering toolkit metadata.

It consumes JSON registries with `JSON.parse` and exposes discovery/routing only.

No shell execution. No arbitrary file writes. No arbitrary file reads outside approved toolkit content.
