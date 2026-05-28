---
name: n8n-agent-rules
description: Use for every n8n task, including n8n workflow JSON, n8n MCP, n8n_docs, n8n_live, workflow creation, workflow updates, helper scripts, import/export, validation, credentials, webhook IDs, workflow activation, execution, repo/live sync, and n8n safety. Always apply before n8n workflow or live n8n work.
---

<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Agent Rules

Use this skill before any n8n workflow, helper-script, MCP, or live n8n work.

## Mandatory Rule

Read [n8n-agent-rules.md](n8n-agent-rules.md) before planning or editing n8n material. Those rules are the full operating contract for n8n workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, workflow creation, workflow updates, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, and n8n safety.

## Adapter Auto-Check Protocol

When this skill is selected for an n8n task, automatically check whether the current target repo already has the managed adapter block in active instruction files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

If an active instruction file exists and the adapter is missing, run [scripts/install-n8n-agent-adapter.cjs](scripts/install-n8n-agent-adapter.cjs) in `--dry-run` mode for the relevant target. Show the dry-run result to the user. Ask for explicit current-turn approval before running `--write`. If approved, run the installer with `--write`.

Do not silently auto-install adapters. If declined, continue the current n8n task using the already-loaded `n8n-agent-rules`, but tell the user that future sessions/tools may not auto-load the rules unless the skill or adapter is installed.

`--target auto` is discovery only. It previews or patches only existing active instruction files; it must not choose a new adapter target for the user.

If no active instruction file exists, stop and ask the adapter-target question before continuing the n8n task, unless the user already answered that target question in the current turn. Ask this even during read-only or no-modify tasks. Read-only/no-modify blocks file writes and `--write`; it does not block the adapter-target question.

- `AGENTS.md` for Codex/OpenCode
- `CLAUDE.md` for Claude Code
- `GEMINI.md` for Antigravity
- `all`
- `none`

When asking the adapter-target question, present all five options neutrally. Do not suggest or default to `none` merely because the current task is read-only or no-modify.

The answer `none` is allowed and must be respected.

## Boundaries

- This skill owns the full n8n operating ruleset.
- `n8n-local-setup` owns local n8n setup, Docker setup, tunnels, MCP config, and platform setup notes.
- `n8n-workflow-helper-scripts` owns helper scripts, sanitising, validation, import/export helpers, comparison, prepare-import, and repo/live workflow hygiene.
- `n8n-workflow-templates` owns generic inactive reusable workflow templates.

## Safety

- Prefer n8n documentation/build/validation tools before live-instance tools.
- Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, archive/delete, credential, source-watch, deployment, or production actions without explicit current-turn approval naming the target and allowed operation.
- Keep workflows inactive or unpublished by default unless the user explicitly asks otherwise.
- Never put secrets, credentials, tokens, webhook secrets, private keys, `.env` values, credential bindings, or live import/export payloads into repo files.

## Optional Adapters

The files under [adapters/](adapters/) are brief optional snippets for existing active instruction files. They point agents to this skill without copying the full rules into global always-on context.

The installer script under [scripts/install-n8n-agent-adapter.cjs](scripts/install-n8n-agent-adapter.cjs) supports `--dry-run` and `--write`. Do not run it with `--write` unless the user explicitly approves patching the named active instruction file in the current turn.
