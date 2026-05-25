<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/5. extra - claude code integration.md
Update the project source and run sync.
-->
# EXTRA: Claude Code Desktop Integration ( Windows )

This extra guide adds Claude Code Desktop to the same n8n setup used by the Codex guide.

* It does not replace Codex.

* This guide is only for setting up Claude Code Desktop's global/user MCP config and global `CLAUDE.md` rules.

* You do not need to clone this repo, open this repo, select this repo folder, or create repo-level config files.

It gives Claude Code Desktop:

* `n8n_docs` for node search and workflow validation using the community MCP.
* `n8n_live` for your real n8n instance using the official MCP.
* Global Claude Code workflow rules in `C:\Users\<your-user>\.claude\CLAUDE.md`.
* A safe smoke-test path that keeps workflows inactive by default.

---

## 1. Before You Start

Finish [1. Local Setup](./1.%20local%20setup.md) first if you are using local n8n.

You should already have:

1. Docker Desktop installed if you are running local n8n.
2. Node.js installed.
3. Claude Desktop installed.
4. An n8n instance running locally, through a tunnel, or on a hosted domain.
5. Instance-level MCP enabled in n8n.
6. The live n8n MCP server URL copied from n8n.
7. A live n8n MCP token copied from n8n.

---

## 2. Install Claude Desktop

### Install these first:

1. Claude Desktop: [https://claude.com/download](https://claude.com/download)
2. Node.js LTS: [https://nodejs.org/en/download](https://nodejs.org/en/download)
3. Git for Windows: [https://git-scm.com/download/win](https://git-scm.com/download/win)

### Then:

1. Launch Claude from the Windows Start menu.
2. Sign in with your Anthropic account.
3. Click the `Code` tab at the top.

* Claude Code Desktop requires a Pro, Max, Team, or Enterprise subscription.

### Verify Node.js and npm in PowerShell:

```powershell
node -v
npm -v
npx --version
```

### If the `claude` command is available, you can also verify:

```powershell
claude --version
```

---

## 3. Create Claude Code Rules

### Follow the Claude Code CLAUDE.md Setup guide:

* Install or copy generic AI coding agent rules from [CLAUDE.template.md](../../../ai-coding-agent-rules/CLAUDE.template.md), then copy or merge them into the target repo root as `CLAUDE.md`.
* Install or load `skills/n8n-agent-rules` for the full n8n operating contract before workflow, MCP, helper-script, or live n8n work.
* Optionally merge the brief `CLAUDE.n8n-brief.template.md` adapter from `skills/n8n-agent-rules/adapters/` into the same `CLAUDE.md`. Do not copy the full n8n rules into always-on instructions unless you intentionally accept the context cost.
* If the target repo already has `CLAUDE.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 4. Create The Claude Code MCP Config

### Follow the Claude Code MCP Config guide:

* [templates/claude-mcp-config.md](./templates/claude-mcp-config.md)

---

## 5. Restart Claude Desktop

### After changing any of these:

  * User-scoped MCP servers.
  * `$HOME\.claude\CLAUDE.md`.
  * `N8N_MCP_URL`.
  * `N8N_MCP_TOKEN`.

### Fully close and reopen Claude Desktop.

* Then open the `Code` tab.

* You do not need to select this repo folder. Use whatever folder you actually want Claude Code Desktop to work in.

---

## References

* [Claude Code Desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart)
* [Claude Code Desktop reference](https://code.claude.com/docs/en/desktop)
* [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
* [Claude Code memory docs](https://code.claude.com/docs/en/memory)
* [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
