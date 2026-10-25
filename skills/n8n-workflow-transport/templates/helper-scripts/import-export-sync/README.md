
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
- `n8n-cli-workflow-json.cjs`
- `n8n-risky-nodes.cjs`
- `n8n-helper-set.cjs` and its stamp `n8n-helper-set.json`
- `check-n8n-helper-machine.cjs`
- `_export-n8n-workflows-live.cmd`
- `_import-n8n-workflows-live.cmd`

The live import/export PowerShell helpers support explicit Docker target overrides with `-Container`, `-ContainerName`, `-ContainerId`, `-ComposeProject`, and `-ComposeService`, plus the matching environment variables `N8N_CONTAINER_NAME`, `N8N_CONTAINER_ID`, `N8N_COMPOSE_PROJECT`, and `N8N_COMPOSE_SERVICE`. Without an explicit target, they detect running n8n containers from Docker Compose service output, Compose labels, and the official `n8nio/n8n` image from Docker Hub or `docker.n8n.io` under any tag or digest. Multiple detected instances require a valid numeric selection for the current run only and are not persisted.

## Working On Any Machine

- **One complete set:** `n8n-helper-set.json` stamps every helper file with a content hash (line endings ignored). The live helpers check the stamp before they do anything and stop with one plain error that names a missing or changed file. Files a repository adds itself are reported and kept. Set `N8N_HELPERS_ALLOW_LOCAL_CHANGES=1` for one run only when a local change to a stamped file is intended.
- **Check this machine:** `node check-n8n-helper-machine.cjs --offline` reports Node.js, PowerShell and the helper set, then one next step. It is read-only and prints no environment values except the three n8n log settings. Without `--offline`, as menu option 10 runs it, it also reads the local Docker host: Docker, the n8n container, its n8n version and its log settings. An agent drops `--offline` only with current-turn approval for Docker reads there.
- **Refresh a repository's copy:** `node n8n-helper-set.cjs refresh --from <Toolkit helper folder> --to n8n-workflows/scripts` previews every added and changed file; add `--write` to copy them. It never deletes: repository-local scripts and a repository's own edited `README.md` are kept, and files an older set used that the new set does not are listed for the owner to remove.
- **Reading n8n output:** n8n prints `export:workflow` through its own log, so a container set to a quieter log level, file-only logs or JSON log lines used to hide or wrap the list. The helpers pin the log settings for that one call and read the list with Node, tolerating warning lines around it. An empty list from a successful command is an error, never "no workflows". The stored list holds every live workflow, so it is deleted when the run finishes or fails. If a run is killed before that, its copy stays until the next run starts, which deletes the files of any run no longer running. A file is kept only while a process with its id is running and started before the file was written, so a reused process id does not keep it. The clean-up touches only the helpers' own file names, and nothing when the list folder or `.tmp` is a link; the helpers refuse to store the list when either is a link.
- **No PowerShell JSON rewrites:** workflow JSON is parsed and written only by `n8n-cli-workflow-json.cjs`. PowerShell 6 and later rewrote date-like strings in the machine's time zone, and every PowerShell edition refused keys that differ only by case, so the same export could differ or fail between machines.
- **Requirements:** Node.js 18 or newer, PowerShell (Windows PowerShell 5.1 or PowerShell 7), Docker, and n8n running in a container on the same machine.
- **Container restart:** the helpers never restart n8n. A restart prompt that older copies carried is not part of the set; restarting after an import that updates a previously published or scheduled workflow stays an operator action, as the import output says.
- **Maintainers:** after changing any helper file here, run `node n8n-helper-set.cjs write-manifest`; a test fails while the stamp is stale.

## Wrapper Working Directory

The `.cmd` wrappers invoke their co-located PowerShell scripts with `%~dp0<name>.ps1` and do not change directory themselves. The PowerShell scripts resolve and set their working directory from their script location.

## Portable Import Contract

Normal operator flow is export canonical workflow JSON and portable logical credential name/type declarations to Git, create matching credentials on the target when reported missing, then rerun the unchanged import command. The helper resolves target IDs internally, rebuilds from canonical Git, applies only dedicated webhook metadata and declared exact resource paths, validates the canonical invariant, imports unpublished (inactive) without a routine confirmation, and verifies the unpublished postcondition.

Canonical Git stores credential references as `{ "name": "logical-name" }` and omits `id` entirely. Only the prepared payload may contain an exact resolved target ID or the supported new-workflow unresolved `id: null` form. Preparation strips every canonical `webhookId`; new workflows restore none, while existing workflows restore only a uniquely matched live node identity.

Canonical Git leaves out two instance-only settings: `settings.errorWorkflow` (a workflow id on one n8n instance) and `settings.availableInMCP` (that instance's MCP exposure decision). Every other setting is kept, and the export reports what it left out. An import replaces the whole workflow, settings included, so a prepared import carries the target's own values for these two settings and never Git's: an existing workflow keeps its MCP exposure and error workflow exactly as they were, and a new workflow gets neither. Preparation refuses a payload whose values differ from the target's. The validator warns about either setting in committed files.

The validator also lists, per workflow, the nodes the n8n safety rules say to inspect before any test or run: Code, Execute Command, Read/Write Files, HTTP Request and credentialed nodes. It is a read-only report; `--fail-on-risky-nodes` makes it fail.

Every present portable credential declaration, deployment policy, and resource binding must use schema version 1 and an exact supported container shape. Malformed present files, duplicate credential requirements, stable node-ID conflicts, or logical names that drift from canonical Git fail before any prepared workflow overlay. Name/type fallback is used only when the populated stable ID is absent and the specific helper contract permits that fallback.

The root document owns `schemaVersion`; aggregate workflow entries use the dedicated entry schema. A supported direct credential declaration is migrated transactionally into one aggregate `workflows` entry while preserving its admitted workflow selectors and credential requirements. Every populated selector on direct and aggregate entries must agree before use. An explicitly supplied deployment-policy path is required to remain a readable regular file, while absence of the documented default policy remains optional.

Normal export preserves both canonical values and canonical absence. Live-only protected leaves or complete mapping domains are removed from the portable result, or the export fails closed when safe deletion is not possible. Only explicit reviewed source-update mode may introduce protected logic. Transactions reject repeated normalized targets before any directory or target write, validate the complete candidate batch in memory, preserve each existing regular-file mode, and use the ordinary repository mode for new files. Existing targets are read without following links and are bound to the authorised type, bytes/hash, size, mode, high-resolution identity, link-count evidence and real parent topology. Exact byte/mode no-ops remain read-only. Portable Node APIs expose no conditional single-target replacement primitive that excludes unmanaged same-inode writers or protects unreviewed hard-link aliases, so a changed existing target fails in `PREPARED` and preserves the complete candidate batch under ignored `.n8n-local/manual-apply/<operation-id>/` state. Missing targets use exclusive destination creation and never fall back to overwrite-capable rename.

Export validates `.n8n-local/n8n-workflow-identities.json` before live discovery and resolves each recorded canonical file to that exact target ID before any workflow-name fallback. A recorded identity that is missing from the target fails closed, and AllLive name matching excludes files with dedicated identities, so a renamed target cannot redirect canonical export to an unrelated workflow that reused its old name. Target workflow IDs stay internal to the helper.

The explicit phases remain `PREPARED`, `INSTALLING`, `PRECOMMIT_VERIFIED`, `COMMITTED`, `POST_COMMIT_CLEANUP`, and `COMPLETE`. Named stages, quarantines and rollback paths are eliminated, so the canonical transaction contains no `rm`, `unlink`, destructive copy or `rename` boundary. A changed existing target never enters `INSTALLING`; `N8N_CANONICAL_TRANSACTION_MANUAL_APPLY_REQUIRED` is distinct from success, rollback, partial recovery and committed cleanup. An originally missing file created before a later failure is retained as bounded evidence because exact absence cannot be restored without pathname deletion. After `COMMITTED`, no rollback is attempted. Ordinary success requires a final all-record identity, authorised mode and parent-topology postcondition. Import preflight rejects multiple canonical workflows resolving to one target workflow before any live or local identity mutation.

An explicitly supplied import deployment-policy path is validated as a safe readable regular file inside the repository before live discovery or preparation, and its validated snapshot is rechecked before use. Required credential misses drive the create-and-rerun action. Optional zero-match requirements remain informational and do not turn an unchanged workflow into `ACTION_REQUIRED`; ambiguous or otherwise unsafe matches still fail closed. Failure receipts map each stable code to one concrete remedy, and Explain last failure displays that remedy without a self-referential loop.

The helper never activates, executes, test-runs, publishes, or restarts n8n. An already-published (active) target is blocked because scheduled activity cannot be guaranteed to stop without a separate restart. n8n 2.x replaced activate/deactivate with publish/unpublish: a workflow counts as unpublished only when `active` is false and no published version (`activeVersionId`) is set; anything else, including a missing state, counts as live. The postcondition requires unpublished. `-RequireConfirmation` is compatibility-only menu behavior and is not the default.

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
