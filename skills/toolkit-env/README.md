# Toolkit Env Skill

Copy the whole [toolkit-env](./) skill folder when an agent needs to recognise requests about the user's env keys, API keys or tokens, in any words: seeing, adding, changing, rotating or removing them (it opens them in Notepad as `NAME=value` lines), or connecting an MCP server entry to one.

This README is only an install and identity note. Runtime guidance lives in `SKILL.md`; the commands live in `repo/scripts/toolkit-env.cjs`, with the stores in `repo/scripts/toolkit-env-store.cjs` and the app connectors in `repo/scripts/toolkit-env-feeders.cjs`. How it works for the owner is in [`repo/docs/TOOLKIT-ENV.md`](../../repo/docs/TOOLKIT-ENV.md).

Values stay in the computer's own credential store. The skill never asks for a value in chat and never shows one; the owner can see one value with `show`, in a PowerShell window they open themselves.
