<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/mcp-configs/codex-mcp-config.md
Update the project source and run sync.
-->
# Codex MCP Config

Use this for the normal Codex + official n8n instance-level MCP setup.

* Do not paste your real n8n token into this file or any repo file.
* Keep `bearer_token_env_var = "N8N_MCP_TOKEN"` exactly as shown.
* Install the [official n8n Skills](https://github.com/n8n-io/skills) plugin separately with `codex plugin marketplace add n8n-io/skills` and `codex plugin add n8n-skills@n8n-io`.
* Restart Codex and approve or trust the official plugin hooks so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.

1. Common Windows path for Codex MCP config:

   ```text
   C:\Users\<your-user>\.codex\config.toml
   ```

2. Or create it in PowerShell:

   ```text
   mkdir $HOME\.codex -Force
   notepad $HOME\.codex\config.toml
   ```

---

## 1. Save The Official MCP URL And Token

1. Decide which MCP URL you will use.

   - For normal local n8n on the default port:

      ```text
      http://localhost:5678/mcp-server/http
      ```

   - If your n8n is not on `localhost:5678`, use your actual MCP URL instead:

      ```text
      https://your-n8n-domain.com/mcp-server/http
      ```

      **Codex treats `url` as a literal string, so do not use `${N8N_MCP_URL}` in the Codex config. Paste the URL directly into the config in the next section.**

2. Save the official MCP token at user scope in PowerShell:

   ```powershell
   [Environment]::SetEnvironmentVariable('N8N_MCP_TOKEN', '<paste-token-here>', 'User')
   ```

3. Close and reopen PowerShell after changing the token.

4. Verify the token is available:

   ```powershell
   [Environment]::GetEnvironmentVariable('N8N_MCP_TOKEN', 'User')
   ```

   * Codex reads `N8N_MCP_TOKEN` from the environment at startup, so the Codex desktop app must be restarted after changing this value.

---

## 2. Add The Codex Config

Paste the following into `config.toml` and set the `url` value to the MCP URL you chose in Section 1:

```toml
[mcp_servers.n8n_live]
url = "http://localhost:5678/mcp-server/http"
bearer_token_env_var = "N8N_MCP_TOKEN"
enabled = true
```

---

## 3. Verify The Official Skills And MCP Setup

1. In Codex, open:

   ```text
   Settings -> MCP servers
   ```

2. You should see only the n8n instance-level MCP server from this template:

   * `n8n_live`

3. Ask Codex to load the [official n8n Skills](https://github.com/n8n-io/skills):

   ```text
   Load `using-n8n-skills` and confirm the [official n8n Skills](https://github.com/n8n-io/skills) are available. Do not use n8n_live and do not modify anything.
   ```

4. Perform a live read-only MCP check:

   ```text
   Use n8n_live. List workflows. Do not modify anything.
   ```

5. If `n8n_live` fails:

   * Confirm the `url` in `config.toml` matches your actual n8n MCP endpoint.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Codex after changing the token or config.

---

## 4. Safety Rules

* Use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance.
* Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
* Do not create, update, execute, activate, publish, unpublish, archive, delete, import, export, sync, or modify credentials without explicit current-turn approval naming the exact target and allowed operation.
* `n8n_live.url` is a literal MCP endpoint. Change the URL manually if your n8n is not on `localhost:5678`.
* `bearer_token_env_var = "N8N_MCP_TOKEN"` keeps the real token out of config and repo files.
* Codex does not support `${N8N_MCP_URL}` expansion in the `url` field, so the URL must be set as a literal value.

---

## 5. Troubleshooting

1. If `using-n8n-skills` is unavailable:

   * Confirm the official plugin was installed with `codex plugin marketplace add n8n-io/skills` and `codex plugin add n8n-skills@n8n-io`.
   * Restart Codex.
   * Approve or trust the official plugin hooks when prompted.

2. If `n8n_live` fails:

   * Confirm the `url` in `config.toml` is the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Codex after changing environment variables or config.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.
   * Do not replace environment variables with real token values in this repo.
