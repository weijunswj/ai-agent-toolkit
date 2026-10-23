---
name: repository-agent-rules
description: Install, check, repair, refresh, or bootstrap repo-local agent rules such as AGENTS.md and supported host shims. Do not route for ordinary coding when repository instructions are already current. Use once for an unchecked target, then stop unless instruction state may have changed.
---

<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/repository-agent-rules/SKILL.md
-->

# Repository Agent Rules

Installs and maintains the Toolkit-governed rules block and host shims in one repository or folder.

## Two layers

- **Global rules** live in each harness's user-level file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, optionally `~/.gemini/GEMINI.md`). `setup toolkit` installs and refreshes them; this skill never writes them.
- **Toolkit-governed rules** live in one block in the repository's `AGENTS.md`. That block is the opt-in: a repository is Toolkit-governed only when it carries it. Install it only when the user explicitly asks to put the repository under Toolkit governance. Never install or refresh rules in a repository without the block unless the user asks; repository rules outside the block stay authoritative.

All action-blocking questions to the user are fully bold.

## Cheap state check

Works for any git host, local git repositories and plain folders.

1. Use the open target or the explicit target path; if neither exists, stop and ask for a target path.
2. Required files by platform: Codex or unspecified: `AGENTS.md`. Claude Code: `AGENTS.md` and `CLAUDE.md`. Antigravity: `AGENTS.md` and `.agents/rules/00-agent-toolkit-bootstrap.md` (Antigravity reads `AGENTS.md` itself, so there is no `GEMINI.md` shim).
3. For each required file, check that it exists. `CLAUDE.md` is current when it has the line `@AGENTS.md` on its own and no old Toolkit `CLAUDE.SHIM` block. For every other file, check that its `AI-AGENT-TOOLKIT` markers are structurally valid: at least one complete pair; every BEGIN has exactly one matching END with the same source and block name, in order; nothing missing, duplicated, nested or unmatched. Bare `AI-AGENT-TOOLKIT` text or zero blocks is not current.
4. If every file is structurally current and the user did not ask to install, check, repair, refresh or bootstrap, stop here without reading templates or rewriting anything, and continue the original task.

Native Toolkit startup hooks run a passive preflight: they compare only the expected managed blocks with the bundled templates (and `CLAUDE.md` by its `@AGENTS.md` line), never write, back up or read unrelated content, stay silent outside Toolkit-managed git roots, and print at most one neutral note per finding. The note never pauses the current task; run this skill only when the user asks.

## Markers

Every Toolkit insert uses versioned, hashed markers:

`<!-- AI-AGENT-TOOLKIT:<source>:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `<!-- AI-AGENT-TOOLKIT:<source>:END <NAME> -->`

`sha256` covers the block body, so a hand edit inside the block is detectable. Content inside the markers is Toolkit-owned; everything outside is the user's and keeps its exact bytes. A refresh replaces the older `GLOBAL-AGENTS.MD-TEMPLATE` and `N8N-AGENT-RULES-ADAPTER` v1 blocks with the single `TOOLKIT-GOVERNED-RULES` block; their generic content now comes from the global rules.

## Install, check, repair or refresh

For an explicit request, compare the Toolkit-owned blocks with the current templates instead of stopping at the structural check:

- `repo-local/AGENTS.managed.template.md` -> `AGENTS.md`
- `repo-local/CLAUDE.shim.template.md` -> `CLAUDE.md` (Claude Code only). The shim has no markers: `CLAUDE.md` is exactly the line `@AGENTS.md`. When `CLAUDE.md` already exists, keep its other text and make sure it has that line on its own; replace an old Toolkit `CLAUDE.SHIM` block with the line.
- `repo-local/antigravity-bootstrap.template.md` -> `.agents/rules/00-agent-toolkit-bootstrap.md` (Antigravity only)
- `repo-local/docs/agent-playbooks/` -> `docs/agent-playbooks/`, as a whole folder (every Markdown file: `INDEX.md`, `baseline-workflow.md`, `decision-trace.md`, `docs-governance.md`, `fast-tests-and-sharding.md`, `generated-files.md`, `git-completion.md`, `invariant-models.md`, `local-docs.md`, `model-safety-flags.md`, `n8n-workflows.md`, `privacy-safe-checks.md`, `release-readiness-audit.md`, `safety-gates.md`, `windows-command-hygiene.md`). After copying, verify every playbook `INDEX.md` links exists; copy any missing one before reporting. Leave other docs alone.

Rules:

- A missing file is created from its template. A file without a valid block keeps all its content, with the block inserted at the top unless the user asks otherwise.
- A stale, edited or older-format block is backed up, then replaced from the template; unmarked content is preserved.
- Broken, duplicate, unmatched, nested or out-of-order markers are repaired before any unrelated edit. If unmarked content cannot be separated safely, write a clean file and report the backup.
- Never delete duplicate, conflicting or obsolete unmarked content automatically; keep it, or keep it in the backup, and report it. Never create shims for platforms out of scope.
- A refresh removes the retired `GEMINI.md` shim: back it up, then remove a `GEMINI.md` that holds only the old Toolkit `GEMINI.SHIM` block, or remove just that block when the file has other text. Never touch a `GEMINI.md` without that block.
- Before modifying, record the target path, git presence, branch, HEAD and dirty state where available, existing files, and whether they were already dirty or hand-edited. In a plain folder, treat existing instruction files as the user's unless complete markers say otherwise.

### Backups and ignore files

Use the Toolkit repo-local backup contract (`repo/scripts/repo-local-backup.cjs` or the installed Toolkit copy): one operation generation under `_agent-toolkit-backups/` with every affected file, including originally missing ones, recorded in `restore.json` with operation identity, exact original bytes, line-ending and final-newline state, checksums, expected replacement checksums and `full-file` or `managed-region` scope. No flat backup names or other restore formats. Apply the repair transactionally; on partial failure, restore every path through the supported restore route (which validates schema, repository identity, relative paths, expected state and checksums, and rejects traversal, outside paths, unknown schemas and drift), and keep the backup.

Before proposing an ignore-file change, inspect `.gitignore` and Git's resolved `.git/info/exclude` and the canonical and legacy backup folders; show the exact target and missing narrow rules, explain tracked versus local-only effects, and get approval for that exact preview (tracked `.gitignore`, local-only exclude, decline, or proceed with a hygiene warning). A repair request is not approval to change an ignore file. Passive hooks, checks and previews never write ignore files or create backups.

New backups always use `_agent-toolkit-backups/`. Recognise legacy `.agent-toolkit-backups/` and report it, never select it for new backups, and never move, merge, rename, rewrite or delete any backup content or add a broad backup ignore pattern. Backups are local repair artifacts: report the inspection and restore commands, but never commit, stage, delete or move them unless the user asks.

### Optional personal-data guard

On an install, offer the personal-data guard once; never install it without the owner's yes. On yes, ask whether commit author and committer addresses are scanned, then run `node <toolkit>/skills/secure-ci-cd/scripts/install-personal-data-guard.cjs --repo <repo> --identity <excluded|included> [--identity-reason <text>] --workflow` and report its output, including the hooks folder it used. On a refresh where `.github/personal-data-guard.json` exists, run it with `--check` and, when it reports drift, rerun the install (it keeps the config and any existing hooks). Details: `docs/agent-playbooks/privacy-safe-checks.md`.

## After a refresh

**Inside an unfinished, already-authorised task or gate** (the refresh is part of that work or its standing authority): read the changed instruction files now and continue the task in this session without asking whether to restart. Show this notice once, in bold, only after the refresh actually succeeded:

**Toolkit instructions refreshed. Continuing in this session. Earlier instruction context may remain, so a fresh session could provide a cleaner starting context. No action is required.**

Reading files does not reload native hooks, tools or permissions; when one of those genuinely changed, reload it only through its supported mechanism and verify, or report the exact reload still required. When committing is authorised, validate the refresh-owned files (run the sync check where it exists), commit only those files to the authorised non-main branch, push, and read back the remote ref. Never make an empty commit, stage unrelated or dirty files, include secrets, or regenerate instructions from a stale installed template.

**Carry the refresh to a pull request.** When the refresh wrote files in a Git repository that has a GitHub remote, and no in-flight task already carries those files on its own authorised branch, do not leave them uncommitted:

1. Create a new non-main branch from the current base. Stage only the files this refresh wrote (the instruction files and shims it created, repaired or refreshed, and any personal-data guard files it installed); never stage dirty, unrelated or backup files.
2. Run the sync check where it exists, commit, push the branch, and open a pull request that lists the refreshed files.
3. Watch every check on the pull request's exact head, then stop at the open pull request: report its link, head and check results for the owner to merge. This skill never merges.

When the repository has no GitHub remote, leave the refreshed files uncommitted and report them. Never use an admin bypass, force-push, rewrite history, or touch files this refresh did not write.

**For a standalone install, repair, refresh, or bootstrap request with no task in flight**, after the pull request outcome above (stopped at the open pull request, or no GitHub remote), stop and end with this exact format:

**SESSION RESET RECOMMENDED:**

**I created/updated repo-local agent instructions. Start a new agent session in this folder so the agent loads `AGENTS.md` as startup instructions before continuing implementation.**

**If I repaired or backed up an instruction file, the exact previous state and restore metadata were saved under `_agent-toolkit-backups/` in this project folder. Legacy `.agent-toolkit-backups/` content, if present, was not changed.**

**Should I continue in this same session best-effort after reading the updated instructions, or will you start a new agent session?**

Keep the full reset message and question bolded exactly as shown. Do not continue implementation work until the user answers. If the user chooses to continue in the same session, read the updated instruction files first, say that same-session continuation is best-effort and not equivalent to a fresh startup load, then continue only if the task remains safe and clearly scoped.

## Boundaries

This skill touches only repo-local instruction files, their backups and the playbook folder, plus, on the owner's opt-in, the personal-data guard files (`.github/scripts/personal-data-guard.cjs`, `.github/personal-data-guard.json`, `.github/workflows/personal-data-guard.yml`) and the local git hooks the guard installer writes. Apart from the refresh pull request above, it must not push, open or update a PR, or touch live n8n, Docker, credentials, `.env`, `.tmp`, `.n8n-local`, deployments, product code, workflow JSON, imports, exports or runtime actions. After install, the repository's own files are the source of truth for its governed rules.
