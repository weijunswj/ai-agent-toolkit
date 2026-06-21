# Codex [Official n8n Skills](https://github.com/n8n-io/skills) And MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional Codex AI-coding-agent setup reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| [Official n8n Skills](https://github.com/n8n-io/skills) | Workflow design, node guidance, validation, and build guidance through the official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin. |
| Official entry-point meta-skill | The first [official n8n Skills](https://github.com/n8n-io/skills) skill to load when starting n8n workflow work; currently `using-n8n-skills`. |
| `n8n_live` | Official instance-level MCP access for read-only inspection or explicitly approved live changes. |
| Codex rules | Repo or user instructions for safer agent behavior. |
| Codex MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed if your Codex setup requires it.
   3. [Codex](https://openai.com/index/introducing-the-codex-app/) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Official instance-level MCP enabled in n8n.
   6. The official n8n MCP server URL copied from n8n.
   7. An official n8n MCP token copied from n8n.

Do not copy, fork, vendor, mirror, or recreate the official [`n8n-io/skills`](https://github.com/n8n-io/skills) content inside this toolkit. Install the official plugin from its upstream source.

## 2. Install Codex

1. Install Codex using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   node -v
   npm -v
   ```

## 3. Install [Official n8n Skills](https://github.com/n8n-io/skills) For Codex

On Windows, use the plain skill install plus the `AGENTS.md` cue below unless the installed official plugin passes these hook checks:

- `hooks/hooks.json` invokes a Windows-safe command, such as a Node or PowerShell wrapper, instead of a bare `.sh` path like `${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh`.
- Hook emitters can output valid JSON with Node when `jq` and `python3` are unavailable.
- The hook command does not rely on `C:\WINDOWS\system32\bash.exe`; that is WSL bash and it fails when no WSL distro is installed. If a package uses Git Bash, the hook command must invoke the real Git Bash path explicitly.

From the target project folder, use the upstream "Other platforms" route when your runtime supports [skills.sh](https://skills.sh):

```powershell
npx skills add n8n-io/skills
```

Then add the current official entry-point cue to the target repo `AGENTS.md`:

```text
This project uses n8n. When working with workflows, nodes, expressions, or
the n8n MCP tools, always start by loading the `using-n8n-skills` meta-skill
and follow its routing into the matching capability skill before acting.
```

On macOS/Linux, or on Windows after the installed plugin passes the hook checks above, run these Codex plugin commands:

```powershell
codex plugin marketplace add n8n-io/skills
codex plugin add n8n-skills@n8n-io
```

Then:

1. Restart Codex.
2. Approve or trust the plugin hooks when Codex prompts you so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.
3. Start n8n work by loading the [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`.

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
- For n8n workflow work, use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance.
- Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
- Do not execute live changes without explicit current-turn approval naming the exact target and allowed operation.

## 6. Codex MCP Config

Use the [Codex MCP config](./templates/mcp-configs/codex-mcp-config.md).

- Add only the official instance-level MCP connection, normally named `n8n_live`.
- Keep the real token in `N8N_MCP_TOKEN`, not in repo files.

## References

- [Codex Docs](https://openai.com/index/introducing-the-codex-app/)
- [Codex MCP config](https://developers.openai.com/codex/mcp)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
