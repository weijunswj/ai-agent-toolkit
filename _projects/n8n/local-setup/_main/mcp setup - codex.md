# Codex MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional Codex AI-coding-agent MCP feature reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| `n8n_docs` | Node search and workflow validation using the community MCP. |
| `n8n_live` | Read or mutate the real n8n instance only after explicit approval. |
| Codex rules | Repo or user instructions for safer agent behavior. |
| Codex MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed.
   3. [Codex](https://openai.com/index/introducing-the-codex-app/) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Instance-level MCP enabled in n8n.
   6. The live n8n MCP server URL copied from n8n.
   7. A live n8n MCP token copied from n8n.

## 2. Install Codex

1. Install Codex using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   node -v
   npm -v
   npx --version
   ```

## 3. Install Toolkit Skills For Codex

Copy the whole `skills/<skill-name>/` folder.
- **Choose any one supported Codex skill-folder location:**

   | Scope | Skill folder location |
   | --- | --- |
   | Repo-local | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
   | User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
   | Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

- Do not copy only `SKILL.md`.
- Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 4. Agent Rules

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

   | Need | Use |
   | --- | --- |
   | Generic Codex rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
   | Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
   | Optional n8n pointer | `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

- If the target repo already has `AGENTS.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 5. Codex MCP Config

Use the [Codex MCP config](./templates/mcp-configs/codex-mcp-config.md).
   - Add the configuration to your Codex setup.

## References

- [Codex Docs](https://openai.com/index/introducing-the-codex-app/)
- [Codex MCP config](https://developers.openai.com/codex/mcp)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
