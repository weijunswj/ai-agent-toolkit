<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/mcp setup - antigravity.md
Update the project source and run sync.
-->
# Antigravity [Official n8n Skills](https://github.com/n8n-io/skills) And MCP Setup

The primary local setup guide is [Page 1 - Local Setup](../n8n/local-setup.md).

This page is an optional Antigravity AI-coding-agent setup reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| [Official n8n Skills](https://github.com/n8n-io/skills) | Workflow design, node guidance, validation, and build guidance when official Skills are installed. Plugin lifecycle hooks are available only on supported plugin platforms. |
| `using-n8n-skills` | The first skill to load when starting n8n workflow work. |
| `n8n_live` | Official instance-level MCP access for read-only inspection or explicitly approved live changes. |
| Antigravity skill support | Platform-specific skill loading. Use official `skills.sh` support for upstream n8n Skills unless Antigravity later documents plugin parity. |
| Antigravity MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [Page 1 - Local Setup](../n8n/local-setup.md) first if you are using local n8n.
2. You should already have:
   1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
   2. [Node.js](https://nodejs.org/en/download) installed because this guide's MCP bridge uses Node.js.
   3. [Antigravity](https://antigravity.google/) installed.
   4. n8n running locally, through a tunnel, or on a hosted domain.
   5. Official instance-level MCP enabled in n8n.
   6. The official n8n MCP server URL copied from n8n.
   7. An official n8n MCP token copied from n8n.

Do not copy, fork, vendor, mirror, or recreate the official [`n8n-io/skills`](https://github.com/n8n-io/skills) content inside this toolkit. Install or reference official upstream material only.

## 2. Install Antigravity

1. Install Antigravity using the official install method for your machine.
2. Run this in a fresh PowerShell window:

   ```powershell
   node -v
   npm -v
   ```

   - The Antigravity MCP config in this guide uses `node`, `npx`, and `supergateway`, so Node.js must be available on your Windows `PATH`.

## 3. [Official n8n Skills](https://github.com/n8n-io/skills) On Antigravity

The official [`n8n-io/skills`](https://github.com/n8n-io/skills) README documents plugin installs for Codex and Claude Code. Those plugin installs ship lifecycle hooks:

- `SessionStart` loads the `using-n8n-skills` meta-skill automatically.
- `PreToolUse` nudges the agent to consult the matching skill before high-impact n8n MCP calls.
- `PostToolUse` can provide follow-up reminders after tool use.

Antigravity is in the official README's "Other platforms" category unless Antigravity later documents official plugin parity. From the target project folder, install with `skills.sh` via `npx`:

```powershell
npx skills add n8n-io/skills
```

Compatibility varies by agent. Check [skills.sh](https://skills.sh) support for your Antigravity runtime.

Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Add this cue to the target repo's `AGENTS.md` so the missing `SessionStart` hook is covered for n8n tasks:

```markdown
This project uses n8n. When working with workflows, nodes, expressions, or
the n8n MCP tools, always start by loading the `using-n8n-skills` meta-skill
and follow its routing into the matching capability skill before acting.
```

For the current session, explicitly ask Antigravity to load `using-n8n-skills` before any n8n workflow design, validation, or live-instance proposal.

Use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance. Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities. Do not execute live changes without explicit current-turn approval naming the exact target and allowed operation.

## 4. Install Toolkit Safety Rules For Antigravity

This section is for this toolkit's own safety skills, not the upstream [official n8n Skills](https://github.com/n8n-io/skills) install above.

1. **Use the Antigravity plugin-scoped skill-folder location for toolkit-owned skills when your Antigravity runtime supports that layout:**

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
3. If you installed [official n8n Skills](https://github.com/n8n-io/skills) through `npx skills add n8n-io/skills`, make sure the `using-n8n-skills` cue from section 3 is present in the target repo `AGENTS.md`.
4. If Antigravity does not invoke toolkit skills automatically, keep any global `GEMINI.md` nudge tiny:

   ```text
   Before editing files in any repository, always use the `ai-coding-agent-rules` skill once per new chat/session to check, bootstrap, or repair repo-local instructions. For n8n work, load `using-n8n-skills` and `n8n-agent-rules` before workflow design or live-instance proposals.
   ```

## 6. Antigravity MCP Config

1. Use the [Antigravity MCP config](../../templates/mcp-configs/antigravity-mcp-config.md).
2. Add only the official instance-level MCP connection, normally named `n8n_live`.
3. Keep `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or supported secret storage, not repo files.

## 7. Restart Antigravity

1. After changing any of these:
   - [Official n8n Skills](https://github.com/n8n-io/skills) plain skill install.
   - Target repo `AGENTS.md` n8n cue.
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
