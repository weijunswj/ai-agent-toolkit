<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/mcp-configs/claude-mcp-config.md
Update the project source and run sync.
-->
# Claude Code MCP Config

Use this to connect Claude Code globally to the same official n8n instance-level MCP setup.

* Do not paste your real n8n token into this file or any repo file.
* This uses Claude Code user scope, so the MCP server is available across projects.
* Do not create `.mcp.json` unless you intentionally want project-specific Claude Code MCP config.
* On Windows, do not trust official plugin hooks unless `hooks/hooks.json` invokes a Windows-safe command, such as a Node or PowerShell wrapper, instead of a bare `.sh` path. Hook emitters must also output valid JSON with Node when `jq` and `python3` are unavailable.
* If Claude Code opens an installed plugin `hooks\session-start.sh` file on every new chat, the installed plugin is invoking a bare `.sh` hook on Windows. Run `node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "C:\Users\<user>\.codex\plugins\cache\n8n-io\n8n-skills\<version>" --windows`, replacing the path with your actual cache path. If it fails, remove, disable, untrust, or uninstall the official plugin hooks or plugin. Restart Claude Code, use `npx skills add n8n-io/skills`, and keep the `AGENTS.md` or `CLAUDE.md` cue that loads `using-n8n-skills` before n8n work. Only reinstall or re-trust the official plugin after hook metadata is Windows-safe and Node JSON fallback exists; the installed plugin cache may need manual reinstall or update after upstream fixes.
* Install the [official n8n Skills](https://github.com/n8n-io/skills) plugin separately with `/plugin marketplace add n8n-io/skills` and `/plugin install n8n-skills@n8n-io` only where the hook checks pass. Otherwise use the upstream "Other platforms" route, `npx skills add n8n-io/skills`, plus the target repo `AGENTS.md` or `CLAUDE.md` cue.
* Restart Claude Code and approve or trust the official plugin hooks only after those checks pass so `SessionStart`, `PreToolUse`, and `PostToolUse` reminders can fire.

1. Claude Code stores user-scoped MCP config here:

   ```text
   C:\Users\<your-user>\.claude.json
   ```

2. Do not manually create or edit this file for the normal setup. The `claude mcp add-json ... --scope user` command below will update it for you.

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

## 2. Save The Official MCP URL And Token

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

## 3. Add The Claude Code MCP Config

1. Add `n8n_live` with environment-backed URL and auth header:

   ```powershell
   claude mcp add-json n8n_live '{"type":"http","url":"${N8N_MCP_URL}","headers":{"Authorization":"Bearer ${N8N_MCP_TOKEN}"}}' --scope user
   ```

2. Do not use a command that expands the URL or token before saving the MCP server. The saved config must stay environment-backed:

   ```text
   url = ${N8N_MCP_URL}
   Authorization = Bearer ${N8N_MCP_TOKEN}
   ```

   * If the n8n MCP URL or token changes later, update `N8N_MCP_URL` or `N8N_MCP_TOKEN` and restart Claude Code Desktop.

3. If you previously added `n8n_live` with a fixed URL or fixed token value, remove and re-add it:

   ```powershell
   claude mcp remove n8n_live
   claude mcp add-json n8n_live '{"type":"http","url":"${N8N_MCP_URL}","headers":{"Authorization":"Bearer ${N8N_MCP_TOKEN}"}}' --scope user
   ```

---

## 4. Verify The Official Skills And MCP Setup

1. Run this in PowerShell:

   ```powershell
   claude mcp list
   claude mcp get n8n_live
   ```

2. You should see only the n8n instance-level MCP server from this template:

   * `n8n_live`

3. Ask Claude Code to load the [official n8n Skills](https://github.com/n8n-io/skills):

   ```text
   Load the [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`, and confirm the [official n8n Skills](https://github.com/n8n-io/skills) are available. Do not use n8n_live and do not modify anything.
   ```

4. Perform a live read-only MCP check:

   ```text
   Use n8n_live. List workflows. Do not modify anything.
   ```

5. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Claude Code Desktop after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.

---

## 5. Safety Rules

* Use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance.
* Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
* Do not create, update, execute, activate, publish, unpublish, archive, delete, import, export, sync, or modify credentials without explicit current-turn approval naming the exact target and allowed operation.
* `n8n_live` connects to whichever n8n MCP URL is stored in `N8N_MCP_URL`.
* `${N8N_MCP_URL}` keeps the live MCP endpoint configurable.
* `${N8N_MCP_TOKEN}` keeps the live auth header environment-backed instead of saving a fixed token value.
* `--scope user` makes the MCP server available across Claude Code projects.

---

## 6. Troubleshooting

1. If the [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`, is unavailable:

   * Confirm the official plugin was installed with `/plugin marketplace add n8n-io/skills` and `/plugin install n8n-skills@n8n-io`.
   * Restart Claude Code.
   * If Claude Code opens `session-start.sh` on every new chat, audit the installed plugin cache with `node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "<plugin-cache-path>" --windows`. If it fails, remove, disable, untrust, or uninstall the official plugin hooks or plugin, then use `npx skills add n8n-io/skills` and the target repo `AGENTS.md` or `CLAUDE.md` cue until an upstream-safe plugin update is installed.
   * On Windows, inspect the installed plugin `hooks/hooks.json`. If it directly invokes `.sh` files, or the hook emitters require only `jq` or `python3` with no Node fallback, do not approve those hooks; use `npx skills add n8n-io/skills` and the target repo `AGENTS.md` or `CLAUDE.md` cue instead.
   * Approve or trust the official plugin hooks when prompted only after the hook checks pass.

2. If `n8n_live` fails:

   * Confirm `N8N_MCP_URL` is set to the MCP endpoint, not just the n8n UI URL.
   * Confirm `N8N_MCP_TOKEN` is set at user scope.
   * Restart Claude Code Desktop after changing environment variables.
   * Confirm the same URL and token work from the n8n MCP client menu or another known-good client.
   * If you previously added `n8n_live` with a hardcoded URL or token, remove and re-add it with the environment-backed version.
   * Do not replace environment variables with real token values in this repo.
