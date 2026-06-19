# Antigravity MCP Config

Use this to connect Google Antigravity globally to the same official n8n instance-level MCP setup.

* Do not paste real n8n tokens into this file or any repo file.
* Open Antigravity MCP settings, then use the raw MCP config editor if available.
* Official n8n Skills plugin support is platform-dependent. If your Antigravity runtime supports plain skill installs from the official n8n Skills package, start n8n work by loading `using-n8n-skills`.

1. Common Windows path for Antigravity/Gemini MCP config:

   ```text
   C:\Users\<your-user>\.gemini\antigravity\mcp_config.json
   ```

2. Or create it in PowerShell:

   ```text
   mkdir $HOME\.gemini\antigravity -Force
   notepad $HOME\.gemini\antigravity\mcp_config.json
   ```

---

## 1. Save The Official MCP URL And Token

1. Set the official MCP URL at user scope.

   - For normal local n8n on the default port:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'http://localhost:5678/mcp-server/http', 'User')
      ```

   - If your n8n is exposed through ngrok or another tunnel, use the actual MCP URL shown by n8n instead:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'https://your-ngrok-or-domain.example/mcp-server/http', 'User')
      ```

2. Then save the official MCP token at user scope:

   ```powershell
   [Environment]::SetEnvironmentVariable('N8N_MCP_TOKEN', '<paste-token-here>', 'User')
   ```

3. Close and reopen Antigravity after changing either value.

4. Verify both values are available from a fresh PowerShell:

   ```powershell
   [Environment]::GetEnvironmentVariable('N8N_MCP_URL', 'User')
   [Environment]::GetEnvironmentVariable('N8N_MCP_TOKEN', 'User')
   ```

---

## 2. Add The Global Antigravity MCP Config

Paste the following into `mcp_config.json`:

```json
{
  "mcpServers": {
    "n8n_live": {
      "command": "node",
      "args": [
        "-e",
        "if(!process.env.N8N_MCP_TOKEN){console.error('N8N_MCP_TOKEN not set');process.exit(1)}require('child_process').spawn('npx',['--yes','supergateway','--streamableHttp',process.env.N8N_MCP_URL,'--oauth2Bearer',process.env.N8N_MCP_TOKEN],{stdio:'inherit',shell:true}).on('exit',c=>process.exit(c))"
      ]
    }
  }
}
```

---

## 3. Verify The Official Skills And MCP Setup

1. Use Antigravity's MCP server UI to confirm the n8n instance-level MCP server is configured:

   * `n8n_live`

2. If official n8n Skills are installed in your Antigravity runtime, ask Antigravity to load them:

   ```text
   Load `using-n8n-skills` and confirm the official n8n Skills are available. Do not use n8n_live and do not modify anything.
   ```

3. Perform a live read-only MCP check inside Antigravity:

   ```text
   Use n8n_live. List workflows. Do not modify anything.
   ```

4. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Antigravity after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

---

## 4. Safety Rules

* Use official n8n Skills and official n8n MCP validation/build tools before proposing live-instance changes.
* Do not create, update, execute, activate, publish, unpublish, archive, delete, import, export, sync, or modify credentials without explicit current-turn approval naming the exact target and allowed operation.
* `n8n_live` uses `supergateway` to bridge Antigravity's local command MCP shape to n8n's streamable HTTP MCP endpoint.
* `N8N_MCP_URL` keeps the live MCP URL configurable for localhost, ngrok, or another domain.
* `N8N_MCP_TOKEN` keeps the live MCP token out of repo files and config text.
* The inline Node command fails fast if `N8N_MCP_TOKEN` is not set.

---

## 5. Troubleshooting

1. If `using-n8n-skills` is unavailable:

   * Confirm your Antigravity runtime supports the official n8n Skills package as a plain skill install.
   * Restart Antigravity after installing skills.
   * If platform support is unavailable, do not pretend parity; use the official n8n documentation manually and keep live MCP actions approval-gated.

2. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Antigravity after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.
   * Do not replace environment variables with real token values in this repo.
