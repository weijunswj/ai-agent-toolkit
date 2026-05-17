# Templates

Templates are review-required source materials for consumer repos.

Project-owned template docs can be generated from declared recipes under [_projects/](../../_projects/). Update `_main/` or reviewed AI-facing source first, then run [repo/scripts/sync-toolkit-projects.cjs](../../repo/scripts/sync-toolkit-projects.cjs).

## Areas

- [Agent rules](agent-rules/): generated AI-agent rule files and their partials.
- [MCP configs](mcp-configs/): MCP config examples for Codex, Claude Code, OpenCode, and Antigravity.
- [n8n](n8n/): workflow sync helper templates, sanitizer scripts, and workflow policy notes.
- [CI/CD](cicd/): secure CI/CD installer prompt and status templates.
- [GitHub Actions](github-actions/): safe GitHub Actions patterns for this toolkit.

Do not copy templates blindly. Review target writes and keep secrets out of repo files.

Some templates intentionally generate files:

- `agent-rules/` generation writes only generated `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`.
- `n8n/` helper templates may write reviewed workflow JSON and ignored local staging folders in consumer repos.

Those writes do not permit committing secrets, live exports/imports, credential bindings, package artifacts, `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, or `.sanitised/**`.
