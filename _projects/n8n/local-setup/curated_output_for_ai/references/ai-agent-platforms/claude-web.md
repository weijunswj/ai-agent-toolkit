<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Web Platform Overview

Claude web can use instruction-only skills when custom Skills are available in the account or workspace. This note explains the platform boundary and routes users to local full-fidelity material.

## Boundary

This is a short platform overview and routing note. It is not the full runtime setup guide.

For full setup detail, use the local full-fidelity references and templates in this copied skill folder.

## Local References

- Use `skills/n8n-local-setup/references/n8n/local-setup.md` for the full local n8n setup guide.
- Use `skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md` for Claude Code skills-first routing.
- Use `skills/n8n-local-setup/SKILL.md` as the skill router.

## Manual Use

- Choose a skill under `skills/`.
- Upload the complete folder when Claude custom Skills are available.
- Keep source material credential-free.
- Treat Claude web output as advice unless a local agent or human verifies the repo changes.

## Limitations

Claude web may not have local shell, file, or connector access. If it cannot inspect or mutate local files, it should provide manual steps instead of claiming work was done.

Do not automate Claude web through cookies, browser sessions, or session hacks.
