# Safe Updates

Safe source updates are PR-based. They should detect upstream changes deterministically, copy only allowlisted files into `_projects/**/_main/`, update source locks, run local validation, and open a draft PR for review.

This policy does not block intentional, scoped generator/helper writes. It blocks unsafe writes and silent upstream application.

## Update Flow

1. Detect source changes deterministically.
2. Compare in quarantine.
3. Classify each changed file as `safe`, `manual`, or `blocked`.
4. Generate a review summary.
5. Open a draft PR when allowlisted files changed and validation passes.
6. Request human review before merge.

## Classifications

| Class | Meaning |
| --- | --- |
| `safe` | Markdown docs, rubrics, instruction text, or clearly generic examples. |
| `manual` | Templates with commands, config snippets, scripts as templates, or CI workflow changes. |
| `blocked` | Runtime scripts from upstream, dependency manifests, installers, network/download logic, credentials, `.env`, private keys, credential exports, bindings, product workflow JSON, or unapproved `allowed-tools`. |

Allowed scoped writes:

- Agent-rule generation may write only the generated agent-rule template outputs.
- n8n sanitizer helpers may write ignored staging folders.
- n8n sync helpers may write reviewed consumer repo workflow JSON plus ignored local `.tmp/**` and `.n8n-local/**`.

## Third-Party Updates

Third-party source updates require stricter review:

- Draft PR only.
- Strict allowlist.
- Manual script review.
- Local-only static checks for no network, shell execution, subprocess use, package installs, or browser launches.
- Labels such as `source-update` and `third-party-review`.
- Request review from `weijunswj` and mention `@weijunswj` in the PR body.

For `nextlevelbuilder/ui-ux-pro-max-skill`, the allowlist is:

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- `src/ui-ux-pro-max/data/**/*.csv`
- `LICENSE`

## AI Review

Optional AI review is advisory only. It can help summarize a diff, but it cannot approve or apply changes.

GitHub Actions and Codex should handle deterministic file updates. Optional ChatGPT scheduled review can check upstream notes, explain risk, produce a Codex review prompt, and recommend approve/reject/manual review. It must not be the write mechanism.

GitHub notifications depend on the user's notification settings. Requesting `weijunswj` as reviewer and mentioning `@weijunswj` in the PR body gives the strongest chance of GitHub or email notification.

## Hard Rules

- No merge automation.
- No silent auto-updates.
- No direct-to-main source updates.
- No token printing.
- No upstream code execution.
- No product repo destructive actions.
- No live n8n import/export in CI.
