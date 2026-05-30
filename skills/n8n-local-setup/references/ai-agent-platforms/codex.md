<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/mcp setup - codex.md
Update the project source and run sync.
-->
# Codex MCP Setup

This setup connects Codex to your local n8n instance via MCP.

Copy the whole `skills/<skill-name>/` folder. Do not just copy `SKILL.md`.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
| --- | --- |
| Repo-local | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
| Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

1. Create a skill folder for Codex in a supported location (e.g. `~/.agents/skills/n8n-local-setup/`).
2. Copy the whole `skills/<skill-name>/` folder. Do not just copy `SKILL.md`.
3. Locate `templates/mcp-configs/codex-mcp-config.md` from the copied folder.
4. Add the configuration to your Codex setup.

### Smoke Testing

Use docs-first/live-read-only smoke tests to verify the setup:

* Read workflows and test retrieving data.
* Do not perform live mutations without explicit confirmation.
* Ensure you always keep explicit confirmation enabled before live mutations.

### Safety

* Keep your MCP token safe. Do not commit it to your repository.
* Avoid granting arbitrary shell-execution MCP tools.
