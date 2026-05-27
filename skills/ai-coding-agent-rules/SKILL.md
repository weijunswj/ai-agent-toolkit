---
name: ai-coding-agent-rules
description: Use when starting repository or project-folder coding work and local instruction files may be missing, stale, unchecked, or lacking AI-AGENT-TOOLKIT managed marker blocks.
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

Tiny automatic repo-instruction bootstrap/checker for local project instruction files.

Use this skill automatically before repository editing work when any of these are true:

- The repo has no `AGENTS.md`.
- The repo has no `CLAUDE.md`.
- The repo has no `GEMINI.md`.
- The repo has no `.agents/rules/00-agent-toolkit-bootstrap.md`.
- Existing instruction files lack `AI-AGENT-TOOLKIT` managed marker blocks.
- Existing managed marker blocks are stale or out of order.
- The session appears to be the first agent session after toolkit skills were installed.

## Cheap Check First

1. Locate the project folder or repo root. This works for GitHub, GitLab, Bitbucket, local Git repos, and plain folders.
2. Inspect `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.
3. Check for current toolkit managed marker blocks and the expected order.
4. If all required files and markers are current, do not rewrite anything; continue the original user task.
5. If files are missing or stale, create/update only toolkit-managed blocks and shims from the referenced templates.
6. Preserve unmarked user-authored content. Do not delete duplicate/conflicting unmarked content automatically; report it.
7. After creating/updating instruction files, stop and end with:

**SESSION RESET NEEDED: I loaded/updated agent instructions for this repo, so please start a new agent session before continuing the implementation task.**

## Boundaries

This automatic bootstrap is for local repo/folder instruction files only. It must not push, create or update a PR, touch live n8n, Docker, credentials, `.env`, `.tmp`, `.n8n-local`, deployments, product repos, workflow JSON, imports, exports, or runtime actions.

Do not install heavy global `AGENTS.md` or global `GEMINI.md` rules. After setup, the repo-local files are the source of truth.

Use referenced files for full content: `AGENTS.template.md`, `CLAUDE.template.md`, `GEMINI.template.md`, and `antigravity-bootstrap.template.md`.
