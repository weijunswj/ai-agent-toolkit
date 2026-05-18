<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup References

These references are local to the copyable skill folder. Use them for normal execution instead of requiring access to `_projects/`.

| Guide | Use when |
| --- | --- |
| [local-setup.md](local-setup.md) | Installing Docker, running local n8n, enabling official MCP, and wiring Codex. |
| [upgrading.md](upgrading.md) | Upgrading n8n, n8n MCP, and related local tooling safely. |
| [tunnelling.md](tunnelling.md) | Exposing local n8n to temporary public webhook callers. |
| [docker-compose-ngrok.md](docker-compose-ngrok.md) | Using Docker Compose plus ngrok for local webhook development. |
| [vps-hosting.md](vps-hosting.md) | Moving from local development to always-on VPS hosting. |
