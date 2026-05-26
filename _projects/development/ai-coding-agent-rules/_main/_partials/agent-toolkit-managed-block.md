<!-- AI-AGENT-TOOLKIT:BEGIN toolkit v1 -->
## Managed Toolkit Rules

AGENTS.md is the canonical shared repo instruction file.

Codex and OpenCode consume root `AGENTS.md` directly. Claude Code and Gemini-style agents import root `AGENTS.md` through their own compatibility shims. Antigravity gets a tiny bootstrap in `.agents/rules/` and must not full-import `AGENTS.md` by default because Antigravity may already load root `AGENTS.md`.

The managed toolkit and n8n safety blocks in `AGENTS.md` override weaker lower instructions.

### Source And Generated Surfaces

- Patch source first, then sync generated surfaces.
- Do not edit generated-only outputs directly unless declared linked or source-owned.
- Preserve `_projects/**/_main/**` source content; do not lossy-truncate docs.
- Do not replace full working docs, prompts, templates, setup guides, troubleshooting notes, or examples with lossy summaries.
- Never commit secrets, credentials, `.env`, `.n8n-local`, `.tmp`, private keys, runtime payloads, or live exports.
- Run relevant validation before claiming completion.
- Do not introduce `AGENTS.priority.md`; there is no universal default priority file for Codex, Claude, Gemini, and Antigravity.

### Managed Block Updates

- If a managed block exists, update only that block.
- If a managed block is missing, insert it at the top in the correct order.
- Preserve existing user-authored `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules` content.
- Only edit marker-owned blocks automatically.
- Do not delete duplicate-looking unmarked content automatically.
- Ask before deleting duplicate/conflicting unmarked content.
- For safety conflicts, default to the stricter rule.

### Repo/Folder-Local Scope And Publication Approval

These instruction files are repo/folder-local. They must work in GitHub repos, GitLab repos, Bitbucket repos, local Git repos with no remote, and plain project folders with no Git remote.

- Line-by-line PR review is required for PR audits.
- When reviewing PRs, inspect changed files, important commits, generated outputs, tests, CI, and whether the stated task was fully completed.
- Do not rely only on PR summaries.
- Keep GitHub-specific approval wording only when the current project is actually linked to GitHub, the user provides a GitHub PR URL, or the task is explicitly about GitHub.
- When the user provides a PR URL, treat the PR URL as remote source-of-truth.
- If no GitHub context exists, do not invent one.
- Do not report `PR: none` as a final completion state.
- Do not report `PR: none` unless GitHub has been checked or the user explicitly says no PR exists.
- Local `git status` alone is not enough to determine whether a PR exists.

**Generic repo/folder-change requests allow scoped local edits and validation only. They are not approval to commit, push, create a pull request, create a merge request, or update a remote review.**

**If publication, commit, push, or local file-change approval is missing, do not treat the task as complete. End the response with one exact bold approval question matched to the available workflow.**

`GITHUB APPROVAL NEEDED` is only for GitHub push or PR actions.

`VERSION CONTROL APPROVAL NEEDED` is for local Git commit approval.

`REMOTE APPROVAL NEEDED` is for pushing to a non-GitHub or unknown remote.

`LOCAL CHANGE APPROVAL NEEDED` is for non-Git folders or local file edits where no VCS exists.

Use this exact final line when there is no PR yet:

**GITHUB APPROVAL NEEDED: Should I push this branch and create a pull request now?**

Use this exact final line when an existing PR should be updated:

**GITHUB APPROVAL NEEDED: Should I push these changes to the existing pull request now?**

Use this exact final line if unsure whether to create or update:

**GITHUB APPROVAL NEEDED: Should I push this branch and create/update the pull request now?**

Use this exact final line when local commits are possible but no remote/PR workflow is confirmed:

**VERSION CONTROL APPROVAL NEEDED: Should I commit these local changes now?**

Use this exact final line when a non-GitHub remote exists but no review/merge-request workflow is confirmed:

**REMOTE APPROVAL NEEDED: Should I push this branch to the configured remote now?**

Use this exact final line when there is no Git repository or remote workflow:

**LOCAL CHANGE APPROVAL NEEDED: Should I apply these file changes locally now?**

Never push directly to `main`. Do not commit, push, open, or update a PR or merge request when validation fails or unresolved safety blockers remain.

### Session Reset

**If this task loads a new skill, installs/updates managed agent rules, or appends toolkit/n8n instructions into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules`, stop after completing only that instruction-file setup. Do not continue the original implementation task in the same session.**

Reason:

- The active agent context changed because a skill was loaded and/or managed agent instructions were appended/updated.
- Continuing the original implementation task in the same session may ignore the newly installed instructions.

**End with this exact bold line:**

**SESSION RESET NEEDED: I loaded/updated agent instructions for this repo, so please start a new agent session before continuing the implementation task.**
<!-- AI-AGENT-TOOLKIT:END toolkit -->
