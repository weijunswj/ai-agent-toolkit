---
name: toolkit-env
description: Use when the user talks about their env, env keys, secrets, API keys or tokens and wants to see, list, check, add, set, change, update, edit, rotate, remove or delete them, or connect an app or MCP server to one. Covers "toolkit env", "edit my env", "add a key", "remove the Coolify token", "rotate my Neon key" and "what keys do I have". Values stay in the computer's own credential store and never pass through chat.
---

# Toolkit Env

`toolkit env` keeps the user's API keys and tokens in this computer's own credential store (Windows Credential Manager; Toolkit supports Windows computers only) and feeds them to Claude Code and Codex. You run its commands; the user types any value themselves, outside the chat.

## Run it

Use the managed Toolkit checkout, so connected apps keep working after updates:

- `node "$env:USERPROFILE\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\toolkit-env.cjs" <command>`

If that file is missing, ask the user to run `setup toolkit` first. When you tell the user about a command, call it `toolkit env <command>`.

## What the user asks, and what you run

| The user wants to | Run |
|---|---|
| see, list or check their keys ("what keys do I have") | `status` |
| edit, change, update, rotate or add keys ("edit my env", "add a key") | `edit`, then wait for them to say "done", then `apply` |
| set one key | ask them to run `toolkit env set NAME` in their own terminal (it asks for the value with hidden input) |
| remove or delete a key | ask "Remove NAME? yes or no" naming the exact key; only after they say yes, run `remove NAME` and answer `yes` on its stdin |
| connect an MCP server entry to a key | `connect SERVER --name NAME`; show them the planned changes and pass on their yes or no |
| undo connected entries | `revoke --feeders`, after their yes |
| run a command-line tool that needs a key | `run --names NAME -- <tool> <args>` |
| move from `~/.codex/.env` | `import-codex-env`; the user types `retire-codex-env` themselves when they are ready |

After `edit`, Notepad (or their default editor) opens a private file that lists every key as `NAME=<unchanged>`. Tell them: type new values over `<unchanged>` or add `NAME=value` lines, save, close, then say "done". Then run `apply` and report its `changed:` and `added:` lines. A blank value or a deleted line changes nothing; removing is always its own step. Their own `#` comment and section lines are kept in place for the next edit (as names and comments only, never values). `apply` refuses a comment that looks like a key or token. `import-codex-env` and `retire-codex-env` keep the comment lines from `~/.codex/.env` the first time, and retire says when its backup is the only copy of a comment.

## Rules

- Never ask for a value in chat, never type one into a command, and never pipe one into `set`.
- Never print, echo, read back or summarise a value. `status` shows names only; do not try to show more.
- Do not run `header`; the apps run it. Do not use `run` to start a shell or anything that prints the environment.
- If the user pastes a secret into the chat anyway, do not repeat it. Tell them it is now exposed, recommend rotating it at the provider, and offer `edit` to save the new one.
- Removing a key, connecting or undoing entries, and retiring `~/.codex/.env` change things on the user's computer: do them only after the user's own yes for that exact key or entry.
- Key names look like `PROVIDER_SOLUTION_PURPOSE` (for example `COOLIFY_SWOOSHZ_MCP_TOKEN`): upper case letters, digits and underscores, at least three parts, never starting with `CODEX_`.
- On a computer other than Windows it stops with a message; pass it on. There is no plain-file fallback.

## After a change

Claude Code reads a changed value on its next MCP connection. Codex does too, except right after `connect` or `revoke`, when the user restarts Codex once. Report exactly the lines the command printed.
