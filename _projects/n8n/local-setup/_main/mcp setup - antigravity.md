# Antigravity MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional Antigravity AI-coding-agent MCP feature reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| `n8n_docs` | Node search and workflow validation using the community MCP. |
| `n8n_live` | Read or mutate the real n8n instance only after explicit approval. |
| Antigravity skills | Plugin-scoped skill folders. |
| Antigravity MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed.
   3. [Antigravity](https://antigravity.google/) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Instance-level MCP enabled in n8n.
   6. The live n8n MCP server URL copied from n8n.
   7. A live n8n MCP token copied from n8n.

## 2. Install Antigravity

1. Install Antigravity using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   node -v
   npm -v
   npx --version
   ```

   - The Antigravity MCP config in this guide uses `node`, `npx`, and `supergateway`, so Node.js must be available on your Windows `PATH`.

## 3. Install Toolkit Skills For Antigravity

1. **Use the Antigravity plugin-scoped skill-folder location for toolkit skills:**

   | Location type | Skill folder path |
   | --- | --- |
   | Plugin-scoped | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` |

   - Suggested structure:

      ```text
      C:\Users\<user>\.gemini\config\plugins\
      `-- <plugin-name>\
         |-- plugin.json
         `-- skills\
            `-- ai-coding-agent-rules\
                  |-- README.md
                  `-- SKILL.md
      ```

2. Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder
3. Use a minimal `plugin.json` only when the installed Antigravity runtime or docs require plugin metadata.
   - This plugin-scoped folder is for loading toolkit skills.
4. Do not copy only `SKILL.md`.
5. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 4. Agent Rules

1. **If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

   | Need | Use |
   | --- | --- |
   | Generic Antigravity rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
   | Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
   | Optional n8n pointer | `GEMINI.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

2. If the target repo already has `GEMINI.md`, do not overwrite it.
   - Merge manually or produce a diff/merge plan.
3. If Antigravity does not invoke skills automatically, keep any global `GEMINI.md` nudge tiny: remind it to use `ai-coding-agent-rules` before the first repo file edit.

   ```text
   Before editing files in any repository, always use the `ai-coding-agent-rules` skill once per new chat/session to check, bootstrap, or repair repo-local instructions. If the skill is unavailable, report that before editing.
   ```

## 5. Antigravity MCP Config

1. Use the [Antigravity MCP config](./templates/mcp-configs/antigravity-mcp-config.md).
2. Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or supported secret storage, not repo files.

## 6. Restart Antigravity

1. After changing any of these:
   - `$HOME\.gemini\antigravity\mcp_config.json`
   - `$HOME\.gemini\GEMINI.md`
   - `N8N_MCP_URL`
   - `N8N_MCP_TOKEN`
2. Fully close and reopen Antigravity.
   - You can open any folder.
   - Open a specific repo only when you actually want Antigravity to inspect or edit that repo.

## 7. Troubleshooting

### Antigravity Agent Stops Replying After An Update

1. If Antigravity opens normally but the agent stops replying inside one project, check whether the repo's hidden Git config contains `worktreeConfig = true`.
2. From the affected project folder, run:

   ```powershell
   cd .git
   ls
   antigravity config
   ```

3. Inside `.git/config`, look for:

   ```ini
   [extensions]
       worktreeConfig = true
   ```

4. Delete only this line:

   ```ini
       worktreeConfig = true
   ```

5. Save the file, fully close Antigravity, then reopen the project.
   - Do not delete random lines from `.git/config`.
   - If `[extensions]` becomes empty after removing the line, it is safe to remove the empty `[extensions]` header too.
   - This fix is only for the bug where Antigravity stops replying because of `worktreeConfig = true` in `.git/config`.

## References

- [Google Antigravity documentation](https://antigravity.im/documentation)
- [Antigravity MCP setup notes](https://antigravity.codes/blog/antigravity-mcp-tutorial)
- [GEMINI.md setup notes for Antigravity](https://docs.endorlabs.com/setup-deployment/mcp/antigravity)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
