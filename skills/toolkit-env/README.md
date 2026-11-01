# Toolkit Env Skill

Copy the whole [toolkit-env](./) skill folder when an agent needs to recognise requests about the user's env keys, API keys or tokens, in any words: seeing, adding, changing, rotating or removing them (it opens them as `NAME=value` lines in the app the computer uses for `.env` files), or connecting an MCP server entry to one.

This README is only an install and identity note. Runtime guidance lives in `SKILL.md`; the commands live in `repo/scripts/toolkit-env.cjs`, with the stores in `repo/scripts/toolkit-env-store.cjs`, the app connectors in `repo/scripts/toolkit-env-feeders.cjs` and the editor open and cleanup in `repo/scripts/toolkit-env-editor.cjs`. How it works for the owner is in [`repo/docs/TOOLKIT-ENV.md`](../../repo/docs/TOOLKIT-ENV.md).

Values stay in the computer's own credential store. The skill never asks for a value in chat and never shows one; the owner can see one value with `show`, in a PowerShell window they open themselves.
