<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/chatgpt-web.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# ChatGPT Web Platform Overview

ChatGPT web can use instruction-only skills when custom skills are available in the account or workspace. This note explains the platform boundary and routes users to local full-fidelity material.

## Boundary

This is a short platform overview and routing note. It is not the full runtime setup guide.

For full setup detail, use the local full-fidelity references and templates in this copied skill folder.

## Local References

- Use `skills/n8n-local-setup/references/n8n/local-setup.md` for the full local n8n setup guide.
- Use `skills/n8n-local-setup/SKILL.md` as the skill router.
- Use platform-specific local templates when an agent can read files and run local tools.

## Manual Use

- Choose a skill under `skills/`.
- Upload or paste the complete skill folder if ChatGPT custom Skills are available.
- Treat ChatGPT web output as advice unless a local agent or human verifies the repo changes.

## Limitations

ChatGPT web should not be automated with cookies, browser sessions, session files, browser automation, or session hacks.

If ChatGPT web cannot access local files or shell commands, use the relevant guide as a manual checklist and ask the user to run commands locally.

## Safe Review Use

For safe source updates, paste summaries manually into ChatGPT web if advisory review is useful. Treat the response as advice, not approval.
