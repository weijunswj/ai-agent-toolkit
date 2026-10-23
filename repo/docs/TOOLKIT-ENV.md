# Toolkit Env: Your Keys And Tokens

`toolkit env` keeps the API keys and tokens your coding apps use in this computer's own credential store, and feeds them to Claude Code and Codex when they need them. There is no plain-text key file, and no value ever goes through a chat, a log or a report.

You can ask any agent in words ("edit my env", "what keys do I have", "remove the Coolify token"); the `toolkit-env` skill turns that into the commands below. The commands run from the managed Toolkit checkout:

```powershell
node "$env:USERPROFILE\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\toolkit-env.cjs" status
```

## Where the values live

| Computer | Store | Where you can see the entries |
|---|---|---|
| Windows | Credential Manager, generic credentials named `ai-agent-toolkit/env/<NAME>`, kept on this PC only | Control Panel > Credential Manager > Windows Credentials |

Toolkit supports Windows computers only and uses only tools that come with Windows; on any other computer `toolkit env` stops with a message, and there is no fallback file. One value can be up to 2560 bytes.

Key names look like `PROVIDER_SOLUTION_PURPOSE`, for example `COOLIFY_SWOOSHZ_MCP_TOKEN`: upper case letters, digits and underscores, at least three parts. Names starting with `CODEX_` are refused because Codex reserves them.

## Everyday use

| You want to | Command | What happens |
|---|---|---|
| See your keys | `status` | Names, which app entries use each, present or missing. Never a value, length or prefix. |
| Change or add keys | `edit`, then `apply` | Notepad (or your default editor) opens a private file listing every key as `NAME=<unchanged>`. Type new values over `<unchanged>` or add `NAME=value` lines, save and close, then say "done" (or run `apply`). It prints `changed:` and `added:` lines and deletes the file. A blank value or a deleted line changes nothing. An edit file left unsaved for 30 minutes is deleted by the next command. |
| Set one key | `set NAME` | Asks for the value with hidden input. Run it in your own terminal. |
| Remove a key | `remove NAME` | Asks a yes/no that names the key first. |
| Run a command-line tool with a key | `run --names NAME -- <tool> <args>` | Starts the tool with only those keys added to its environment. It refuses unknown names and the usual commands that print the whole environment (such as `env`, `printenv`, `set` or `Get-ChildItem env:`); it cannot catch every way a program can print a variable. Programs start directly, without a shell; on Windows, npm-installed tools run through the program their command script wraps, and other `.cmd` or `.bat` scripts are refused. |

## Connecting an app

`connect SERVER --name NAME` points an MCP server entry at a key, in each app that has an entry with that name (or only the app named with `--harness claude-code` or `--harness codex`). It shows what it will change and asks for a yes first, and it keeps a backup under `~/.ai-agent-toolkit/backups/env-feeders/`.

- **Claude Code:** the user MCP entry's `headersHelper` becomes `"<node>" "<Toolkit checkout>/repo/scripts/toolkit-env.cjs" header NAME`, changed through the `claude mcp` command. Claude reads the value at each connection, so a changed value applies on the next connection.
- **Codex:** `[mcp_servers.SERVER]` in `~/.codex/config.toml` gets `http_headers_helper` with the same command, and `bearer_token_env_var` (or the matching `env_http_headers` entry) is removed, because Codex prefers it over the helper. The edit is made by Codex's own config editor on a copy, checked key by key, backed up, then saved. Restart Codex once after connecting; after that a changed value applies on the next connection or when the server rejects the old one. Codex 0.148.0 or later is needed.
- **OpenCode:** not supported yet; it will use the same connector contract.

Only HTTP entries without fixed headers or tokens are connected; local (stdio) servers use `run`. `revoke --feeders` puts every connected entry back as it was, from the backup.

`header NAME` prints `{"Authorization":"Bearer <value>"}` for the apps. You never need to run it yourself.

## Moving from `~/.codex/.env`

1. `import-codex-env` copies every `NAME=value` line into the store, reads each one back, and prints the imported names and the line numbers it could not read. The file is not changed. A key already stored with a different value keeps the stored value.
2. `connect` each MCP entry that used one of those keys, and restart Codex once.
3. When everything connects, you run `retire-codex-env` yourself. It checks that every key in the file is stored with the same value and that no Codex MCP entry still reads one from the environment, asks a yes/no, then moves the file to `~/.ai-agent-toolkit/backups/env-retire-<time>/codex.env` (a folder only you can open). It never deletes it. Delete that backup yourself once you are happy; until then, moving it back undoes the change.

## Checks

The install check (run by `setup toolkit` and at each Claude Code session start, once `toolkit env` is in use) reports the store, keys a connected entry needs but the store lacks, entries that changed or point at a Node.js or Toolkit copy that moved, and any Claude Code entry still using the old helper that read `~/.codex/.env`. It reports names only.

## What it protects, and what it does not

`edit` keeps accepted `#` comment and section lines, their order, and single blank lines for the next edit. The layout in `manifest.json` contains key names without assignment values, plus accepted comments verbatim. `apply` refuses suspicious comments by line number only; import and retire omit those comments from the layout and report their line numbers. The duplicate-key and value-too-long `apply` messages also report line numbers without naming the key.

Comments over 200 characters are refused before screening. The screen refuses a `NAME=value` assignment (including inside prose) with a non-empty value other than `<unchanged>`, common token prefixes, opaque runs of at least 24 characters containing letters or digits (including alphabetic base64 and hex), and hidden controls. NFKC normalisation catches look-alikes it maps to `=`, such as fullwidth equals; it does not catch every look-alike or assignment syntax. Runs of two or more `=` are treated as decoration. Headings decorated with `=`, `-` or `#`, and commented-out `#NAME=<unchanged>` or `# NAME=` lines can be kept. URLs beginning with `http://` or `https://`, and slash-separated or backslash-separated file paths ending in a file extension, are screened component by component for opaque runs. Common token prefixes and assignments are still screened throughout. Ordinary Unicode headings can be kept; zero-width joiners are allowed only between emoji pictographs, with optional variation selectors or skin-tone modifiers before the joiner. Other hidden controls are refused.

Existing layouts are checked again before use or writes. An unsafe record identifies each layout entry N (counting from 1) in the "layout" list of `~/.ai-agent-toolkit/env/manifest.json`, so you can remove or reword that list entry locally. N is not a JSON file line number.

This screen cannot recognise every secret. A short password or a multi-word passphrase can look exactly like a heading and be saved as comment text. Never put a password, key or token in a comment. Retaining arbitrary comment text cannot guarantee that the layout is secret-free. The private edit file and a retired `.env` backup intentionally contain typed or original values and must be treated as sensitive.

Values are protected at rest by your operating-system login, and no single plain file holds them all. Any program running as you, including an agent's shell command, can still ask the store for a value, so this is not isolation from the agent or other programs. The skill rules, `run`'s name list and the tests that check no value reaches output reduce that risk but do not remove it.
