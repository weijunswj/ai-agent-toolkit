<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/6. extra - opencode integration.md
Update the project source and run sync.
-->
# EXTRA: OpenCode Integration ( Windows )

The primary local setup guide is [1. Local Setup](../n8n/local-setup.md). This page is retained as a secondary platform reference for OpenCode details, not as a required local setup path.

This extra guide adds OpenCode to the same n8n setup used by the Codex guide.

- It does not replace Codex.
- This guide is written for a global OpenCode setup. You do not need to open this repo in OpenCode just to use the n8n MCP servers.

It gives OpenCode:

- Global `n8n_docs` access for node search and workflow validation using the community MCP.
- Global `n8n_live` access for your real n8n instance using the official MCP.
- Global OpenCode MCP config in `C:\Users\<your-user>\.config\opencode\opencode.json`.
- Global OpenCode rules in `C:\Users\<your-user>\.config\opencode\AGENTS.md`.
- A safe smoke-test path that keeps workflows inactive by default.

---

## 1. Before You Start

Finish [1. Local Setup](../n8n/local-setup.md) first if you are using local n8n.

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

- If `opencode` is not found, close and reopen PowerShell first. If it is still not found, check that the OpenCode install location is on your Windows `PATH`.

---

## 3. Install Toolkit Skills For OpenCode

OpenCode stays on a short manual whole-skill-folder install note only.

Copy the whole `skills/<skill-name>/` folder.

**Choose any one supported OpenCode skill-folder location:**

- `<repo>/.opencode/skills/<skill-name>/SKILL.md`.
- `C:\Users\<your-user>\.config\opencode\skills\<skill-name>\SKILL.md`.
- A compatible `.agents/skills/` or `.claude/skills/` location if that is how the target OpenCode runtime is configured.

Do not copy only `SKILL.md`. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

---

## 4. Create Global OpenCode Rules

### Follow the OpenCode AGENTS.md Setup guide:

- Install or copy generic AI coding agent rules from [AGENTS.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md), then copy or merge them into the target repo root as `AGENTS.md`.
- Install or load `skills/n8n-agent-rules` for the full n8n operating contract before workflow, MCP, helper-script, or live n8n work.
- Optionally merge the brief `AGENTS.n8n-brief.template.md` adapter from `skills/n8n-agent-rules/adapters/` into the same `AGENTS.md`. Do not copy the full n8n rules into always-on instructions unless you intentionally accept the context cost.
- If the target repo already has `AGENTS.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 5. Create The Global OpenCode MCP Config

### Follow the OpenCode MCP Config guide:

- [templates/opencode-mcp-config.md](./templates/opencode-mcp-config.md)

---

## 6. Restart OpenCode

### After changing any of these:

- `$HOME\.config\opencode\opencode.json`
- `$HOME\.config\opencode\AGENTS.md`
- `N8N_MCP_URL`
- `N8N_MCP_TOKEN`

### Restart OpenCode from a fresh PowerShell window:

```powershell
opencode
```

- You can start OpenCode from any folder. Open a specific repo only when you actually want OpenCode to inspect or edit that repo.

---

## References

- [OpenCode config docs](https://opencode.ai/docs/config/)
- [OpenCode rules docs](https://opencode.ai/docs/rules/)
- [OpenCode MCP servers docs](https://opencode.ai/docs/mcp-servers/)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
