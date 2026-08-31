# Install Secure UI/UX Frontend Design

This repository location is a template/source location. It is not necessarily the final runtime location used by ChatGPT, Codex, Claude, Claude Code, or an n8n skills repository.

Install the whole `frontend-art-direction/` folder, including `SKILL.md`, `agents/`, `examples/`, and `references/`.

## ChatGPT web

1. Open ChatGPT.
2. Open the Skills area if custom Skills are available for the account or workspace.
3. Create a new skill.
4. Upload or paste the contents of this folder.
5. Test with a frontend design or review prompt.

## Codex

Copy the folder to:

```text
.agents/skills/frontend-art-direction/
```

Then restart Codex or reload the project so the skill metadata is discovered.

## Claude web

1. Open Claude.
2. Open Skills if available for the account or workspace.
3. Add or upload the complete skill folder.
4. Confirm the uploaded folder includes `SKILL.md`.
5. Test with a matching frontend UI/UX prompt.

## Claude Code

For a project skill, copy the folder to:

```text
.claude/skills/frontend-art-direction/
```

For a personal skill, copy the folder to:

```text
~/.claude/skills/frontend-art-direction/
```

Restart Claude Code after copying the folder.

## AI surfaces repo

If using this toolkit topology, copy the folder to:

```text
skills/frontend-art-direction/
```

This path is a source or packaging location, not a general instruction to execute generator code from an arbitrary active workspace. Runtime generator execution must resolve through the trusted installed skill directory loaded by the agent.

This skill does not create or modify live n8n workflows. It only provides frontend design and review instructions, including safety gates for n8n-like workflow screens.

## Install verification

After installing, use a prompt such as:

```text
Use the secure frontend design skill to review this SaaS settings page for accessibility, responsive behavior, and privacy risks.
```
