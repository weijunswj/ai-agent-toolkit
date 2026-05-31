<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/mcp-configs/opencode-mcp-config.md
Update the project source and run sync.
-->
# OpenCode MCP Config

Use this to connect OpenCode globally to the same n8n setup.

* Do not paste your real n8n token into this file or any repo file.
* Keep `{env:N8N_MCP_URL}` and `{env:N8N_MCP_TOKEN}` exactly as shown.
* Do not put this in a repo-level `opencode.json` unless you intentionally want project-specific OpenCode overrides.

1. Common Windows path for OpenCode MCP config:

   ```text
   C:\Users\<your-user>\.config\opencode\opencode.json
   ```

2. Or create it in PowerShell:

   ```text
   mkdir $HOME\.config\opencode -Force
   notepad $HOME\.config\opencode\opencode.json
   ```

---

## 1. Save The Live MCP URL And Token

1. Set the live MCP URL at user scope.

   - For normal local n8n on the default port:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'http://localhost:5678/mcp-server/http', 'User')
      ```

   - If your n8n is not on `localhost:5678`, use your actual MCP URL instead:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'https://your-n8n-domain.com/mcp-server/http', 'User')
      ```

2. Then save the live MCP token:

   ```powershell
   [Environment]::SetEnvironmentVariable('N8N_MCP_TOKEN', '<paste-token-here>', 'User')
   ```

3. Close and reopen PowerShell after changing either value.

4. Verify both values are available:

   ```powershell
   [Environment]::GetEnvironmentVariable('N8N_MCP_URL', 'User')
   [Environment]::GetEnvironmentVariable('N8N_MCP_TOKEN', 'User')
   ```

---

## 2. Add The Global OpenCode Config

1. Paste the following into `opencode.json`:

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "n8n_docs": {
         "type": "local",
         "command": ["cmd", "/c", "npx", "-y", "n8n-mcp@latest"],
         "enabled": true,
         "timeout": 40000,
         "environment": {
           "MCP_MODE": "stdio",
           "LOG_LEVEL": "error",
           "DISABLE_CONSOLE_OUTPUT": "true"
         }
       },
       "n8n_live": {
         "type": "remote",
         "url": "{env:N8N_MCP_URL}",
         "enabled": true,
         "oauth": false,
         "timeout": 40000,
         "headers": {
           "Authorization": "Bearer {env:N8N_MCP_TOKEN}"
         }
       }
     },
     "tools": {
       "n8n_live_*": true
     },
     "permission": {
       "n8n_live_*": "ask"
     }
   }
   ```

---

## 3. Verify Both MCP Servers

1. List configured MCP servers:

   ```powershell
   opencode mcp list
   ```

2. You should see:

   * `n8n_docs`
   * `n8n_live`

3. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart OpenCode after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

4. If `n8n_live` is enabled and authentication fails, debug it:

   ```powershell
   opencode mcp debug n8n_live
   ```

---

## 4. Test The MCP Setup

1. Perform docs-only smoke test:

   ```powershell
   opencode run "Use n8n_docs. Find the smallest no-credentials workflow pattern that uses Manual Trigger and Set. Do not create anything yet."
   ```

2. Perform live read-only smoke test:

   ```powershell
   opencode run "Use n8n_live. List workflows. Do not modify anything."
   ```

---

## 5. Create A Tiny Live Smoke-Test Workflow

1. This is the safest first workflow:

   * Manual Trigger.
   * Set.
   * No credentials.
   * Inactive by default.

2. Use this prompt in OpenCode:

   ```powershell
   opencode run "Use n8n_docs first. Design and validate a tiny no-credentials workflow with Manual Trigger and Set. Then use n8n_live to create it in my n8n instance as INACTIVE. Name it OpenCode Smoke Test."
   ```

3. After OpenCode creates it, ask OpenCode to read it back and confirm:

   ```powershell
   opencode run "Use n8n_live. Read back OpenCode Smoke Test and confirm it is inactive."
   ```

---

## 6. Why This Shape

* `n8n_docs` uses the community MCP through `npx`.
* `MCP_MODE=stdio`, `LOG_LEVEL=error`, and `DISABLE_CONSOLE_OUTPUT=true` keep the stdio MCP channel clean.
* `n8n_live` is available but approval-gated by the `"permission"` rule for live instance actions.
* `{env:N8N_MCP_URL}` and `{env:N8N_MCP_TOKEN}` keep secrets out of repo and config files.
* `cmd /c npx` is used for native Windows stdio reliability.
* `timeout: 40000` gives MCP servers enough startup time on slower machines.

---

## 7. Troubleshooting

1. If `n8n_docs` fails:

   * Confirm Node.js and `npx` are installed.
   * Try running `npx -y n8n-mcp@latest` from a fresh terminal.

2. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart OpenCode after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.
   * Run `opencode mcp debug n8n_live` for detailed error output.
   * Do not replace the environment variables with real token values in this repo.
