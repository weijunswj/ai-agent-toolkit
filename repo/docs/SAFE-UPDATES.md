# Safe Updates

The scheduled source-watch notifier is a PR-based human-review notification. It reads SOURCE-LOCK metadata, checks the latest upstream GitHub commit for active third-party sources, and opens or updates one stable review PR only when the upstream commit differs from the locked commit.

The notification PR is not a source update PR. It does not copy upstream files, update SOURCE-LOCK.json, execute upstream code, auto-merge, push to main, or mutate live systems.

This policy does not block intentional, scoped generator/helper writes. It blocks unsafe writes and silent upstream application.

## Update Flow

Current scheduled notification flow:

1. Read `_projects/**/SOURCE-LOCK.json`.
2. Separate active update candidates from retired provenance sources.
3. Use active third-party source locks to identify upstream repo, source ref, locked commit, update policy, attribution requirement, allowlisted files, and exact blob pins.
4. Query the GitHub API for the latest commit at the locked source ref.
5. If no active third-party source changed, write a short summary and do not open a PR.
6. If an active third-party source changed, write `repo/source-watch/reviews/active-third-party-updates.md` on the stable `source-watch/review-active-third-party-updates` branch and open or update `[source-watch] Review active third-party source updates`.
7. The PR body and report must say that no source files, SOURCE-LOCK pins, or upstream code were changed or executed, and that no auto-merge is allowed.

Separate future source update flow, if a human approves one after reviewing the notification PR:

1. Detect source changes deterministically.
2. Compare in quarantine.
3. Classify each changed file as `safe`, `manual`, or `blocked`.
4. Generate a review summary.
5. Prepare a human-reviewed change proposal only after allowlisted files changed and validation passes.
6. Request human review before merge.

Retired internal provenance sources use `source_update_policy: "none"` and are not watched:

- `weijunswj/codex-n8n-local-setup`
- `weijunswj/ai-cicd-installer`
- `weijunswj/n8n-workflow-templates`

Their copied `_projects/**/_main/` files are canonical. SOURCE-LOCK hashes remain local provenance and exact-byte drift checks. See [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md).

## Classifications

| Class | Meaning |
| --- | --- |
| `safe` | Markdown docs, rubrics, instruction text, or clearly generic examples. |
| `manual` | Templates with commands, config snippets, scripts as templates, or CI workflow changes. |
| `blocked` | Runtime scripts from upstream, dependency manifests, installers, network/download logic, credentials, `.env`, private keys, credential exports, bindings, product workflow JSON, or unapproved `allowed-tools`. |

Allowed scoped writes:

- Local agent-rule generation may write generated source-side templates, root repo-local instruction shims, and published repo-local agent-rule template outputs.
- Privileged auto-sync may stage and push only passive generated/published outputs. It must not stage or push active root AI instruction files; `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md` must be committed manually on the PR branch when source changes require them.
- n8n sanitizer helpers may write ignored staging folders.
- n8n sync helpers may write reviewed consumer repo workflow JSON plus ignored local `.tmp/**` and `.n8n-local/**`.

## Third-Party Updates

Current source-watch output is a review notification only. For any separately approved source update work, third-party source updates require stricter review:

- Strict allowlist.
- Exact `source_blob_sha` pins for exact and adapted copied files.
- Manual attribution check.
- Manual script review.
- Local-only static checks for no network, shell execution, subprocess use, package installs, or browser launches.
- Full repo validation.
- Labels such as `source-update` and `third-party-review`.
- Review from `weijunswj` before merge.

Active third-party source locks must use `source_lifecycle: "active"`, `source_role: "third_party_attribution_source"`, `source_update_policy: "manual_review_required"`, `public_attribution_required: true`, and a full 40-character `source_commit` SHA. Retired internal source locks are historical provenance only and are not scheduled-watch targets.

For `nextlevelbuilder/ui-ux-pro-max-skill`, the allowlist is:

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- `src/ui-ux-pro-max/data/**/*.csv`
- `LICENSE`

## AI Review

Optional AI review is advisory only. It can help summarize a diff, but it cannot approve or apply changes.

GitHub Actions and Codex must not use source-watch as a source write mechanism. Scheduled source-watch may write only the review notification report and PR metadata. Optional AI review can check upstream notes, explain risk, produce a Codex review prompt, and recommend approve/reject/manual review. It must not apply changes.

GitHub notifications depend on the user's notification settings. Any separately approved future updater work should request the right reviewer through normal GitHub review settings.

## Hard Rules

- No merge automation.
- No silent auto-updates.
- No direct-to-main source updates.
- No token printing.
- No upstream code execution.
- No upstream package installation, code checkout, source copying, or source execution.
- No product repo destructive actions.
- No live n8n import/export in CI.
