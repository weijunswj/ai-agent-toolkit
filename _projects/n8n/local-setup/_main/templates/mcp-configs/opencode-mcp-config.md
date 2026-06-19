# OpenCode MCP Config

Use this to connect OpenCode globally to the same official n8n instance-level MCP setup.

* Do not paste your real n8n token into this file or any repo file.
* Keep `{env:N8N_MCP_URL}` and `{env:N8N_MCP_TOKEN}` exactly as shown.
* Do not put this in a repo-level `opencode.json` unless you intentionally want project-specific OpenCode overrides.
* [Official n8n Skills](https://github.com/n8n-io/skills) plugin hooks are documented for Codex and Claude Code. For OpenCode, use the official "Other platforms" route, `npx skills add n8n-io/skills`, when your runtime is supported by [skills.sh](https://skills.sh).
* Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Add the official `using-n8n-skills` cue to the target repo `AGENTS.md` before relying on automatic n8n task routing.

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

## 1. Save The Official MCP URL And Token

1. Set the official MCP URL at user scope.

   - For normal local n8n on the default port:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'http://localhost:5678/mcp-server/http', 'User')
      ```

   - If your n8n is not on `localhost:5678`, use your actual MCP URL instead:

      ```powershell
      [Environment]::SetEnvironmentVariable('N8N_MCP_URL', 'https://your-n8n-domain.com/mcp-server/http', 'User')
      ```

2. Then save the official MCP token:

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

Paste the following into `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
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

## 3. Verify The Official Skills And MCP Setup

1. List configured MCP servers:

   ```powershell
   opencode mcp list
   ```

2. You should see only the n8n instance-level MCP server from this template:

   * `n8n_live`

3. If [official n8n Skills](https://github.com/n8n-io/skills) are installed in your OpenCode runtime, confirm the target repo `AGENTS.md` cues `using-n8n-skills`, then ask OpenCode to load them:

   ```powershell
   opencode run "Load using-n8n-skills and confirm the [official n8n Skills](https://github.com/n8n-io/skills) are available. Do not use n8n_live and do not modify anything."
   ```

4. Perform a live read-only MCP check:

   ```powershell
   opencode run "Use n8n_live. List workflows. Do not modify anything."
   ```

5. If `n8n_live` is enabled and authentication fails, debug it:

   ```powershell
   opencode mcp debug n8n_live
   ```

---

## 4. Safety Rules

* Use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance.
* Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
* Do not create, update, execute, activate, publish, unpublish, archive, delete, import, export, sync, or modify credentials without explicit current-turn approval naming the exact target and allowed operation.
* `n8n_live` is available but approval-gated by the `"permission"` rule for live instance actions.
* `{env:N8N_MCP_URL}` and `{env:N8N_MCP_TOKEN}` keep secrets out of repo and config files.
* `timeout: 40000` gives the MCP server enough startup time on slower machines.

---

## 5. Troubleshooting

1. If `using-n8n-skills` is unavailable:

   * Confirm your OpenCode runtime supports the [official n8n Skills](https://github.com/n8n-io/skills) package through `npx skills add n8n-io/skills`.
   * Confirm the target repo `AGENTS.md` includes the `using-n8n-skills` cue because plain skill installs do not have the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks.
   * Restart OpenCode after installing skills.
   * If platform support is unavailable, do not pretend parity; use the official n8n documentation manually and keep live MCP actions approval-gated.

2. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart OpenCode after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.
   * Run `opencode mcp debug n8n_live` for detailed error output.
   * Do not replace environment variables with real token values in this repo.
