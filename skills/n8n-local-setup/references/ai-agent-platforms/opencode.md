<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/mcp setup - opencode.md
Update the project source and run sync.
-->
# OpenCode MCP Setup

The primary local setup guide is [Page 1 - Local Setup](../n8n/local-setup.md).

This page is an optional OpenCode AI-coding-agent MCP feature reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| `n8n_docs` | Node search and workflow validation using the community MCP. |
| `n8n_live` | Read or mutate the real n8n instance only after explicit approval. |
| OpenCode rules | User or repo instructions for safer agent behavior. |
| OpenCode MCP config | User-scoped MCP server setup. |

## 1. Before You Start

Finish [Page 1 - Local Setup](../n8n/local-setup.md) first if you are using local n8n.

You should already have:

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
2. [Node.js](https://nodejs.org/en/download) installed.
3. [OpenCode](https://opencode.ai/docs/) installed.
4. n8n running locally, through a tunnel, or on a hosted domain.
5. Instance-level MCP enabled in n8n.
6. The live n8n MCP server URL copied from n8n.
7. A live n8n MCP token copied from n8n.

## 2. Install OpenCode

1. Install OpenCode using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   opencode --version
   node -v
   npm -v
   npx --version
   ```

   - If `opencode` is not found, close and reopen PowerShell first.
   - If it is still not found, check that the OpenCode install location is on your Windows `PATH`.

## 3. Install Toolkit Skills For OpenCode

Copy the whole `skills/<skill-name>/` folder.

- **Choose any one supported OpenCode skill-folder location:**

   | Scope | Skill folder location |
   | --- | --- |
   | Project OpenCode config | `<repo>/.opencode/skills/<skill-name>/SKILL.md` |
   | User OpenCode config | `C:\Users\<your-user>\.config\opencode\skills\<skill-name>\SKILL.md` |
   | Compatible fallback | `.agents/skills/` or `.claude/skills/`, if that is how the target OpenCode runtime is configured |

- Do not copy only `SKILL.md`.
- Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.


## 4. Agent Rules

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

   | Need | Use |
   | --- | --- |
   | Generic OpenCode rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
   | Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
   | Optional n8n pointer | `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

- If the target repo already has `AGENTS.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 5. OpenCode MCP Config

Use the [OpenCode MCP config](../../templates/mcp-configs/opencode-mcp-config.md).
- Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or supported secret storage, not repo files.

## 6. Restart OpenCode

1. After changing any of these:
   - `$HOME\.config\opencode\opencode.json`
   - `$HOME\.config\opencode\AGENTS.md`
   - `N8N_MCP_URL`
   - `N8N_MCP_TOKEN`
2. Restart OpenCode from a fresh PowerShell window:

   ```powershell
   opencode
   ```

   - You can start OpenCode from any folder.
   - Open a specific repo only when you actually want OpenCode to inspect or edit that repo.

## References

- [OpenCode config docs](https://opencode.ai/docs/config/)
- [OpenCode rules docs](https://opencode.ai/docs/rules/)
- [OpenCode MCP servers docs](https://opencode.ai/docs/mcp-servers/)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
