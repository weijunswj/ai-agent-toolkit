---
name: ai-coding-agent-rules
description: Use when starting repository or project-folder coding work and the canonical AGENTS.md or current-platform instruction shim may be missing, stale, unchecked, or lacking AI-AGENT-TOOLKIT:<source-path> managed marker blocks.
---

<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules

Tiny automatic repo-instruction bootstrap/checker for local project instruction files.

Repo-local installs require a selected/open target repo or an explicit target path. Standalone chats with no workspace cannot safely infer where to install `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`.

The `repo-local/*.template.md` files are bare copy-ready destination payloads with an exact curated-source safety comment at the top. Install instructions live in this skill and its README, not inside the files copied into target repos.

Use this skill automatically before repository editing work when any of these are true:

- The repo has no `AGENTS.md`.
- The current or target platform shim is missing and that platform needs one.
- Existing active instruction files lack `AI-AGENT-TOOLKIT:<source-path>` managed marker blocks.
- Existing managed marker blocks in active instruction files are stale or out of order.
- The session appears to be the first agent session after toolkit skills were installed.

## Cheap Check First

1. Locate the selected/open target repo or use the explicit target path. If neither exists, stop and ask for a target path.
2. Identify the current or user-requested target platform.
3. Check or install `AGENTS.md` as the canonical managed file.
4. Inspect only the active shim file needed for the current/target platform: `CLAUDE.md` for Claude Code, `GEMINI.md` and `.agents/rules/00-agent-toolkit-bootstrap.md` for Antigravity.
5. If all required files and markers for the current/target platform are current, do not rewrite anything; continue the original user task.
6. If `AGENTS.md` is missing or stale, copy or merge `repo-local/AGENTS.managed.template.md` into target repo `AGENTS.md`.
7. Add only the shim for the current/target platform unless the user explicitly requests all platform shims.
8. Preserve existing active instruction files. Preserve unmarked user-authored content, do not delete duplicate/conflicting unmarked content automatically, and report it.
9. After creating/updating managed instruction files, stop and end with:

**SESSION RESET NEEDED: I loaded/updated agent instructions for this repo, so please start a new agent session before continuing the implementation task.**

## Boundaries

This automatic bootstrap is for local repo/folder instruction files only. It must not push, create or update a PR, touch live n8n, Docker, credentials, `.env`, `.tmp`, `.n8n-local`, deployments, product repos, workflow JSON, imports, exports, or runtime actions.

Do not install heavy global `AGENTS.md` or global `GEMINI.md` rules. After setup, the repo-local files are the source of truth.

Use referenced files for full repo-local content:

- Copy or merge `repo-local/AGENTS.managed.template.md` into target repo `AGENTS.md`.
- Copy `repo-local/CLAUDE.shim.template.md` to target repo `CLAUDE.md` only when Claude Code support is requested or the target platform is Claude Code.
- Copy `repo-local/GEMINI.shim.template.md` to target repo `GEMINI.md` for Antigravity.
- Copy `repo-local/antigravity-bootstrap.template.md` to target repo `.agents/rules/00-agent-toolkit-bootstrap.md` for Antigravity.

Do not create missing shims for platforms that are not in scope. A Claude Code setup needs root `AGENTS.md` plus `CLAUDE.md`; an Antigravity setup needs root `AGENTS.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.

Manual global setup templates live in `_projects/development/ai-coding-agent-rules/_main/`; do not treat those source docs as the published skill runtime path.

For Antigravity, install toolkit skills in the observed plugin-scoped custom skill folder:
`C:\Users\<user>\.gemini\config\plugins\ai-agent-toolkit\skills\<skill-name>\SKILL.md`.
Keep that skill-loading path distinct from repo-local bootstrap outputs, which still go into the target repo as `AGENTS.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.
Use a minimal `plugin.json` beside `skills/` only when the installed Antigravity runtime or docs require plugin metadata.
