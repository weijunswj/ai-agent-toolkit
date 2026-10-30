# Toolkit Env: Your Keys And Tokens

`toolkit env` keeps the API keys and tokens your coding apps use in this computer's own credential store, and feeds them to Claude Code and Codex when they need them. There is no plain-text key file, and no value ever goes through a chat, a log or a report.

You can ask any agent in your own words ("show env", "let me see my keys", "I need to update my OpenAI key", "is my GitHub token set?"); the `toolkit-env` skill works out what you want and turns it into the commands below. The commands run from the managed Toolkit checkout. To run one yourself in PowerShell:

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
| See, change, add or remove keys | `edit`, then `apply` | Notepad opens a private file with your keys as `NAME=value` lines, like a `.env` file. Each save is applied within a few seconds: see [Your keys in Notepad](#your-keys-in-notepad). When you are finished, close the tab and tell your agent "done", or run the `apply` line shown at the top of the file. It lists what was changed, added and removed, by name, and deletes the file. |
| Set one key | `set NAME` | Asks for the value with hidden input. Run it yourself in PowerShell, as shown above. |
| See one value | `show NAME` or `show NAME --copy` | Shows the value once, or copies it to the clipboard, in a PowerShell window you opened yourself. See [Seeing a value](#seeing-a-value). |
| Remove a key | `remove NAME` | Asks a yes/no that names the key first. |
| Run a command-line tool with a key | `run --names NAME -- <tool> <args>` | Starts the tool with only those keys added to its environment. It refuses unknown names and the usual commands that print the whole environment (such as `env`, `printenv`, `set` or `Get-ChildItem env:`); it cannot catch every way a program can print a variable. Programs start directly, without a shell; on Windows, npm-installed tools run through the program their command script wraps, and other `.cmd` or `.bat` scripts are refused. |

## Your keys in Notepad

`edit` writes a fresh private file from the store every time, in your saved order with your own comment lines, and opens it in Notepad:

- Change a value, add a `NAME=value` line, or delete a line to remove that key. Type values without quotes; spaces at either end are dropped.
- Save. A small helper started with the file applies the save once the file has stopped changing for about a second and a half. It watches only that file, prints nothing and writes no log.
- When you are finished, close the tab and say "done" (or run `apply`). It applies a save not applied yet, deletes the file and lists what changed, by name only.

A save is applied whole or not at all. Nothing is saved, and the `# Status:` line at the top of the file says why, when:

- a line is not `NAME=value`, has no value, uses a key name twice, has a value in quotes or is too long, or a comment looks like a key;
- the file was saved as UTF-16 (save it as UTF-8);
- the save would remove every key;
- a key changed elsewhere (`set`, `remove`, an import) while the tab was open. Ask for your keys again for a fresh tab, and copy your changes across; the typed lines stay in your tab.

A key added elsewhere while the tab is open is never removed by it. A value that one line cannot show exactly (a line break, spaces at either end, or wrapping quotes) appears as `<kept: change it with toolkit env set NAME>` and stays as it is.

Every `edit` wipes the earlier file first, so Notepad always shows what is stored now. A save from an older Notepad tab is never applied: the file it writes is wiped, and the next result says to use the newest tab. A save that was not applied when you start a new edit is not carried over, and the result says so. The file is overwritten with zeros, then deleted, at "done" or 30 minutes after its last save.

Notepad's tab restore can keep its own copy of an open tab. After "done", Toolkit checks Notepad's tab-restore folder for the file's name (yes or no, never its content) and, when it finds it, tells you to close the tab and to set Notepad > Settings > When Notepad starts to "Start new session". Toolkit never changes Notepad's own files.

## Seeing a value

`show NAME` is for you, in a PowerShell window you open yourself. Run it as shown above, with `show NAME` at the end. It asks you to type the key's name again, then prints the value on its own line. Clear the window afterwards (`Clear-Host`) and never paste the value into a chat.

`show NAME --copy` puts the value on the clipboard instead and prints nothing. Toolkit marks the copy so Windows clipboard history (Win+V) and clipboard sync across devices skip it where Windows honours that mark. It may still be kept, so clear it in Settings > System > Clipboard > Clear when you are done.

`show` takes exactly one name; there is no way to show every value. Before it reads the store, it stops when:

- it runs in a shell an agent started, or in an app's built-in terminal, because those carry the agent's environment (Claude Code, Codex or a tool that sets `AI_AGENT`). The message gives you the line to run in your own PowerShell window;
- it is not reading from and printing to a terminal (a pipe, or output sent to a file);
- the name you retype does not match exactly. It then prints "Not shown." and reads nothing.

Nothing about `show` is written to the record, a log or a backup.

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

This screen cannot recognise every secret. A short password or a multi-word passphrase can look exactly like a heading and be saved as comment text. Never put a password, key or token in a comment. Retaining arbitrary comment text cannot guarantee that the layout is secret-free. The private edit file (while it is open, and any copy Notepad keeps of its tab) and a retired `.env` backup intentionally contain real values and must be treated as sensitive. Agents are told never to open, read or search the edit folder.

Values are protected at rest by your operating-system login, and no single plain file holds them all. Any program running as you, including an agent's shell command, can still ask the store for a value, so this is not isolation from the agent or other programs. The skill rules, `run`'s name list and the tests that check no value reaches output reduce that risk but do not remove it. The same holds for `show`: its checks stop an agent reading a value through Toolkit by accident or on a casual request, not a determined program running as you. An agent that runs commands in a pseudo-terminal could pass the terminal check; the agent-shell check and the retyped name are what stop it.
