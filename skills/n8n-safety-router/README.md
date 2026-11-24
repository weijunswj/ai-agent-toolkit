<!--
Canonical Toolkit skill surface. Edit this skill folder directly.
Source: skills/n8n-safety-router/README.md
-->

# n8n Agent Rules Skill

Instruction-only skill for the full n8n operating ruleset.

Install or load this skill for every n8n task. Other n8n skills depend on it:

- `n8n-environment-setup`
- `n8n-workflow-transport`

The full rules live at [n8n-safety-rules.md](n8n-safety-rules.md). Keep that file available locally when copying this skill folder.

The n8n Safety Router rules reach every session through the global rules that setup installs, so a repository needs no n8n block; an older `N8N-AGENT-RULES-ADAPTER` block in a repository's `AGENTS.md` is a leftover.

Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the extra context cost. Prefer installing this skill or a generated cross-skill reference.
