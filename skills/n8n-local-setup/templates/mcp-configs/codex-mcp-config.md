<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/mcp-configs/codex-mcp-config.md
Update the project source and run sync.
-->
# Codex MCP Config

Use this for the normal Codex + n8n MCP setup.

* Do not paste your real n8n token into this file or any repo file.
* Keep `bearer_token_env_var = "N8N_MCP_TOKEN"` exactly as shown.

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

## 1. Save The Live MCP URL And Token

1. Decide which MCP URL you will use.

   - For normal local n8n on the default port:

      ```text
      http://localhost:5678/mcp-server/http
      ```

   - If your n8n is not on `localhost:5678`, use your actual MCP URL instead:

      ```text
      https://your-n8n-domain.com/mcp-server/http
      ```

      **Codex treats `url` as a literal string, so do not use `${N8N_MCP_URL}` in the Codex config. You will paste the URL directly into the config in the next section.**

2. Save the live MCP token at user scope in PowerShell:

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

1. Paste the following into `config.toml` and set the `url` value to the MCP URL you chose in Section 1:

   ```toml
   [mcp_servers.n8n_docs]
   command = "npx"
   args = ["-y", "n8n-mcp@latest"]
   env = { MCP_MODE = "stdio", LOG_LEVEL = "error", DISABLE_CONSOLE_OUTPUT = "true" }

   [mcp_servers.n8n_live]
   url = "http://localhost:5678/mcp-server/http"
   bearer_token_env_var = "N8N_MCP_TOKEN"
   enabled = true
   ```

2. If `npx` is blocked on Windows, replace the `n8n_docs` block with this:

   ```toml
   [mcp_servers.n8n_docs]
   command = "C:\\Program Files\\nodejs\\npx.cmd"
   args = ["-y", "n8n-mcp@latest"]
   env = { MCP_MODE = "stdio", LOG_LEVEL = "error", DISABLE_CONSOLE_OUTPUT = "true" }
   ```

---

## 3. Verify Both MCP Servers

1. In Codex, open:

   ```text
   Settings -> MCP servers
   ```

2. You should see:

   * `n8n_docs`
   * `n8n_live`

3. If `n8n_live` fails:

   * Confirm the `url` in `config.toml` matches your actual n8n MCP endpoint.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Codex after changing the token or config.

---

## 4. Test The MCP Setup

1. Perform docs-only smoke test:

   ```text
   Use n8n_docs. Find the smallest no-credentials workflow pattern that uses Manual Trigger and Set. Do not create anything yet.
   ```

2. Perform live read-only smoke test:

   ```text
   Use n8n_live. List workflows. Do not modify anything.
   ```

---

## 5. Create A Tiny Live Smoke-Test Workflow

1. This is the safest first workflow:

   * Manual Trigger.
   * Set.
   * No credentials.
   * Inactive by default.

2. Use this prompt in Codex:

   ```text
   Use n8n_docs first. Design and validate a tiny no-credentials workflow with Manual Trigger and Set. Then use n8n_live to create it in my n8n instance as INACTIVE. Name it "Codex Smoke Test".
   ```

3. After Codex creates it, ask Codex to read it back and confirm:

   ```text
   Use n8n_live. Read back "Codex Smoke Test" and confirm it is inactive.
   ```

---

## 6. Why This Shape

* `n8n_docs` uses the community MCP through `npx`.
* `MCP_MODE=stdio`, `LOG_LEVEL=error`, and `DISABLE_CONSOLE_OUTPUT=true` keep the stdio MCP channel clean.
* `n8n_live.url` is a literal MCP endpoint. Change the URL manually if your n8n is not on `localhost:5678`.
* `bearer_token_env_var = "N8N_MCP_TOKEN"` keeps the real token out of config and repo files.
* Codex does not support `${N8N_MCP_URL}` expansion in the `url` field, so the URL must be set as a literal value.

---

## 7. Troubleshooting

1. If `n8n_docs` fails:

   * Confirm Node.js and `npx` are installed.
   * Try running `npx -y n8n-mcp@latest` from a fresh terminal.
   * If `npx` is blocked, use the full path fallback from Section 2.

2. If `n8n_live` fails:

   * Confirm the `url` in `config.toml` is the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Codex after changing environment variables or config.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

   * Do not replace the environment variables with real token values in this repo.
