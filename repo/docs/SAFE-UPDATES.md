# Safe Updates

The current source-watch workflow is read-only advisory planning. It renders a plan from SOURCE-LOCK metadata; it does not fetch upstream commits, copy files, update SOURCE-LOCK.json, create branches, create PRs, or mutate live systems.

Any future source updater is out of scope for this advisory workflow. If one is designed later, it must stay separate from source-watch, require human review, and preserve the validation and safety gates described here.

This policy does not block intentional, scoped generator/helper writes. It blocks unsafe writes and silent upstream application.

## Update Flow

Current advisory flow:

1. Read `_projects/**/SOURCE-LOCK.json`.
2. Separate active update candidates from retired provenance sources.
3. Use active third-party source locks to identify upstream repo, source ref, locked commit, update policy, attribution requirement, allowlisted files, and exact blob pins.
4. Render a source-watch plan.
5. Run source-lock audit and project sync checks.

Possible future updater flow, if separately approved:

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

- Agent-rule generation may write only the generated source-side and published agent-rule template outputs.
- n8n sanitizer helpers may write ignored staging folders.
- n8n sync helpers may write reviewed consumer repo workflow JSON plus ignored local `.tmp/**` and `.n8n-local/**`.

## Third-Party Updates

Current source-watch output is advisory only. For any separately approved future updater work, third-party source updates require stricter review:

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

GitHub Actions and Codex must not use source-watch as a write mechanism. Optional ChatGPT scheduled review can check upstream notes, explain risk, produce a Codex review prompt, and recommend approve/reject/manual review. It must not apply changes.

GitHub notifications depend on the user's notification settings. Any separately approved future updater work should request the right reviewer through normal GitHub review settings.

## Hard Rules

- No merge automation.
- No silent auto-updates.
- No direct-to-main source updates.
- No token printing.
- No upstream code execution.
- No network fetching in this advisory workflow.
- No product repo destructive actions.
- No live n8n import/export in CI.
