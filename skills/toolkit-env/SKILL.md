---
name: toolkit-env
description: Use when the user wants to see, check, change, add or remove their env keys, API keys, tokens or secrets, in any words, or connect an app or MCP server to one. Covers "show env", "let me see my keys", "what's in my env", "I need to update my OpenAI key", "add the Stripe test key", "remove the old n8n token", "rotate my Neon key" and "toolkit env". Values stay in the computer's own credential store and never pass through chat.
---

# Toolkit Env

`toolkit env` keeps the user's API keys and tokens in this computer's own credential store (Windows Credential Manager; Toolkit supports Windows computers only) and feeds them to Claude Code and Codex. You run its commands; the user types any value themselves, outside the chat.

## Run it

Use the managed Toolkit checkout, so connected apps keep working after updates:

- `node "<home folder>/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs" <command>`

Write `<home folder>` as the resolved path in forward slashes, inside the double quotes (a space is fine). Never put `$env:...` or `%...%` in the command and never `cd` first: the host may run it through PowerShell or `cmd.exe`, and this line starts the same way in both.

If `repo/scripts/toolkit-env.cjs` is missing from the managed checkout, ask the user to run `setup toolkit` first. When you tell the user about a command you run, call it `toolkit env <command>`. When the user must run one themselves, give them the same full line you would run, with the resolved home folder, so they can paste it into a PowerShell window they open themselves; never just `toolkit env <command>`, which their terminal does not know.

## What the user asks, and what you run

| The user wants to | Run |
|---|---|
| see, check, change, update, rotate, add or remove their keys, in any words ("show env", "let me see my keys", "I need to update my OpenAI key", "remove the old n8n token") | `edit`, then wait for them to say "done", then `apply` |
| a names-only question ("is my GitHub token set?", "which keys does Codex use?") | `status` |
| set one key | ask them to run the full PowerShell line for `set NAME` in their own terminal (it asks for the value with hidden input) |
| see a key's value | ask them to run the full PowerShell line for `show NAME` (or `show NAME --copy`) in a PowerShell window they open themselves; it asks them to retype the name. Never run it yourself |
| remove or delete a key without opening Notepad | ask "Remove NAME? yes or no" naming the exact key; only after they say yes, run `remove NAME` and answer `yes` on its stdin. Deleting its line in Notepad during an `edit` removes it too |
| connect an MCP server entry to a key | `connect SERVER --name NAME`; show them the planned changes and pass on their yes or no |
| undo connected entries | `revoke --feeders`, after their yes |
| run a command-line tool that needs a key | `run --names NAME -- <tool> <args>` |
| move from `~/.codex/.env` | `import-codex-env`; the user types `retire-codex-env` themselves when they are ready |

Work out from what the user says whether they want their keys in front of them. When they want to see, change, add or remove keys in any words, run `edit`; there is no fixed phrase. Use `status` only for a names-only question you can answer from names. When you only need a key for your own task, use `run` or a connected entry as below, never `edit`. When you are unsure, run `edit`, because it shows the user everything.

After `edit`, Notepad opens a private file that lists every key as `NAME=value` with the real value, like a `.env` file. Tell them: change a value, add a `NAME=value` line, or delete a line to remove that key, then save; each save is applied within a few seconds. When they are finished they close the tab and say "done". Then run `apply` and report its `changed:`, `added:` and `removed:` lines and any other line it prints. A save that would remove every key is not applied. Each `edit` makes a fresh file from the store and wipes the earlier one; a save from an older Notepad tab is ignored. Their own `#` comment and section lines are kept in place for the next edit. Assignment values are never copied to the layout, but accepted comments are saved verbatim in `manifest.json`: never put a password, key or token in a comment. The conservative comment screen cannot recognise every secret, including ordinary passphrases. `apply` refuses suspicious comments by line number only. `import-codex-env` and `retire-codex-env` keep accepted comment lines from `~/.codex/.env` the first time, and retire says when its backup is the only copy of a comment.

Comments over 200 characters are refused before screening. The screen checks `NAME=value` assignments with non-empty values other than `<unchanged>`, common token prefixes, opaque runs of at least 24 characters containing letters or digits, and hidden controls. NFKC catches look-alikes it maps to `=`, such as fullwidth equals, not every look-alike or assignment syntax. Runs of two or more `=` are decoration. Decorated headings, empty or `<unchanged>` commented-out key lines, and Unicode headings can be kept. HTTP(S) URLs and slash-separated or backslash-separated file paths ending in an extension are screened component by component for opaque runs; assignments and token prefixes are still screened throughout. Zero-width joiners are allowed only between emoji pictographs, with optional variation selectors or skin-tone modifiers before the joiner. Other hidden controls are refused. The duplicate-key and value-too-long `apply` messages use line numbers without naming the key. Unsafe stored layouts identify entries counting from 1 in the manifest's `layout` list, not JSON file line numbers.

## Rules

- Never ask for a value in chat, never type one into a command, and never pipe one into `set`.
- Never open, read, write, search or list the edit file or its folder (`~/.ai-agent-toolkit/env/edit/`): it holds the real values. You only start `edit` and pass on "done" by running `apply`. Changing the file yourself would be acting as the user.
- Never print, echo, read back or summarise a value. `status` shows names only; do not try to show more.
- Never run `show`, and never ask the user to paste what it printed. It refuses in agent shells and the app's built-in terminal, and needs a real terminal: this stops a value reaching you by accident or on a casual request, not a determined program running as the user.
- Do not run `header`; the apps run it. Do not use `run` to start a shell or anything that prints the environment.
- If the user pastes a secret into the chat anyway, do not repeat it. Tell them it is now exposed, recommend rotating it at the provider, and offer `edit` to save the new one.
- Removing a key with `remove`, connecting or undoing entries, and retiring `~/.codex/.env` change things on the user's computer: do them only after the user's own yes for that exact key or entry. A line the user deletes in Notepad is their own change and needs no extra question.
- Key names look like `PROVIDER_SOLUTION_PURPOSE` (for example `COOLIFY_SWOOSHZ_MCP_TOKEN`): upper case letters, digits and underscores, at least three parts, never starting with `CODEX_`.
- On a computer other than Windows it stops with a message; pass it on. There is no plain-file fallback.

## After a change

Claude Code reads a changed value on its next MCP connection. Codex does too, except right after `connect` or `revoke`, when the user restarts Codex once. Report exactly the lines the command printed.
