---
name: ai-coding-agent-rules
description: Install or explain generic AI coding agent execution rules and toolkit skill-routing templates for Codex/OpenCode AGENTS.md, Claude Code CLAUDE.md, and Gemini CLI or Antigravity GEMINI.md files. Use when a user wants reusable baseline coding-agent rules, inert instruction templates, or a safe merge plan for existing agent instruction files.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/SKILL.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules

Use this skill when the user wants generic execution-first AI coding agent rules for a repo, user profile, or agent platform.

## Core Rules

- Use the inert templates in [templates/agent-rules/](templates/agent-rules/) as copy or merge sources.
- Copy or merge `AGENTS.template.md` into `AGENTS.md` for Codex or OpenCode.
- Copy or merge `CLAUDE.template.md` into `CLAUDE.md` for Claude Code.
- Copy or merge `GEMINI.template.md` into `GEMINI.md` for Gemini CLI or Antigravity.
- Never overwrite an existing active instruction file. Read it first and produce a merge or diff plan.
- Keep the `.template.md` files inert inside the skill folder. Do not rename them inside `skills/**`.

## Workflow

1. Identify the target agent platform and target active instruction filename.
2. Read the matching inert template when exact copy-ready content matters.
3. If the target active file already exists, compare the current file with the template and propose a minimal merge.
4. Keep domain add-ons separate. For n8n workflow and MCP safety rules, use the `n8n-local-setup` add-on template after the generic baseline.
