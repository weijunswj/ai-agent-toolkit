# Claude Code MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional Claude Code AI-coding-agent MCP feature reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| `n8n_docs` | Node search and workflow validation using the community MCP. |
| `n8n_live` | Read or mutate the real n8n instance only after explicit approval. |
| Claude Code rules | Repo or user instructions for safer agent behavior. |
| Claude MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed.
   3. [Claude Desktop / Claude Code](https://claude.com/download) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Instance-level MCP enabled in n8n.
   6. The live n8n MCP server URL copied from n8n.
   7. A live n8n MCP token copied from n8n.

## 2. Install Claude Code

| Need | Link |
| --- | --- |
| Claude Desktop / Claude Code | [https://claude.com/download](https://claude.com/download) |
| Node.js LTS | [https://nodejs.org/en/download](https://nodejs.org/en/download) |
| Git for Windows | [https://git-scm.com/download/win](https://git-scm.com/download/win) |

Then:

1. Launch Claude from the Windows Start menu.
2. Sign in with your Anthropic account.
3. Open the `Code` tab.
   - Claude Code Desktop requires a Pro, Max, Team, or Enterprise subscription.
4. Run this in PowerShell from any folder:

    ```powershell
    node -v
    npm -v
    npx --version
    ```

5. If the `claude` command is available, you can also check:

    ```powershell
    claude --version
    ```

## 3. Install Toolkit Skills For Claude Code

Copy the whole `skills/<skill-name>/` folder.
- **Choose any one supported Claude Code skill-folder location:**

   | Scope | Skill folder location |
   | --- | --- |
   | Project-level | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
   | User-level | `$HOME/.claude/skills/<skill-name>/SKILL.md` |

- Do not copy only `SKILL.md`.
- Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 4. Agent Rules

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

   | Need | Use |
   | --- | --- |
   | Generic Claude Code rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
   | Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
   | Optional n8n pointer | `CLAUDE.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

- If the target repo already has `CLAUDE.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 5. Claude Code MCP Config

Use the [Claude MCP config](./templates/mcp-configs/claude-mcp-config.md).
   - Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or Claude Code's supported secret storage, not repo files.

## 6. Restart Claude

1. After changing any of these, fully close and reopen Claude Desktop, then open the `Code` tab:
   1. User-scoped MCP servers.
   2. `$HOME\.claude\CLAUDE.md`.
   3. `N8N_MCP_URL`.
   4. `N8N_MCP_TOKEN`.
2. Note regarding folder selection:
   - You do not need to select this repo folder. Use the folder you actually want Claude Code Desktop to work in.

## References

- [Claude Code Desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart)
- [Claude Code Desktop reference](https://code.claude.com/docs/en/desktop)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
