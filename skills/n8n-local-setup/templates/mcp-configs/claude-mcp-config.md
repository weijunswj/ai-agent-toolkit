<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/mcp-configs/claude-mcp-config.md
Update the project source and run sync.
-->
# Claude Code MCP Config

Use this to connect Claude Code globally to the same n8n setup.

* Do not paste your real n8n token into this file or any repo file.
* This uses Claude Code user scope, so the MCP servers are available across projects.
* Do not create `.mcp.json` unless you intentionally want project-specific Claude Code MCP config.

1. Claude Code stores user-scoped MCP config here:

   ```text
   C:\Users\<your-user>\.claude.json
   ```

2. Do not manually create or edit this file for the normal setup. The `claude mcp add-json ... --scope user` commands below will update it for you.

---

## 1. Verify Claude Code CLI

1. Check that the `claude` command is available:

   ```powershell
   claude --version
   ```

2. If PowerShell says `claude` is not recognised, install Claude Code first:

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

3. Close and reopen PowerShell, then verify again:

   ```powershell
   claude --version
   ```

---

## 2. Save The Live MCP URL And Token

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

## 3. Add The Claude Code MCP Config

1. Add `n8n_docs` in PowerShell:

   ```powershell
   claude mcp add-json n8n_docs '{"type":"stdio","command":"cmd","args":["/c","npx","-y","n8n-mcp@latest"],"env":{"MCP_MODE":"stdio","LOG_LEVEL":"error","DISABLE_CONSOLE_OUTPUT":"true"}}' --scope user
   ```

2. Add `n8n_live` with environment-backed URL and auth header:

   ```powershell
   claude mcp add-json n8n_live '{"type":"http","url":"${N8N_MCP_URL}","headers":{"Authorization":"Bearer ${N8N_MCP_TOKEN}"}}' --scope user
   ```

3. Do not use a command that expands the URL or token before saving the MCP server. The saved config must stay environment-backed:

   ```text
   url = ${N8N_MCP_URL}
   Authorization = Bearer ${N8N_MCP_TOKEN}
   ```

   * If the n8n MCP URL or token changes later, update `N8N_MCP_URL` or `N8N_MCP_TOKEN` and restart Claude Code Desktop.

4. If you previously added `n8n_live` with a fixed URL or fixed token value, remove and re-add it:

   ```powershell
   claude mcp remove n8n_live
   claude mcp add-json n8n_live '{"type":"http","url":"${N8N_MCP_URL}","headers":{"Authorization":"Bearer ${N8N_MCP_TOKEN}"}}' --scope user
   ```

---

## 4. Verify Both MCP Servers

1. Run this in PowerShell:

   ```powershell
   claude mcp list
   claude mcp get n8n_docs
   claude mcp get n8n_live
   ```

2. You should see:

   * `n8n_docs`
   * `n8n_live`

3. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Claude Code Desktop after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

---

## 5. Test The MCP Setup

1. Perform docs-only smoke test:

   ```text
   Use n8n_docs. Find the smallest no-credentials workflow pattern that uses Manual Trigger and Set. Do not create anything yet.
   ```

2. Perform live read-only smoke test:

   ```text
   Use n8n_live. List workflows. Do not modify anything.
   ```

---

## 6. Create A Tiny Live Smoke-Test Workflow

1. This is the safest first workflow:

   * Manual Trigger.
   * Set.
   * No credentials.
   * Inactive by default.

2. Use this prompt in Claude Code:

   ```text
   Use n8n_docs first. Design and validate a tiny no-credentials workflow with Manual Trigger and Set. Then use n8n_live to create it in my n8n instance as INACTIVE. Name it "Claude Code Smoke Test".
   ```

3. After Claude creates it, ask Claude to read it back and confirm:

   ```text
   Use n8n_live. Read back "Claude Code Smoke Test" and confirm it is inactive.
   ```

---

## 7. Why This Shape

* `n8n_docs` uses the community MCP through `npx`.
* `MCP_MODE=stdio`, `LOG_LEVEL=error`, and `DISABLE_CONSOLE_OUTPUT=true` keep the stdio MCP channel clean.
* `n8n_live` connects to whichever n8n MCP URL is stored in `N8N_MCP_URL`.
* `cmd /c npx` is used because it behaves more reliably for local stdio MCP servers on native Windows.
* `${N8N_MCP_URL}` keeps the live MCP endpoint configurable.
* `${N8N_MCP_TOKEN}` keeps the live auth header environment-backed instead of saving a fixed token value.
* `--scope user` makes the MCP servers available across Claude Code projects.

---

## 8. Troubleshooting

1. If `n8n_docs` fails:

   * Confirm Node.js and `npx` are installed.
   * Try running `npx -y n8n-mcp@latest` from a fresh terminal.

2. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Claude Code Desktop after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.
   * If you previously added `n8n_live` with a hardcoded URL or token, remove and re-add it with the environment-backed version.

   * Do not replace the environment variables with real token values in this repo.
