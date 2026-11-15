<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/repository-agent-rules/README.md
-->

# Repository Agent Rules

Checks and repairs a repository's Toolkit files: the CI checks a governed repository carries (plain-text check, cloud sweep, optional personal-data guard) and the one-line `CLAUDE.md` shim that loads the repository's own `AGENTS.md`. The generic rules every session needs are installed separately by `setup toolkit` into each harness's user-level file; this skill does not write them. The governed rules come from the installed Toolkit at session start and the playbooks from the [toolkit-playbooks](../toolkit-playbooks/) skill, so neither is copied into a repository. Turning governance on is the governance question bank's job (`toolkit governance`): its setup pull request carries the programme file and the CI checks only.

| Template | Target | When |
|---|---|---|
| [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md) | `CLAUDE.md` | Claude Code; exactly the line `@AGENTS.md`, no markers |
| [repo-local/toolkit-programme.template.json](repo-local/toolkit-programme.template.json) | `.github/toolkit-programme.json` | A merged enabled repository, or its accepted pending yes |

The governed block and Antigravity bootstrap templates stay only so the session-start preflight can compare leftover copies and this Toolkit repository can build its own root files; they are never installed into another repository. Install a shim only beside the repository's own `AGENTS.md`, never a shim without `AGENTS.md`: shims only point to it. A target repository or explicit path is required.

A governed block, Antigravity bootstrap or `docs/agent-playbooks/` copy an older setup left is reported as a leftover and left as it is. Explicit repairs back up anything they replace under `_agent-toolkit-backups/` with the shared restore contract, keep every byte outside the markers, and preview any `.gitignore` or `.git/info/exclude` change for exact approval. Legacy `.agent-toolkit-backups/` content is recognised and left untouched.

For n8n safety, load [n8n-safety-router](../n8n-safety-router/); the governed rules do not carry the full n8n rules.

## Installing the skill folder

Copy the whole `skills/repository-agent-rules/` folder, not just `SKILL.md`:

| Platform | Location (any one) |
|---|---|
| Codex | `<repo>\.agents\skills\<skill>\` or `%USERPROFILE%\.agents\skills\<skill>\` |
| Claude Code | `<repo>\.claude\skills\<skill>\` or `%USERPROFILE%\.claude\skills\<skill>\` |
| Antigravity | `<workspace>\.agents\skills\<skill>\` (portable skills copy only; no native plugin) |

The repository-local outputs above still go into the target repository, not the skill folder.

## Maintaining

`SKILL.md` and this README are edited directly. The templates are generated from `repo/contracts/agent-rules/`; change the source there and run:

```powershell
node repo/scripts/sync-agent-instruction-shims.cjs --write
```
