# Claude Support Notes

This file explains how to use this skill with Claude and Claude Code.

## Claude

Use this skill with Claude if the Claude account or workspace supports Skills.

Basic setup:

1. Open Claude.
2. Go to the Skills area if available.
3. Add or upload the whole `knowledge-index-updater` skill folder.
4. Make sure the skill includes `SKILL.md`.
5. Test with a prompt like:

```text
Use the knowledge index updater skill to update my Notion Knowledge Index.
```

If Claude Skills are not available, skip Claude setup and use the README/SKILL.md instructions manually.

## Claude Code

Claude Code supports local skills from these locations:

```text
~/.claude/skills/knowledge-index-updater/
```

or project-specific:

```text
.claude/skills/knowledge-index-updater/
```

Basic setup:

1. Copy the whole `knowledge-index-updater` folder.
2. Paste it into `~/.claude/skills/` for personal use, or `.claude/skills/` inside a project.
3. Restart Claude Code.
4. Ask Claude Code to run a matching workflow.

## Important limitation

This skill depends on Notion, GitHub, and scheduled-task access.

If Claude or Claude Code cannot access those connectors directly, the agent should:

1. Explain the missing access.
2. Generate the manual steps instead.
3. Avoid pretending the update was completed.
