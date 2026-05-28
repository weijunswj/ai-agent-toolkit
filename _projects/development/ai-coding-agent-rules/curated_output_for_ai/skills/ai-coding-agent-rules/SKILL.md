---
name: ai-coding-agent-rules
description: Bootstrap or repair repo-local AI coding agent instruction files. Use once before repository/project-folder edits for any unchecked target folder, including fresh folders or existing repos, when required repo-local instruction files may be missing, custom/unmanaged, stale, or lack structurally current AI-AGENT-TOOLKIT managed marker pairs; also use when the user asks to install, check, repair, refresh, or bootstrap repo-local agent rules. Do not use again after required files are checked and structurally current unless instruction-file state may have changed.
---

<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules

Tiny repo-instruction bootstrap/checker for local project instruction files.

This skill is not an always-on ruleset. Keep the steady-state path cheap. Use it to bootstrap or repair repo-local instructions only when they are missing, unchecked, suspected stale, structurally broken, changed since the last check, or explicitly requested.

All questions that require user action or confirmation must be fully bolded. This includes target-path questions, approval questions, and same-session continuation questions.

## Cheap State Check

This works for GitHub, GitLab, Bitbucket, local git repos, and plain folders. Git metadata is helpful but never required.

1. Locate the selected/open target repo or project folder, or use the explicit target path. If neither exists, stop and ask for a target path.
2. Identify the current or requested platform. Only these platform scopes exist for this skill:
   - Codex or unspecified: `AGENTS.md`.
   - Claude Code: `AGENTS.md` and `CLAUDE.md`.
   - Antigravity: `AGENTS.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.
3. Check only the required files for the selected platform.
4. For each required file, check existence and `AI-AGENT-TOOLKIT` managed-marker structure.
5. If every required file is structurally current enough and the user did not explicitly ask to install, check, repair, refresh, or bootstrap repo-local instructions, do not read templates, do not inspect or compare managed body content beyond marker structure, do not rewrite files, and continue the original user task.

A required file is structurally current enough only when:

- The file exists.
- The file contains at least one complete `AI-AGENT-TOOLKIT` managed marker pair.
- Every `AI-AGENT-TOOLKIT` managed marker is part of a complete, balanced pair.
- No `BEGIN` or `END` marker is missing, duplicated, unmatched, nested incorrectly, or out of order.

A managed marker pair is valid only when:

- A `BEGIN` marker has exactly one matching `END` marker.
- The matching `END` marker uses the same `AI-AGENT-TOOLKIT` source identity and block label.
- `BEGIN` appears before `END`.

Do not treat bare `AI-AGENT-TOOLKIT` text, a missing managed block, or balanced zero-block state as current. This cheap path is a structural managed-marker check, not a full template diff.

For ordinary follow-up coding tasks, stop after the cheap structural managed-marker check when all required files are structurally current.

For explicit install, check, repair, refresh, or bootstrap requests, do not stop at the cheap structural check. Read the current repo-local templates and compare toolkit-owned managed block content against the current template content. If managed block content differs from the current template, treat it as edited or stale toolkit-owned content, back up the affected file under `.agent-toolkit-backups/`, replace the managed block from the current template, preserve unmarked user-authored content outside managed markers, then stop with the session reset prompt.

## Install Or Repair

Use repo-local templates only when install or repair is needed:

- `repo-local/AGENTS.managed.template.md` -> target repo `AGENTS.md`.
- `repo-local/CLAUDE.shim.template.md` -> target repo `CLAUDE.md` only for Claude Code.
- `repo-local/GEMINI.shim.template.md` -> target repo `GEMINI.md` only for Antigravity.
- `repo-local/antigravity-bootstrap.template.md` -> target repo `.agents/rules/00-agent-toolkit-bootstrap.md` only for Antigravity.

Before modifying repo-local instruction files, record enough state to preserve user work: target path, whether git metadata exists, branch/HEAD and dirty state when available, existing required files, and whether affected instruction files were already dirty or manually edited. For plain folders without git metadata, treat existing instruction files as user-authored unless complete managed markers identify toolkit-owned content.

The installed template content for every required repo-local instruction file must include complete `AI-AGENT-TOOLKIT` managed marker pairs so future sessions can verify structural currency without reading templates.

### Missing Or Unmanaged Files

When a required target file is missing, create it from the matching repo-local template.

When a target file exists but has no valid managed block, keep all existing file content and insert the required managed template content at the top of the file before unmarked user-authored content. Do not append the managed block below custom rules unless the user explicitly asks for that layout.

### Broken Or Edited Managed Blocks

Content inside `AI-AGENT-TOOLKIT` managed marker pairs is toolkit-owned. During repair, back up the file, replace edited or stale managed blocks from the current template, and preserve unmarked user-authored content outside the markers.

When a target file has broken, duplicate, unmatched, nested, or out-of-order managed markers, automatically repair the affected repo-local instruction file instead of continuing unrelated repository edits.

Before repairing, create a backup copy of the existing file under `.agent-toolkit-backups/` in the same target repo or project folder. Use this naming pattern:

- `.agent-toolkit-backups/AGENTS.dirty_backup_<YYYYMMDD-HHMMSS>.md` for `AGENTS.md`.
- `.agent-toolkit-backups/CLAUDE.dirty_backup_<YYYYMMDD-HHMMSS>.md` for `CLAUDE.md`.
- `.agent-toolkit-backups/GEMINI.dirty_backup_<YYYYMMDD-HHMMSS>.md` for `GEMINI.md`.
- `.agent-toolkit-backups/00-agent-toolkit-bootstrap.dirty_backup_<YYYYMMDD-HHMMSS>.md` for `.agents/rules/00-agent-toolkit-bootstrap.md`.

Backup files are local repair artifacts. Report their paths clearly, but do not commit, stage, delete, or move backup files unless the user explicitly asks.

After backing up, repair the required instruction file using the current repo-local template content. If unmarked user-authored content can be safely separated from the broken managed block, preserve it below the repaired managed block. If it cannot be safely separated, keep the repaired instruction file clean and tell the user the previous file was backed up.

If a managed block appears manually edited, treat it as toolkit-owned content that needs repair during explicit install, check, repair, refresh, or bootstrap requests. Back up the existing file, replace the managed block with the current repo-local template content, preserve safe unmarked content below it, and report the backup path.

Do not delete duplicate, conflicting, or obsolete unmarked content automatically; preserve it when safe or keep it in the dirty backup and report it.

Do not create shims for platforms that are not in scope.

If this skill creates, modifies, repairs, or backs up `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`, stop immediately and end with this exact format:

**SESSION RESET RECOMMENDED:**

**I created/updated repo-local agent instructions. Start a new agent session in this folder so the agent loads `AGENTS.md` as startup instructions before continuing implementation.**

**If I repaired or backed up an instruction file, the previous version was saved under `.agent-toolkit-backups/` in this project folder.**

**Should I continue in this same session best-effort after reading the updated instructions, or will you start a new agent session?**

Keep the full reset message and question bolded exactly as shown. Do not continue implementation work until the user answers.

If the user explicitly chooses to continue in the same session, read the updated repo-local instruction files first, state that same-session continuation is best-effort and not equivalent to a fresh startup instruction load, then continue only if the task remains safe and clearly scoped.

## Boundaries

This bootstrap is for local repo/folder instruction files only. It must not push, create or update a PR, touch live n8n, Docker, credentials, `.env`, `.tmp`, `.n8n-local`, deployments, product repos, workflow JSON, imports, exports, or runtime actions.

Do not install heavy global `AGENTS.md` or global `GEMINI.md` rules. After setup, repo-local files are the source of truth.

Manual global setup templates live in `_projects/development/ai-coding-agent-rules/_main/`; do not treat those source docs as the published skill runtime path.
