# Safe Updates

Safe source updates are advisory in v1. They detect and summarize upstream changes; they do not apply them.

## Update Flow

1. Detect source changes deterministically.
2. Compare in quarantine.
3. Classify each changed file as `safe`, `manual`, or `blocked`.
4. Generate a review summary.
5. Ask for human approval before any local edit.

## Classifications

| Class | Meaning |
| --- | --- |
| `safe` | Markdown docs, rubrics, instruction text, or clearly generic examples. |
| `manual` | Templates with commands, config snippets, scripts as templates, or CI workflow changes. |
| `blocked` | Runtime scripts from upstream, dependency manifests, installers, network/download logic, credentials, `.env`, private keys, credential exports, bindings, product workflow JSON, or unapproved `allowed-tools`. |

## AI Review

Optional AI review is advisory only. It can help summarize a diff, but it cannot approve or apply changes.

ChatGPT web review must be manual: paste the update summary into ChatGPT yourself. Do not automate ChatGPT web with cookies, browser sessions, session files, browser automation, or session hacks in GitHub Actions.

## Hard Rules

- No auto-merge.
- No silent auto-updates.
- No auto-apply.
- No draft PR creation in v1.
- No token printing.
- No upstream code execution.
- No product repo destructive actions.
