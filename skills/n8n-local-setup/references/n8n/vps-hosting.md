# VPS Hosting

Use VPS hosting when n8n needs a stable public URL and real uptime.

## Common Options

- n8n Cloud for managed hosting.
- Provider Docker template for beginner setup.
- Docker Compose on a VPS for control and portability.
- Coolify-managed deployment when a team wants a platform layer.

## Production Defaults

For serious use, prefer PostgreSQL-backed n8n. For heavier workloads, consider queue mode with workers.

## Safety

- Use HTTPS.
- Back up data.
- Keep secrets in platform secrets or environment variables.
- Avoid local tunnelling scripts on production servers.
- Test upgrades during a quiet window.
