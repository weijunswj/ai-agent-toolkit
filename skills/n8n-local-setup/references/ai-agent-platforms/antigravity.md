<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/7. extra - antigravity integration.md
Update the project source and run sync.
-->
# EXTRA: Antigravity Integration ( Windows )

The primary local setup guide is [1. Local Setup](../n8n/local-setup.md). This page is retained as a secondary platform reference for Antigravity details, not as a required local setup path.

This extra guide adds Google Antigravity to the same n8n setup used by the Codex guide.

- It does not replace Codex.
- This guide is written for a global Antigravity setup. You do not need to open this repo in Antigravity just to use the n8n MCP servers.

It gives Antigravity:

- Global `n8n_docs` access for node search and workflow validation using the community MCP.
- Global `n8n_live` access for your real n8n instance using the official MCP through a local `supergateway` bridge.
- Global Antigravity MCP config in `C:\Users\<your-user>\.gemini\antigravity\mcp_config.json`.
- Global Antigravity `GEMINI.md` rules in `C:\Users\<your-user>\.gemini\GEMINI.md`.
- A safe smoke-test path that keeps workflows inactive by default.

---

## 1. Before You Start

Finish [1. Local Setup](../n8n/local-setup.md) first if you are using local n8n.

You should already have:

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed if you are running local n8n.
2. [Node.js](https://nodejs.org/en/download) installed.
3. [Antigravity](https://antigravity.google/) installed.
4. An n8n instance running locally, through a tunnel, or on a hosted domain.
5. Instance-level MCP enabled in n8n.
6. The live n8n MCP server URL copied from n8n.
7. A live n8n MCP token copied from n8n.

---

## 2. Install Antigravity

### Install Antigravity using the official install method for your machine.

### Also verify Node.js and npm in a fresh PowerShell window:

```powershell
node -v
npm -v
npx --version
```

- The Antigravity MCP config in this guide uses `node`, `npx`, and `supergateway`, so Node.js must be available on your Windows `PATH`.

---

## 3. Install Toolkit Skills For Antigravity

Preferred install: use Antigravity plugin-scoped skill folders.

Observed Antigravity runtimes load custom skills from plugin-scoped folders under:

```text
C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md
```

Suggested structure:

```text
C:\Users\<user>\.gemini\config\plugins\
`-- <plugin-name>\
    |-- plugin.json
    `-- skills\
        `-- ai-coding-agent-rules\
            |-- README.md
            `-- SKILL.md
```

Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder.

Do not copy only `SKILL.md`. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

Use a minimal `plugin.json` only when the installed Antigravity runtime or docs require plugin metadata.

This plugin-scoped folder is for loading toolkit skills. Repo-local bootstrap outputs still go into the target repo as `AGENTS.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.

---

## 4. Create Global Antigravity GEMINI.md Rules

### Follow the Antigravity GEMINI.md setup guide:

- Install or copy generic AI coding agent rules from [GEMINI.template.md](../../../ai-coding-agent-rules/repo-local/GEMINI.shim.template.md), then copy or merge them into the target repo root as `GEMINI.md`.
- Install or load `skills/n8n-agent-rules` for the full n8n operating contract before workflow, MCP, helper-script, or live n8n work.
- Optionally merge the brief `GEMINI.n8n-brief.template.md` adapter from `skills/n8n-agent-rules/adapters/` into the same `GEMINI.md`. Do not copy the full n8n rules into always-on instructions unless you intentionally accept the context cost.
- If the target repo already has `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

## 5. Create The Global Antigravity MCP Config

### Follow the Antigravity MCP Config guide:

- [templates/antigravity-mcp-config.md](./templates/antigravity-mcp-config.md)

---

## 6. Restart Antigravity

### After changing any of these:

- `$HOME\.gemini\antigravity\mcp_config.json`
- `$HOME\.gemini\GEMINI.md`
- `N8N_MCP_URL`
- `N8N_MCP_TOKEN`

### Fully close and reopen Antigravity.

- You can open any folder. Open a specific repo only when you actually want Antigravity to inspect or edit that repo.

---

## 7. Troubleshooting

### Antigravity agent stops replying after an update

If Antigravity opens normally but the agent stops replying inside a specific project, check whether the repo's hidden Git config contains the `worktreeConfig = true` extension.

This can happen after an Antigravity update. In this failure mode, a blank folder may work, but Antigravity stops responding after you open a project that contains the affected `.git` folder.

From the affected project folder, run:

```powershell
cd .git
ls
antigravity config
```

The `antigravity config` command opens the hidden `.git/config` file in Antigravity.

Inside that file, look for this section:

```ini
[extensions]
    worktreeConfig = true
```

Delete only this line:

```ini
    worktreeConfig = true
```

Save the file, fully close Antigravity, then reopen the project.

- Do not delete random lines from `.git/config`.
- If `[extensions]` becomes empty after removing the line, it is safe to remove the empty `[extensions]` header too.
- This fix is only for the bug where Antigravity stops replying because of `worktreeConfig = true` in `.git/config`.

---

## References

- [Google Antigravity documentation](https://antigravity.im/documentation)
- [Antigravity MCP setup notes](https://antigravity.codes/blog/antigravity-mcp-tutorial)
- [GEMINI.md setup notes for Antigravity](https://docs.endorlabs.com/setup-deployment/mcp/antigravity)
- [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/)
