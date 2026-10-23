<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/repository-agent-rules/README.md
-->

# Repository Agent Rules

Puts a repository under Toolkit governance, or checks and repairs that, by managing one Toolkit-governed block in its `AGENTS.md` plus tiny host shims. The generic rules every session needs are installed separately by `setup toolkit` into each harness's user-level file; this skill does not write them.

The skill folder carries ready-to-copy templates (a curated-source comment plus the marker-wrapped content, except the one-line `CLAUDE.md` shim):

| Template | Target | When |
|---|---|---|
| [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) | `AGENTS.md` | Always; the block is the opt-in |
| [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md) | `CLAUDE.md` | Claude Code; exactly the line `@AGENTS.md`, no markers |
| [repo-local/antigravity-bootstrap.template.md](repo-local/antigravity-bootstrap.template.md) | `.agents/rules/00-agent-toolkit-bootstrap.md` | Antigravity |
| [repo-local/docs/agent-playbooks/](repo-local/docs/agent-playbooks/) | `docs/agent-playbooks/` | The whole folder, so the governed block's links work |

Install only the current platform's shim unless the user asks for all, and never a shim without `AGENTS.md`: shims only point to it. A target repository or explicit path is required. The Antigravity bootstrap points to `AGENTS.md` and does not import it; Antigravity reads `AGENTS.md` itself, so there is no `GEMINI.md` shim.

When the required files already carry complete, balanced `AI-AGENT-TOOLKIT` markers, the cheap check stops and the original task continues without reading templates. Explicit install, repair or refresh requests back up anything they replace under `_agent-toolkit-backups/` with the shared restore contract, keep every byte outside the markers, and preview any `.gitignore` or `.git/info/exclude` change for exact approval. Legacy `.agent-toolkit-backups/` content is recognised and left untouched.

For n8n safety, load [n8n-safety-router](../n8n-safety-router/); the governed block does not carry the full n8n rules.

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
