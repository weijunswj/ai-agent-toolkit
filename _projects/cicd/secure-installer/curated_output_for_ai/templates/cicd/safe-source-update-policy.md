<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Safe Source Update Policy

## v1 Behavior

Source update automation is issue-summary only. It must not apply upstream changes.

## Classify Changes

- `safe`: Markdown docs, rubrics, instruction text, generic examples.
- `manual`: templates with commands, config snippets, scripts as templates, CI workflow changes.
- `blocked`: upstream runtime scripts, dependency manifests, installers, network/download logic, credentials, `.env`, private keys, credential exports, credential bindings, product workflow JSON, or unapproved `allowed-tools`.

## Review

Human approval is required before edits. AI review can summarize, but it cannot approve changes.

Do not automate ChatGPT web with cookies, sessions, browser automation, or session hacks.
