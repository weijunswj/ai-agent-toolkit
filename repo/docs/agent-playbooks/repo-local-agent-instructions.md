# Repo-Local Agent Instructions Playbook

Use this for `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules`, managed markers, repo-local templates, shims, or `ai-coding-agent-rules`.

## Source Model

- Root toolkit instructions are repo-specific.
- Root `AGENTS.md` keeps managed execution and n8n blocks from `ai-coding-agent-rules`, then appends toolkit-specific root rules directly in root `AGENTS.md`.
- Portable repo-local templates under `skills/ai-coding-agent-rules/repo-local/` must stay self-contained.
- Portable and managed execution-block source-owned instruction content lives under `_projects/development/ai-coding-agent-rules/`.
- Published `skills/**` instruction templates are generated outputs unless declared linked.

Update the source partial, curated template, or generator first. Then run sync.

## Managed Markers

Keep `AI-AGENT-TOOLKIT` marker pairs intact. If marker-owned content changes, edit the source named in the marker or the generator that owns it.

Portable repo-local templates must not depend on toolkit-only paths such as `repo/docs/agent-playbooks/`, `_projects/`, `repo/scripts/`, `toolkit.project.json`, or `SOURCE-LOCK.json`.

## Session Reset

When the `ai-coding-agent-rules` skill installs or repairs active repo-local instructions in a consumer repo, preserve its session-reset prompt and backup behavior.
