<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/mcp setup - codex.md
Update the project source and run sync.
-->
# Codex Official n8n Skills And MCP Setup

The primary local setup guide is [Page 1 - Local Setup](../n8n/local-setup.md).

This page is an optional Codex AI-coding-agent setup reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| Official n8n Skills | Workflow design, node guidance, validation, and build guidance through the official `n8n-io/skills` plugin. |
| `using-n8n-skills` | The first skill to load when starting n8n workflow work. |
| `n8n_live` | Official instance-level MCP access for read-only inspection or explicitly approved live changes. |
| Codex rules | Repo or user instructions for safer agent behavior. |
| Codex MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](../n8n/local-setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed if your Codex setup requires it.
   3. [Codex](https://openai.com/index/introducing-the-codex-app/) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Official instance-level MCP enabled in n8n.
   6. The official n8n MCP server URL copied from n8n.
   7. An official n8n MCP token copied from n8n.

Do not copy, fork, vendor, mirror, or recreate the official `n8n-io/skills` content inside this toolkit. Install the official plugin from its upstream source.

## 2. Install Codex

1. Install Codex using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   node -v
   npm -v
   ```

## 3. Install Official n8n Skills For Codex

Run these Codex plugin commands:

```powershell
codex plugin marketplace add n8n-io/skills
codex plugin add n8n-skills@n8n-io
```

Then:

1. Restart Codex.
2. Approve or trust the plugin hooks when Codex prompts you so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.
3. Start n8n work by loading `using-n8n-skills`.

## 4. Install Toolkit Safety Rules For Codex

Copy the whole toolkit `skills/<skill-name>/` folder when installing toolkit-owned skills.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
| --- | --- |
| Repo-local | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
| Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

- Do not copy only `SKILL.md`.
- Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 5. Agent Rules

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

| Need | Use |
| --- | --- |
| Generic Codex rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
| Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
| Optional n8n pointer | `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

- If the target repo already has `AGENTS.md`, do not overwrite it. Merge manually or produce a diff/merge plan.
- For n8n workflow work, use official n8n Skills and official n8n MCP validation/build tools before proposing live-instance changes.
- Do not execute live changes without explicit current-turn approval naming the exact target and allowed operation.

## 6. Codex MCP Config

Use the [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md).

- Add only the official instance-level MCP connection, normally named `n8n_live`.
- Keep the real token in `N8N_MCP_TOKEN`, not in repo files.

## References

- [Codex Docs](https://openai.com/index/introducing-the-codex-app/)
- [Codex MCP config](https://developers.openai.com/codex/mcp)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
