# Knowledge Index Updater

This skill maintains a clean Notion Knowledge Index backed by Notion pages and GitHub repos.

Copy or install the whole `knowledge-index-updater` folder. Use `SKILL.md` as the agent entrypoint; it contains the full workflow, schema, matching rules, and reporting format.

## Supported Platforms

| Platform | Support notes |
|---|---|
| ChatGPT | Use `SKILL.md` and `agents/openai.yaml` when Notion, GitHub, and automation connectors are available. |
| Codex | Use the same skill folder inside the project skills location. |
| Claude | Use `SKILL.md` if Claude Skills are available. |
| Claude Code | Copy the folder into `~/.claude/skills/` for personal use or `.claude/skills/` for project use. |

If a platform cannot access Notion, GitHub, or scheduled tasks, provide manual update steps instead of claiming the index was updated.

## Files

```text
knowledge-index-updater/
- README.md
- SKILL.md
- agents/
  - claude.md
  - openai.yaml
```
