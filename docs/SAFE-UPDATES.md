# Safe Updates

Safe source updates are intended to become PR-based, but the current PR #4 implementation is read-only advisory planning. The current source-watch workflow renders a plan from SOURCE-LOCK metadata; it does not fetch upstream commits, copy files, update SOURCE-LOCK.json, create branches, or create PRs.

A future updater should detect upstream changes deterministically, copy only allowlisted files into `_projects/**/_main/`, update source locks, run local validation, and open a draft PR for review.

This policy does not block intentional, scoped generator/helper writes. It blocks unsafe writes and silent upstream application.

## Update Flow

Current PR #4 advisory flow:

1. Read `_projects/**/SOURCE-LOCK.json`.
2. Separate active update candidates from archived migration sources.
3. Render a source-watch plan.
4. Run source-lock audit and project sync checks.

Future PR updater flow:

1. Detect source changes deterministically.
2. Compare in quarantine.
3. Classify each changed file as `safe`, `manual`, or `blocked`.
4. Generate a review summary.
5. Open a draft PR when allowlisted files changed and validation passes.
6. Request human review before merge.

Retired internal migration sources use `source_update_policy: "none"` and are not watched:

- `weijunswj/codex-n8n-local-setup`
- `weijunswj/ai-cicd-installer`
- `weijunswj/n8n-workflow-templates`

Their copied `_projects/**/_main/` files are canonical after migration. SOURCE-LOCK hashes remain local provenance and exact-byte drift checks.

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

Current source-watch output is advisory only. For future updater work, third-party source updates require stricter review:

- Strict allowlist.
- Manual script review.
- Local-only static checks for no network, shell execution, subprocess use, package installs, or browser launches.
- Labels such as `source-update` and `third-party-review`.
- Review from `weijunswj` before merge.

For `nextlevelbuilder/ui-ux-pro-max-skill`, the allowlist is:

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- `src/ui-ux-pro-max/data/**/*.csv`
- `LICENSE`

## AI Review

Optional AI review is advisory only. It can help summarize a diff, but it cannot approve or apply changes.

GitHub Actions and Codex should handle deterministic file updates. Optional ChatGPT scheduled review can check upstream notes, explain risk, produce a Codex review prompt, and recommend approve/reject/manual review. It must not be the write mechanism.

GitHub notifications depend on the user's notification settings. Future updater work should request the right reviewer through normal GitHub review settings.

## Hard Rules

- No merge automation.
- No silent auto-updates.
- No direct-to-main source updates.
- No token printing.
- No upstream code execution.
- No product repo destructive actions.
- No live n8n import/export in CI.
