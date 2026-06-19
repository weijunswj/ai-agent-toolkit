# Antigravity Official n8n Skills And MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional Antigravity AI-coding-agent setup reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| Official n8n Skills | Workflow design, node guidance, validation, and build guidance when official Skills are installed on a supported platform. |
| `using-n8n-skills` | The first skill to load when starting n8n workflow work. |
| `n8n_live` | Official instance-level MCP access for read-only inspection or explicitly approved live changes. |
| Antigravity skills | Plugin-scoped skill folders. |
| Antigravity MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed because this guide's MCP bridge uses Node.js.
   3. [Antigravity](https://antigravity.google/) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Official instance-level MCP enabled in n8n.
   6. The official n8n MCP server URL copied from n8n.
   7. An official n8n MCP token copied from n8n.

Do not copy, fork, vendor, mirror, or recreate the official `n8n-io/skills` content inside this toolkit. Install or reference official upstream material only.

## 2. Install Antigravity

1. Install Antigravity using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   node -v
   npm -v
   ```

   - The Antigravity MCP config in this guide uses `node`, `npx`, and `supergateway`, so Node.js must be available on your Windows `PATH`.

## 3. Official n8n Skills On Antigravity

Official plugin support is platform-dependent. This toolkit does not claim Antigravity plugin parity for the official `n8n-io/skills` plugin.

If your Antigravity runtime supports plain skill installs from the official n8n Skills package, install the complete upstream skill folder outside this toolkit and start n8n work with this instruction:

```text
Load `using-n8n-skills` before any n8n workflow design, validation, or live-instance proposal.
```

Use official n8n Skills and official n8n MCP validation/build tools before proposing live-instance changes. Do not execute live changes without explicit current-turn approval naming the exact target and allowed operation.

## 4. Install Toolkit Safety Rules For Antigravity

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

2. Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder.
3. Use a minimal `plugin.json` only when the installed Antigravity runtime or docs require plugin metadata.
4. Do not copy only `SKILL.md`.
5. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 5. Agent Rules

1. **If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

   | Need | Use |
   | --- | --- |
   | Generic Antigravity rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
   | Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
   | Optional n8n pointer | `GEMINI.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

2. If the target repo already has `GEMINI.md`, do not overwrite it.
   - Merge manually or produce a diff/merge plan.
3. If Antigravity does not invoke skills automatically, keep any global `GEMINI.md` nudge tiny:

   ```text
   Before editing files in any repository, always use the `ai-coding-agent-rules` skill once per new chat/session to check, bootstrap, or repair repo-local instructions. For n8n work, load `using-n8n-skills` and `n8n-agent-rules` before workflow design or live-instance proposals.
   ```

## 6. Antigravity MCP Config

1. Use the [Antigravity MCP config](./templates/mcp-configs/antigravity-mcp-config.md).
2. Add only the official instance-level MCP connection, normally named `n8n_live`.
3. Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or supported secret storage, not repo files.

## 7. Restart Antigravity

1. After changing any of these:
   - Official n8n Skills installation, if your Antigravity runtime supports it.
   - `$HOME\.gemini\antigravity\mcp_config.json`.
   - `$HOME\.gemini\GEMINI.md`.
   - `N8N_MCP_URL`.
   - `N8N_MCP_TOKEN`.
2. Fully close and reopen Antigravity.
   - You can open any folder.
   - Open a specific repo only when you actually want Antigravity to inspect or edit that repo.

## 8. Troubleshooting

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
