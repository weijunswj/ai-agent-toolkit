# How To Use

This repo is a reusable toolkit for AI-agent work. It gives humans and agents a stable place to find skills, guides, templates, packs, and registry metadata.

## Use Skills Manually

1. Open the skill folder under `skills/`.
2. Read `README.md` for human setup notes.
3. Load `SKILL.md` into the target AI platform.
4. Include `agents/openai.yaml` when the platform supports OpenAI skill metadata.

For Codex or Claude Code, copy the whole skill folder into that tool's supported skills folder.

## Use Templates Manually

Templates are source material. Review them before copying into a consumer repo.

- `templates/agent-rules/` contains generated `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` outputs.
- `templates/mcp-configs/` contains MCP setup examples.
- `templates/n8n/` contains n8n helper-template sources and sanitizer tooling.
- `templates/cicd/` contains CI/CD installer prompts and status templates.

## Use Packs

Packs are manifest-defined bundles under `packs/*/pack.json`. They are designed for future approval-gated installation.

Until the installer MCP exists, use packs as review checklists:

1. Open the pack README.
2. Inspect `pack.json`.
3. Review every path in `installs`.
4. Copy only the files you intentionally want.

## Codex Setup

Use:

- `guides/ai-agent-platforms/codex.md`
- `templates/agent-rules/AGENTS.md`
- `templates/mcp-configs/codex-mcp-config.md`

Keep live n8n tokens in user environment variables, not repo files.

## Claude Code Setup

Use:

- `guides/ai-agent-platforms/claude-code.md`
- `templates/agent-rules/CLAUDE.md`
- `templates/mcp-configs/claude-mcp-config.md`

Use user-scoped MCP config unless a project intentionally needs project-scoped config.

## ChatGPT Web And Claude Web

ChatGPT web and Claude web can use instruction-only skills when custom skills are available in the account or workspace. They cannot safely run local shell commands unless the platform provides a tool with that access.

Do not automate ChatGPT web or Claude web with cookies, sessions, browser automation, or session hacks.

## MCP Registry

The MCP registry is design-only in v1. Once built, use it for read-only discovery of skills, guides, templates, and packs.

If a target AI platform does not support MCP, use the JSON registries and docs manually.

## What Not To Do

- Do not paste real secrets into repo files.
- Do not copy live n8n exports into this toolkit.
- Do not install pack files without reviewing the target writes.
- Do not run live import/export helpers from this toolkit repo.
- Do not auto-merge or auto-apply upstream updates.
