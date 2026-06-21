# Claude Code [Official n8n Skills](https://github.com/n8n-io/skills) And MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional Claude Code AI-coding-agent setup reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| [Official n8n Skills](https://github.com/n8n-io/skills) | Workflow design, node guidance, validation, and build guidance through the official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin. |
| Official entry-point meta-skill | The first [official n8n Skills](https://github.com/n8n-io/skills) skill to load when starting n8n workflow work; currently `using-n8n-skills`. |
| `n8n_live` | Official instance-level MCP access for read-only inspection or explicitly approved live changes. |
| Claude Code rules | Repo or user instructions for safer agent behavior. |
| Claude MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed if your Claude Code setup requires it.
   3. [Claude Desktop / Claude Code](https://claude.com/download) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Official instance-level MCP enabled in n8n.
   6. The official n8n MCP server URL copied from n8n.
   7. An official n8n MCP token copied from n8n.

Do not copy, fork, vendor, mirror, or recreate the official [`n8n-io/skills`](https://github.com/n8n-io/skills) content inside this toolkit. Install the official plugin from its upstream source.

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
   - Claude Code Desktop may require a paid Claude plan.
4. Run this in PowerShell from any folder:

   ```powershell
   node -v
   npm -v
   ```

5. If the `claude` command is available, you can also check:

   ```powershell
   claude --version
   ```

## 3. Install [Official n8n Skills](https://github.com/n8n-io/skills) For Claude Code

On Windows, use the plain skill install plus the `AGENTS.md` or `CLAUDE.md` cue below unless the installed official plugin passes these hook checks:

- `hooks/hooks.json` invokes a Windows-safe command, such as a Node or PowerShell wrapper, instead of a bare `.sh` path like `${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh`.
- Hook emitters can output valid JSON with Node when `jq` and `python3` are unavailable.
- The hook command does not rely on `C:\WINDOWS\system32\bash.exe`; that is WSL bash and it fails when no WSL distro is installed. If a package uses Git Bash, the hook command must invoke the real Git Bash path explicitly.

If Claude Code opens an installed plugin `hooks\session-start.sh` file on every new chat, the installed plugin is invoking a bare `.sh` hook on Windows. From this toolkit repo, audit the installed cache, replacing the path with your actual official n8n Skills plugin cache path:

```powershell
node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "C:\Users\<user>\.codex\plugins\cache\n8n-io\n8n-skills\<version>" --windows
```

If the audit fails, remove, disable, untrust, or uninstall the official plugin hooks or plugin. Restart Claude Code, use the upstream "Other platforms" route below, and keep the `AGENTS.md` or `CLAUDE.md` cue that loads `using-n8n-skills` before n8n work. Only reinstall or re-trust the official plugin after the installed `hooks/hooks.json` uses a Windows-safe wrapper and hook emitters can output JSON with Node. The installed plugin cache may need manual reinstall or update after upstream fixes; this toolkit guidance does not repair an already-installed cache.

From the target project folder, use the upstream "Other platforms" route when your runtime supports [skills.sh](https://skills.sh):

```powershell
npx skills add n8n-io/skills
```

Then add the current official entry-point cue to the target repo `AGENTS.md` or `CLAUDE.md`:

```text
This project uses n8n. When working with workflows, nodes, expressions, or
the n8n MCP tools, always start by loading the `using-n8n-skills` meta-skill
and follow its routing into the matching capability skill before acting.
```

On macOS/Linux, or on Windows after the installed plugin passes the hook checks above, run these commands inside Claude Code:

```text
/plugin marketplace add n8n-io/skills
/plugin install n8n-skills@n8n-io
```

Then:

1. Restart Claude Code.
2. Approve or trust the plugin hooks when Claude Code prompts you so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.
3. Start n8n work by loading the [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`.

## 4. Install Toolkit Safety Rules For Claude Code

Copy the whole toolkit `skills/<skill-name>/` folder when installing toolkit-owned skills.

**Choose any one supported Claude Code skill-folder location:**

| Scope | Skill folder location |
| --- | --- |
| Project-level | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.claude/skills/<skill-name>/SKILL.md` |

- Do not copy only `SKILL.md`.
- Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 5. Agent Rules

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

| Need | Use |
| --- | --- |
| Generic Claude Code rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
| Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
| Optional n8n pointer | `CLAUDE.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

- If the target repo already has `CLAUDE.md`, do not overwrite it. Merge manually or produce a diff/merge plan.
- For n8n workflow work, use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance.
- Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
- Do not execute live changes without explicit current-turn approval naming the exact target and allowed operation.

## 6. Claude Code MCP Config

Use the [Claude MCP config](./templates/mcp-configs/claude-mcp-config.md).

- Add only the official instance-level MCP connection, normally named `n8n_live`.
- Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or Claude Code's supported secret storage, not repo files.

## 7. Restart Claude Code

After changing any of these, fully close and reopen Claude Desktop, then open the `Code` tab:

1. [Official n8n Skills](https://github.com/n8n-io/skills) plugin.
2. User-scoped MCP servers.
3. `$HOME\.claude\CLAUDE.md`.
4. `N8N_MCP_URL`.
5. `N8N_MCP_TOKEN`.

You do not need to select this repo folder. Use the folder you actually want Claude Code Desktop to work in.

## References

- [Claude Code Desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart)
- [Claude Code Desktop reference](https://code.claude.com/docs/en/desktop)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
