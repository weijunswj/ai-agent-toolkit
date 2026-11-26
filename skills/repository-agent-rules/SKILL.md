---
name: repository-agent-rules
description: Install, check, repair or refresh a repository's Toolkit files, such as the CI checks a governed repository carries and the one-line CLAUDE.md shim, and report Toolkit instruction copies an older setup left. Do not route for ordinary coding when repository files are already current. Use once for an unchecked target, then stop unless their state may have changed.
---

<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/repository-agent-rules/SKILL.md
-->

# Repository Agent Rules

Installs and maintains a repository's Toolkit files: the CI checks a governed repository carries and the one-line `CLAUDE.md` shim. The governed rules and the playbooks are never copied into a repository.

## Two layers

- **Global rules** live in each harness's user-level file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, optionally `~/.gemini/GEMINI.md`). `setup toolkit` installs and refreshes them; this skill never writes them.
- **Toolkit-governed rules** come from the installed Toolkit: in a repository whose merged programme file is ENABLED, every session start carries them, and the playbooks ship as the `toolkit-playbooks` skill. A repository needs no copy, so this skill never adds the governed block, the Antigravity bootstrap or playbook files. Turning governance on is the governance question bank's job (`toolkit governance`): its one setup pull request carries the programme file and the CI checks only.
- Write a repository's own instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules/`) only when its governance state is ENABLED (`toolkit-governance.cjs status`), and then only the `CLAUDE.md` shim and the retired `GEMINI.md` removal below. An accepted pending yes also permits preparing exactly the CI check files for its adoption pull request. Preparation never activates governance, programme records or standing task auto-merge. In other states, report what would change and write nothing. The repository's own rules stay authoritative for everything that is its own.
- **Leftovers:** a `TOOLKIT-GOVERNED-RULES` block (or an older `GLOBAL-AGENTS.MD-TEMPLATE` block) or an `N8N-AGENT-RULES-ADAPTER` block of any version (the global rules carry the n8n rules) in `AGENTS.md`, `.agents/rules/00-agent-toolkit-bootstrap.md` and Toolkit copies under `docs/agent-playbooks/` were written by older setups. Report them as leftovers: never refresh, repair or add one. The installed Toolkit's rules win over an older copy. To remove them where governance is on, the owner answers Clean up in `refresh governance`, or run `node <toolkit>/repo/scripts/toolkit-governance-cleanup.cjs --repo <repo>` to preview, then, with the owner's OK, `--write`, and carry the changes to one pull request as below; it deletes files, so the owner merges it and it never goes through task auto-merge.

Ask action-blocking questions as the global rules' Communication section says.

## Cheap state check

Works for any git host, local git repositories and plain folders.

1. Use the open target or the explicit target path; if neither exists, stop and ask for a target path.
2. Expected files: where governance is ENABLED, the plain-text check (`.github/plain-text.json`). A `CLAUDE.md` that loads `AGENTS.md` is expected only when Claude Code would otherwise miss it: the repository has its own `AGENTS.md` and its own `CLAUDE.md` (or `.claude/CLAUDE.md` or `CLAUDE.local.md`), and Claude Code's "Read AGENTS.md as well as CLAUDE.md" setting is off. Claude Code reads `AGENTS.md` itself when the repository has no `CLAUDE.md`, and reads both while that setting is on (setup turns it on). Codex and Antigravity read `AGENTS.md` themselves, so they need no shim and there is no `GEMINI.md` shim.
3. `CLAUDE.md` is current when it has the line `@AGENTS.md` on its own and no old Toolkit `CLAUDE.SHIM` block. Note any leftovers (above).
4. If every expected file is current and the user did not ask to install, check, repair, refresh or bootstrap, stop here without reading templates or rewriting anything, and continue the original task.

Native Toolkit startup hooks run a passive preflight: they compare only the managed blocks a repository still carries with the bundled templates (and `CLAUDE.md` by its `@AGENTS.md` line) and, where governance is ENABLED, the vendored Toolkit checks under `.github/scripts/` with the running Toolkit's sources, never write, back up or read unrelated content, stay silent outside Toolkit-managed git roots, and print at most one neutral note per finding. The note never pauses the current task; run this skill only when the user asks, except where governance is ENABLED, where the controller acts on the note's next step the same turn it sees the note, in a pull request when files change (a note naming a newer Toolkit means refreshing Toolkit first, never rewriting the checks from the running copy; a leftover still waits for the owner's governance answer).

## Markers

Every Toolkit insert uses versioned, hashed markers:

`<!-- AI-AGENT-TOOLKIT:<source>:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `<!-- AI-AGENT-TOOLKIT:<source>:END <NAME> -->`

`sha256` covers the block body, so a hand edit inside the block is detectable. Content inside the markers is Toolkit-owned; everything outside is the user's and keeps its exact bytes. The generic content of the older v1 blocks now comes from the global rules, and the governed rules from the installed Toolkit.

## Install, check, repair or refresh

For an explicit request, compare the Toolkit files with the current templates instead of stopping at the cheap check:

- `repo-local/CLAUDE.shim.template.md` -> `CLAUDE.md` (Claude Code only, where step 2 of the cheap check expects it, or the user asks for it). The shim has no markers: `CLAUDE.md` is exactly the line `@AGENTS.md`. When `CLAUDE.md` already exists, keep its other text and make sure it has that line on its own; replace an old Toolkit `CLAUDE.SHIM` block with the line.
- `repo-local/toolkit-programme.template.json` -> `.github/toolkit-programme.json`, only for a merged enabled repository or its accepted pending yes adoption proposal. Fill in the repository, parent issue, record prefixes and the separate private evidence store from the user's answers, with one entry in `parents` only (a second parent waits for the reconciler's cross-programme rule); the binding lands through a pull request, never a push to the default branch.

Rules:

- A missing `CLAUDE.md` is created from its template only when the user asks for one (Claude Code reads `AGENTS.md` itself where there is none); an existing one keeps all its content.
- Broken, duplicate, unmatched, nested or out-of-order markers in a file this skill writes are repaired before any unrelated edit. If unmarked content cannot be separated safely, write a clean file and report the backup.
- Never delete duplicate, conflicting or obsolete unmarked content automatically; keep it, or keep it in the backup, and report it. Never create shims for platforms out of scope.
- A refresh removes the retired `GEMINI.md` shim: back it up, then remove a `GEMINI.md` that holds only the old Toolkit `GEMINI.SHIM` block, or remove just that block when the file has other text. Never touch a `GEMINI.md` without that block.
- Before modifying, record the target path, git presence, branch, HEAD and dirty state where available, existing files, and whether they were already dirty or hand-edited. In a plain folder, treat existing instruction files as the user's unless complete markers say otherwise.

### Backups and ignore files

Use the Toolkit repo-local backup contract (`repo/scripts/repo-local-backup.cjs` or the installed Toolkit copy): one operation generation under `_agent-toolkit-backups/` with every affected file, including originally missing ones, recorded in `restore.json` with operation identity, exact original bytes, line-ending and final-newline state, checksums, expected replacement checksums and `full-file` or `managed-region` scope. No flat backup names or other restore formats. Apply the repair transactionally; on partial failure, restore every path through the supported restore route (which validates schema, repository identity, relative paths, expected state and checksums, and rejects traversal, outside paths, unknown schemas and drift), and keep the backup.

Before proposing an ignore-file change, inspect `.gitignore` and Git's resolved `.git/info/exclude` and the canonical and legacy backup folders; show the exact target and missing narrow rules, explain tracked versus local-only effects, and get approval for that exact preview (tracked `.gitignore`, local-only exclude, decline, or proceed with a hygiene warning). A repair request is not approval to change an ignore file. Passive hooks, checks and previews never write ignore files or create backups.

New backups always use `_agent-toolkit-backups/`. Recognise legacy `.agent-toolkit-backups/` and report it, never select it for new backups, and never move, merge, rename, rewrite or delete any backup content or add a broad backup ignore pattern. Backups are local repair artifacts: report the inspection and restore commands, but never commit, stage, delete or move them unless the user asks.

### Personal-data guard

In a repository whose Toolkit GitHub governance is ENABLED (or being enabled), its check and sweep workflows, script and settings are a default cloud workflow (below), with no hooks. In other repositories, or for the local hooks, offer it once on an install and never install it without the owner's yes. On yes, run `node <toolkit>/skills/secure-ci-cd/scripts/install-personal-data-guard.cjs --repo <repo> --workflow` and report its output, including the hooks folder it used. On a refresh where the user chose that install (this clone has the guard's hooks), run it with `--check` and, when it reports drift, rerun the install (it keeps the config and any existing hooks); never run it only because `.github/personal-data-guard.json` exists, since a governed repository carries that without hooks. Details: the `toolkit-playbooks` skill's `privacy-safe-checks.md`.

### Plain-text check

A Toolkit source checkout (one with `repo/scripts/check-plain-references.cjs`) runs the plain-text check from source, so never run the plain-text installer there.

In a repository whose Toolkit GitHub governance is ENABLED, install the plain-text check on any install or refresh where `.github/plain-text.json` is missing: the user's yes to governance covers it. In other repositories it is optional: offer it in the same question as the personal-data guard and install it only on a yes (it writes CI files, not instruction files). Run `node <toolkit>/skills/secure-ci-cd/scripts/install-plain-text-check.cjs --repo <repo> --workflow` and report its output: it writes `.github/plain-text.json` (issue and pull request reference rules on, no banned terms), a starting baseline of what is already there, the check copy under `.github/scripts/` and the CI workflow. Ask whether the repository has its own shorthand codes to add as banned terms; add only ones the user names, each with a reason and the plain wording to use. On a refresh where `.github/plain-text.json` exists, run it with `--check` and, on drift, rerun the install (it keeps the settings and baseline). Report any `NOTE:` line from `--check` or the install to the user. A governed repository switches it off only with a reason the user gives, recorded as `off_reason` in its settings.

In a repository whose Toolkit GitHub governance is ENABLED (or being enabled), add the default cloud workflows on any install or refresh; the user's yes to governance covers it. Run `node <toolkit>/repo/scripts/toolkit-cloud-workflows.cjs --repo <repo>` from the Toolkit checkout, adding `--ci-workflow <file>` to name the repository's main CI workflow on first install, and report its output. It writes `.github/workflows/toolkit-programme-sweep.yml` and `toolkit-programme-sweep-gate.yml`, copies of the Toolkit's own files that run Toolkit main (or the commit the repository's `TOOLKIT_REF` variable pins), the personal-data guard's check and sweep workflows, script and settings, `.github/workflows/dependency-auto-merge.yml`, plus the test shards workflow and `toolkit-shard-timings.yml` only where `.github/toolkit-test-shards.json` is a usable shard list; a refresh rewrites a stale copy and keeps the CI workflow it follows. When a session start or the cloud sweep (`CLOUD_LAYOUT_STALE`) says the copies are stale, run it with `--refresh-pr` instead: it opens or updates one pull request for the owner to merge and writes nothing locally. It refuses a Toolkit source checkout and a same-named file in the sweep's or a shard copy's place, leaves out the guard or dependency auto-merge (with a note) where someone else's file is in its place, and leaves out the sweep and shard copies on a default branch other than `main`. The sweep does nothing until the repository has the governance App's variable and secret.

## After a refresh

**Inside an unfinished, already-authorised task or gate** (the refresh is part of that work or its standing authority): read the changed instruction files now and continue the task in this session without asking whether to restart. Show this notice once, in bold, only after the refresh actually succeeded:

**Toolkit instructions refreshed. Continuing in this session. Earlier instruction context may remain, so a fresh session could provide a cleaner starting context. No action is required.**

Reading files does not reload native hooks, tools or permissions; when one of those genuinely changed, reload it only through its supported mechanism and verify, or report the exact reload still required. When committing is authorised, validate the refresh-owned files (run the sync check where it exists), commit only those files to the authorised non-main branch, push, and read back the remote ref. Never make an empty commit, stage unrelated or dirty files, include secrets, or regenerate instructions from a stale installed template.

**Carry the refresh to a pull request.** When the refresh wrote files in a Git repository that has a GitHub remote, and no in-flight task already carries those files on its own authorised branch, do not leave them uncommitted:

Turning governance on is not done here: the governance question bank (`toolkit governance`) puts the programme file and the CI checks into its one setup pull request itself, and a yes is never published with `toolkit-governance.cjs publish --run`. Do not open a separate instruction pull request for it. After merge, compare prepared untracked files with the merged copies, preserve local differences and clear only verified duplicates with permission before pulling.

1. Create a new non-main branch from the current base. Stage only the files this refresh wrote (the shims it created, repaired or removed, and any personal-data guard, plain-text check or cloud sweep files it installed); never stage dirty, unrelated or backup files.
2. Run the sync check where it exists, commit, push the branch, and open a pull request that lists the refreshed files.
3. Watch every check on the pull request's exact head, then stop at the open pull request: report its link, head and check results for the owner to merge. This skill never merges.

When the repository has no GitHub remote, leave the refreshed files uncommitted and report them. Never use an admin bypass, force-push, rewrite history, or touch files this refresh did not write.

**For a standalone install, repair, refresh, or bootstrap request with no task in flight**, after the pull request outcome above (stopped at the open pull request, or no GitHub remote), stop and end with this exact format:

**SESSION RESET RECOMMENDED:**

**I created/updated repo-local agent instructions. Start a new agent session in this folder so the agent loads `AGENTS.md` as startup instructions before continuing implementation.**

**If I repaired or backed up an instruction file, the exact previous state and restore metadata were saved under `_agent-toolkit-backups/` in this project folder. Legacy `.agent-toolkit-backups/` content, if present, was not changed.**

**Should I continue in this same session best-effort after reading the updated instructions, or will you start a new agent session?**

Keep the reset message bolded exactly as shown. Ask its last line with the harness's native question method (continue here best-effort, or start a new session) and leave that line out of the message; where none works, keep it. Do not continue implementation work until the user answers. If the user chooses to continue in the same session, read the updated instruction files first, say that same-session continuation is best-effort and not equivalent to a fresh startup load, then continue only if the task remains safe and clearly scoped.

## Boundaries

This skill touches only the `CLAUDE.md` and retired `GEMINI.md` shims and their backups, plus, on the owner's opt-in or in governed repositories, the personal-data guard files (`.github/scripts/personal-data-guard.cjs`, `.github/personal-data-guard.json`, `.github/workflows/personal-data-guard.yml`, `.github/workflows/personal-data-sweep.yml`), on the owner's opt-in the local git hooks the guard installer writes, the plain-text check files (`.github/scripts/plain-text-check.cjs`, `.github/plain-text.json`, `.github/plain-text-baseline.json`, `.github/workflows/plain-text.yml`), and in governed repositories the other default cloud workflows (`.github/workflows/toolkit-programme-sweep.yml`, `.github/workflows/toolkit-programme-sweep-gate.yml`, `.github/workflows/dependency-auto-merge.yml` and the shard copies). Apart from the refresh and accepted governance decision pull requests above, it must not push, open or update a PR, or touch live n8n, Docker, credentials, `.env`, `.tmp`, `.n8n-local`, deployments, product code, workflow JSON, imports, exports or runtime actions. The installed Toolkit is the source of the governed rules; the repository's own files are the source of its own rules.
