<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/mcp-configs/antigravity-mcp-config.md
Update the project source and run sync.
-->
# Antigravity MCP Config

Use this to connect Google Antigravity globally to the same n8n setup.

* Do not paste real n8n tokens into this file or any repo file.
* Open Antigravity MCP settings, then use the raw MCP config editor if available.

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

## 1. Save The Live MCP URL And Token

1. Set the live MCP URL at user scope.

   - For normal local n8n on the default port:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'http://localhost:5678/mcp-server/http', 'User')
      ```

   - If your n8n is exposed through ngrok or another tunnel, use the actual MCP URL shown by n8n instead:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'https://your-ngrok-or-domain.example/mcp-server/http', 'User')
      ```

2. Then save the live MCP token at user scope:

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

1. Paste the following into `mcp_config.json`:

    ```json
    {
      "mcpServers": {
        "n8n_docs": {
          "command": "npx",
          "args": [
            "-y",
            "n8n-mcp@latest"
          ],
          "env": {
            "MCP_MODE": "stdio",
            "LOG_LEVEL": "error",
            "DISABLE_CONSOLE_OUTPUT": "true"
          }
        },
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

## 3. Verify Both MCP Servers

1. Use Antigravity's MCP server UI to confirm both servers are configured:

    * `n8n_docs`
    * `n8n_live`

2. If `n8n_live` fails:

    * Confirm `N8N_MCP_URL` is the MCP endpoint, not just the n8n UI URL.
    * Confirm `N8N_MCP_TOKEN` is set at user scope.
    * Restart Antigravity after changing environment variables.
    * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

---

## 4. Test The MCP Setup

1. Perform docs-only smoke test inside Antigravity:

    ```text
    Use n8n_docs. Find the smallest no-credentials workflow pattern that uses Manual Trigger and Set. Do not create anything yet.
    ```

2. Perform live read-only smoke test inside Antigravity:

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

2. Use this prompt in Antigravity:

    ```text
    Use n8n_docs first. Design and validate a tiny no-credentials workflow with Manual Trigger and Set. Then use n8n_live to create it in my n8n instance as INACTIVE. Name it "Antigravity Smoke Test".
    ```

3. After Antigravity creates it, ask Antigravity to read it back and confirm:

    ```text
    Use n8n_live. Read back "Antigravity Smoke Test" and confirm it is inactive.
    ```

---

## 6. Why This Shape

* `n8n_docs` uses the community MCP through `npx`.
* `MCP_MODE=stdio`, `LOG_LEVEL=error`, and `DISABLE_CONSOLE_OUTPUT=true` keep the stdio MCP channel clean.
* `n8n_live` uses `supergateway` to bridge Antigravity's local command MCP shape to n8n's streamable HTTP MCP endpoint.
* `N8N_MCP_URL` keeps the live MCP URL configurable for localhost, ngrok, or another domain.
* `N8N_MCP_TOKEN` keeps the live MCP token out of repo files and config text.
* The inline Node command fails fast if `N8N_MCP_TOKEN` is not set.

---

## 7. Troubleshooting

1. If `n8n_docs` fails:

    * Confirm Node.js and `npx` are installed.
    * Try running `npx -y n8n-mcp@latest` from a fresh terminal.

2. If `n8n_live` fails:

    * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
    * Confirm `N8N_MCP_TOKEN` is set at user scope.
    * Restart Antigravity after changing environment variables.
    * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

    * Do not replace the environment variables with real token values in this repo.
