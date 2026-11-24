---
name: n8n-safety-router
description: Use when working on any n8n task, including [official n8n Skills](https://github.com/n8n-io/skills), using-n8n-skills, n8n workflow JSON, official n8n MCP, n8n_live, workflow creation, workflow updates, helper scripts, import/export, validation, credentials, webhook IDs, workflow activation, execution, repo/live sync, and n8n safety. Always apply before n8n workflow or live n8n work.
---

<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/n8n-safety-router/SKILL.md
-->

# n8n Safety Router

Use this skill before any n8n workflow, helper-script, MCP, or live n8n work.

## Mandatory Rule

Read [n8n-safety-rules.md](n8n-safety-rules.md) before planning or editing n8n material. Those rules are the full operating contract for [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill currently named `using-n8n-skills`, n8n workflow JSON, official n8n MCP, `n8n_live`, workflow creation, workflow updates, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, and n8n safety.

## Repository Copies

The n8n Safety Router rules reach every session through the global rules that setup installs, so a repository needs no n8n block; an older `N8N-AGENT-RULES-ADAPTER` block in a repository's `AGENTS.md` is a leftover.

## Boundaries

- This skill owns the full n8n operating ruleset.
- `n8n-environment-setup` owns installation, environment setup, hosting, tunnels, [official n8n Skills](https://github.com/n8n-io/skills) install notes, and platform setup notes.
- `n8n-workflow-transport` owns offline sanitisation, validation, comparison, manual import/export preparation, and safe workflow-file transport preparation.
- Workflow JSON examples under `repo/tests/fixtures/n8n-workflows/` are test-only evidence, not selectable products or templates for installation.

## Safety

- Use [official n8n Skills](https://github.com/n8n-io/skills) first, then use the official n8n MCP tools that are actually available in the connected instance. Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
- Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, archive/delete, credential, source-watch, deployment, or production actions without explicit current-turn approval naming the target and allowed operation.
- Keep workflows inactive or unpublished by default unless the user explicitly asks otherwise.
- Never put secrets, credentials, tokens, webhook secrets, private keys, `.env` values, credential bindings, or live import/export payloads into repo files.
