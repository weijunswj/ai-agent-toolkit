<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Import Export Sync Helpers

This folder contains review-required helper templates for n8n workflow import/export sync.

They are meant to be copied into a consumer repository that intentionally owns n8n workflow JSON under `n8n-workflows/`.

Live import/export helper entry points are not run from this toolkit repo during CI. Non-live validation, sanitizer, sync, compare, and prepare logic may be exercised by tests.

## Consumer Repo Layout

- Committed n8n workflow export JSON belongs under the repo root `n8n-workflows/`.
- If `n8n-workflows/` exists, include `n8n-workflows/README.md` describing the workflow set, safety notes, and validation command.
- When Toolkit creates or manages `n8n-workflows/`, copy or sync this approved helper folder into `n8n-workflows/scripts/`.
- Do not store committed workflow JSON under `docs/`, `scripts/`, `.n8n/`, `.tmp/`, app folders, or random scratch paths.
- Use stable lowercase hyphenated filenames such as `member-intake-small-batch.json`; reserve `archived/` for intentionally retained old exports.

## Included Helpers

- `export-n8n-workflows-live.ps1`
- `import-n8n-workflows-live.ps1`
- `n8n-workflow-sync-menu.ps1`
- `validate-n8n-workflows.cjs`
- `sync-n8n-live-exports.cjs`
- `prepare-n8n-live-import.cjs`
- `n8n-portable-workflow.cjs`
- `n8n-credential-metadata.cjs`
- `n8n-workflow-transport.cjs`
- `n8n-workflow-operation-report.cjs`
- `n8n-workflow-identity.cjs`
- `compare-n8n-workflow-credentials.cjs`
- `should-import-n8n-workflow.cjs`
- `_export-n8n-workflows-live.cmd`
- `_import-n8n-workflows-live.cmd`

The live import/export PowerShell helpers support explicit Docker target overrides with `-Container`, `-ContainerName`, `-ContainerId`, `-ComposeProject`, and `-ComposeService`, plus the matching environment variables `N8N_CONTAINER_NAME`, `N8N_CONTAINER_ID`, `N8N_COMPOSE_PROJECT`, and `N8N_COMPOSE_SERVICE`. Without an explicit target, they detect running n8n containers from Docker Compose service output, Compose labels, and safe `n8nio/n8n` image fallback. Multiple detected instances require a valid numeric selection for the current run only and are not persisted.

## Wrapper Working Directory

The `.cmd` wrappers invoke their co-located PowerShell scripts with `%~dp0<name>.ps1` and do not change directory themselves. The PowerShell scripts resolve and set their working directory from their script location.

## Portable Import Contract

Normal operator flow is export canonical workflow JSON and portable logical credential name/type declarations to Git, create matching credentials on the target when reported missing, then rerun the unchanged import command. The helper resolves target IDs internally, rebuilds from canonical Git, applies only dedicated webhook metadata and declared exact resource paths, validates the canonical invariant, imports inactive without a routine confirmation, and verifies the inactive postcondition.

Canonical Git stores credential references as `{ "name": "logical-name" }` and omits `id` entirely. Only the prepared payload may contain an exact resolved target ID or the supported new-workflow unresolved `id: null` form. Preparation strips every canonical `webhookId`; new workflows restore none, while existing workflows restore only a uniquely matched live node identity.

Every present portable credential declaration, deployment policy, and resource binding must use schema version 1 and an exact supported container shape. Malformed present files, duplicate credential requirements, stable node-ID conflicts, or logical names that drift from canonical Git fail before any prepared workflow overlay. Name/type fallback is used only when the populated stable ID is absent and the specific helper contract permits that fallback.

The root document owns `schemaVersion`; aggregate workflow entries use the dedicated entry schema. A supported direct credential declaration is migrated transactionally into one aggregate `workflows` entry while preserving its admitted workflow selectors and credential requirements. Every populated selector on direct and aggregate entries must agree before use. An explicitly supplied deployment-policy path is required to remain a readable regular file, while absence of the documented default policy remains optional.

Normal export preserves both canonical values and canonical absence. Live-only protected leaves or complete mapping domains are removed from the portable result, or the export fails closed when safe deletion is not possible. Only explicit reviewed source-update mode may introduce protected logic. Transactions reject repeated normalized targets before staging, preserve each existing regular-file mode, use the ordinary repository file mode for new files, and keep cryptographically unpredictable stages and original quarantines private. Immediately before displacement they revalidate the authorised target's exact type, bytes/hash, size, mode, high-resolution identity, and real parent topology; an originally missing target must still be absent. Candidate installation uses a same-directory hard link with atomic destination-exists failure and never falls back to overwrite-capable rename.

The explicit phases are `PREPARED`, `INSTALLING`, `PRECOMMIT_VERIFIED`, `COMMITTED`, `POST_COMMIT_CLEANUP`, and `COMPLETE`. Before `COMMITTED`, every original remains exact in its operation-owned quarantine and any failure rolls back only proven transaction-owned identities. At `COMMITTED`, every target is the exact coherent candidate batch while every original quarantine still exists. After that point, cleanup failure never starts subset rollback: the candidate batch remains installed, exact residue is retained, and `N8N_CANONICAL_TRANSACTION_COMMITTED_CLEANUP_REQUIRED` requires bounded local reconciliation. Concurrent ambiguity before commit uses `N8N_CANONICAL_TRANSACTION_PARTIAL_RECOVERY`. Ordinary success requires a final all-record postcondition proving exact candidates, authorised modes and parent topology, absent stages/quarantines, and no unexpected transaction path. Import preflight rejects multiple canonical workflows resolving to one target workflow before any live or local identity mutation.

An explicitly supplied import deployment-policy path is validated as a safe readable regular file inside the repository before live discovery or preparation, and its validated snapshot is rechecked before use. Required credential misses drive the create-and-rerun action. Optional zero-match requirements remain informational and do not turn an unchanged workflow into `ACTION_REQUIRED`; ambiguous or otherwise unsafe matches still fail closed. Failure receipts map each stable code to one concrete remedy, and Explain last failure displays that remedy without a self-referential loop.

The helper never activates, executes, test-runs, publishes, or restarts n8n. An already-active target is blocked because scheduled activity cannot be guaranteed inactive without a separate restart. `-RequireConfirmation` is compatibility-only menu behavior and is not the default.

Operation receipts are written to `.n8n-local/reports/latest-n8n-workflow-operation.{json,txt}` and bounded 90-day history. The menu's read-only Explain last n8n failure action validates the latest report and states one supported next action.

## Intended Scoped Writes

In a reviewed consumer repo, these helpers may write:

- `n8n-workflows/*.json`
- `n8n-workflows/README.md`
- `n8n-workflows/scripts/**`
- `.tmp/**`
- `.n8n-local/**`

`.tmp/**` and `.n8n-local/**` must stay ignored and uncommitted. They can hold transient prepared payloads, exact private resource bindings, and sanitized reports. Portable logical credential name/type declarations belong under `n8n-workflows/toolkit/` and may be committed.

## Safety Rules

- Do not run live n8n import or export from this toolkit repo.
- Do not run live n8n import/export in CI.
- Do not commit `.tmp/**`, `.n8n-local/**`, live import/export JSON, credential IDs/values, encrypted credential exports, private keys, or `.env` files.
- Do not commit workflow JSON containing credentials, secrets, tokens, cookies, webhook secrets, private environment values, or production execution data. Use placeholder environment variable names only and document required variables separately.
- Do not commit `.n8n/` runtime folders, n8n database files, binary backups, or live execution exports.
- Helper scripts must not print secrets and must not default to destructive live actions.
- Review workflow diffs before committing `n8n-workflows/*.json` in a consumer repo.
- Treat these executable files as helper templates, not trusted runtime code.
