# OpenCode [Official n8n Skills](https://github.com/n8n-io/skills) And MCP Setup

The primary local setup guide is [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This page is an optional OpenCode AI-coding-agent setup reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| [Official n8n Skills](https://github.com/n8n-io/skills) | Workflow design, node guidance, validation, and build guidance when official Skills are installed. Plugin lifecycle hooks are available only on supported plugin platforms. |
| `using-n8n-skills` | The first skill to load when starting n8n workflow work. |
| `n8n_live` | Official instance-level MCP access for read-only inspection or explicitly approved live changes. |
| OpenCode rules | User or repo instructions for safer agent behavior. |
| OpenCode MCP config | User-scoped MCP server setup. |

## 1. Before You Start

Finish [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) first if you are using local n8n.

You should already have:

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
2. [Node.js](https://nodejs.org/en/download) installed if your OpenCode setup requires it.
3. [OpenCode](https://opencode.ai/docs/) installed.
4. n8n running locally, through a tunnel, or on a hosted domain.
5. Official instance-level MCP enabled in n8n.
6. The official n8n MCP server URL copied from n8n.
7. An official n8n MCP token copied from n8n.

Do not copy, fork, vendor, mirror, or recreate the official [`n8n-io/skills`](https://github.com/n8n-io/skills) content inside this toolkit. Install or reference official upstream material only.

## 2. Install OpenCode

1. Install OpenCode using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   opencode --version
   node -v
   npm -v
   ```

   - If `opencode` is not found, close and reopen PowerShell first.
   - If it is still not found, check that the OpenCode install location is on your Windows `PATH`.

## 3. [Official n8n Skills](https://github.com/n8n-io/skills) On OpenCode

The official [`n8n-io/skills`](https://github.com/n8n-io/skills) README documents plugin installs for Codex and Claude Code. Those plugin installs ship lifecycle hooks:

- `SessionStart` loads the `using-n8n-skills` meta-skill automatically.
- `PreToolUse` nudges the agent to consult the matching skill before high-impact n8n MCP calls.
- `PostToolUse` can provide follow-up reminders after tool use.

OpenCode is in the official README's "Other platforms" category unless OpenCode later documents official plugin parity. From the target project folder, install with `skills.sh` via `npx`:

```powershell
npx skills add n8n-io/skills
```

Compatibility varies by agent. Check [skills.sh](https://skills.sh) support for your OpenCode runtime.

Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Add this cue to the target repo's `AGENTS.md` so the missing `SessionStart` hook is covered for n8n tasks:

```markdown
This project uses n8n. When working with workflows, nodes, expressions, or
the n8n MCP tools, always start by loading the `using-n8n-skills` meta-skill
and follow its routing into the matching capability skill before acting.
```

For the current session, explicitly ask OpenCode to load `using-n8n-skills` before any n8n workflow design, validation, or live-instance proposal.

Use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance. Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities. Do not execute live changes without explicit current-turn approval naming the exact target and allowed operation.

## 4. Install Toolkit Safety Rules For OpenCode

This section is for this toolkit's own safety skills, not the upstream [official n8n Skills](https://github.com/n8n-io/skills) install above. Copy the whole toolkit `skills/<skill-name>/` folder when installing toolkit-owned skills.

**Choose any one supported OpenCode skill-folder location:**

| Scope | Skill folder location |
| --- | --- |
| Project OpenCode config | `<repo>/.opencode/skills/<skill-name>/SKILL.md` |
| User OpenCode config | `C:\Users\<your-user>\.config\opencode\skills\<skill-name>\SKILL.md` |
| Compatible fallback | `.agents/skills/` or `.claude/skills/`, if that is how the target OpenCode runtime is configured |

- Do not copy only `SKILL.md`.
- Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 5. Agent Rules

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

| Need | Use |
| --- | --- |
| Generic OpenCode rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
| Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
| Optional n8n pointer | `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` |

- If the target repo already has `AGENTS.md`, do not overwrite it. Merge manually or produce a diff/merge plan.
- If you installed [official n8n Skills](https://github.com/n8n-io/skills) through `npx skills add n8n-io/skills`, make sure the `using-n8n-skills` cue from section 3 is present in the same target repo `AGENTS.md`.

## 6. OpenCode MCP Config

Use the [OpenCode MCP config](./templates/mcp-configs/opencode-mcp-config.md).

- Add only the official instance-level MCP connection, normally named `n8n_live`.
- Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or supported secret storage, not repo files.

## 7. Restart OpenCode

1. After changing any of these:
   - [Official n8n Skills](https://github.com/n8n-io/skills) plain skill install.
   - Target repo `AGENTS.md` n8n cue.
   - `$HOME\.config\opencode\opencode.json`.
   - `$HOME\.config\opencode\AGENTS.md`.
   - `N8N_MCP_URL`.
   - `N8N_MCP_TOKEN`.
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
