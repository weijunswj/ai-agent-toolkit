<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/6. extra - opencode integration.md
Update the project source and run sync.
-->
# EXTRA: OpenCode Integration ( Windows )

This extra guide adds OpenCode to the same n8n setup used by the Codex guide.

* It does not replace Codex.

* This guide is written for a global OpenCode setup. You do not need to open this repo in OpenCode just to use the n8n MCP servers.

It gives OpenCode:

* Global `n8n_docs` access for node search and workflow validation using the community MCP.
* Global `n8n_live` access for your real n8n instance using the official MCP.
* Global OpenCode MCP config in `C:\Users\<your-user>\.config\opencode\opencode.json`.
* Global OpenCode rules in `C:\Users\<your-user>\.config\opencode\AGENTS.md`.
* A safe smoke-test path that keeps workflows inactive by default.

---

## 1. Before You Start

Finish [1. Local Setup](./1.%20local%20setup.md) first if you are using local n8n.

You should already have:

1. Docker Desktop installed if you are running local n8n.
2. Node.js installed.
3. An n8n instance running locally, through a tunnel, or on a hosted domain.
4. Instance-level MCP enabled in n8n.
5. The live n8n MCP server URL copied from n8n.
6. A live n8n MCP token copied from n8n.

---

## 2. Install OpenCode

### Install OpenCode using the official install method for your machine.

### Then verify it in a fresh PowerShell window:

```powershell
opencode --version
```

### Also verify Node.js and npm:

```powershell
node -v
npm -v
npx --version
```

* If `opencode` is not found, close and reopen PowerShell first. If it is still not found, check that the OpenCode install location is on your Windows `PATH`.

---

## 3. Create Global OpenCode Rules

### Follow the OpenCode AGENTS.md Setup guide:

* Install or copy generic AI coding agent rules from [AGENTS.template.md](/_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md), then copy or merge them into the target repo root as `AGENTS.md`.
* Merge the n8n-specific add-on from [agent-rules/n8n-mcp-rules.template.md](./agent-rules/n8n-mcp-rules.template.md) into the same `AGENTS.md`.
* If the target repo already has `AGENTS.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 4. Create The Global OpenCode MCP Config

### Follow the OpenCode MCP Config guide:

* [templates/opencode-mcp-config.md](./templates/opencode-mcp-config.md)

---

## 5. Restart OpenCode

### After changing any of these:

  * `$HOME\.config\opencode\opencode.json`
  * `$HOME\.config\opencode\AGENTS.md`
  * `N8N_MCP_URL`
  * `N8N_MCP_TOKEN`

### Restart OpenCode from a fresh PowerShell window:

```powershell
opencode
```

* You can start OpenCode from any folder. Open a specific repo only when you actually want OpenCode to inspect or edit that repo.

---

## References

* [OpenCode config docs](https://opencode.ai/docs/config/)
* [OpenCode rules docs](https://opencode.ai/docs/rules/)
* [OpenCode MCP servers docs](https://opencode.ai/docs/mcp-servers/)
* [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
