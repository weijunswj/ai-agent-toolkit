---
name: ai-coding-agent-rules
description: Use when starting repository or project-folder coding work and the canonical AGENTS.md or current-platform instruction shim may be missing, stale, unchecked, or lacking AI-AGENT-TOOLKIT:<source-path> managed marker blocks.
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
- The current or target platform shim is missing and that platform needs one.
- Existing active instruction files lack `AI-AGENT-TOOLKIT:<source-path>` managed marker blocks.
- Existing managed marker blocks in active instruction files are stale or out of order.
- The session appears to be the first agent session after toolkit skills were installed.

## Cheap Check First

1. Locate the project folder or repo root. This works for GitHub, GitLab, Bitbucket, local Git repos, and plain folders.
2. Identify the current or user-requested target platform.
3. Check or install `AGENTS.md` as the canonical managed file.
4. Inspect only the active shim file needed for the current/target platform: `CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI or Antigravity, or `.agents/rules/00-agent-toolkit-bootstrap.md` when Antigravity needs that bootstrap.
5. If all required files and markers for the current/target platform are current, do not rewrite anything; continue the original user task.
6. If `AGENTS.md` is missing or stale, create/update only the toolkit-managed block from `repo-local/AGENTS.managed.template.md`.
7. Add only the shim for the current/target platform unless the user explicitly requests all platform shims.
8. Preserve existing active instruction files. Preserve unmarked user-authored content, do not delete duplicate/conflicting unmarked content automatically, and report it.
9. After creating/updating managed instruction files, stop and end with:

**SESSION RESET NEEDED: I loaded/updated agent instructions for this repo, so please start a new agent session before continuing the implementation task.**

## Boundaries

This automatic bootstrap is for local repo/folder instruction files only. It must not push, create or update a PR, touch live n8n, Docker, credentials, `.env`, `.tmp`, `.n8n-local`, deployments, product repos, workflow JSON, imports, exports, or runtime actions.

Do not install heavy global `AGENTS.md` or global `GEMINI.md` rules. After setup, the repo-local files are the source of truth.

Use referenced files for full repo-local content: `repo-local/AGENTS.managed.template.md`, `repo-local/CLAUDE.shim.template.md`, `repo-local/GEMINI.shim.template.md`, and `repo-local/antigravity-bootstrap.template.md`.

Do not create missing shims for platforms that are not in scope. A Claude Code setup needs root `AGENTS.md` plus `CLAUDE.md`; a Gemini CLI setup needs root `AGENTS.md` plus `GEMINI.md`; an Antigravity setup needs root `AGENTS.md` plus the requested Gemini shim and/or Antigravity bootstrap.

Manual global setup templates live in `_projects/development/ai-coding-agent-rules/_main/`; do not treat those source docs as the published skill runtime path.
