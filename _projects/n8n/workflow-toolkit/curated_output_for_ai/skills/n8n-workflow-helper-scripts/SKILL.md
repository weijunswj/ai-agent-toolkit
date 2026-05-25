---
name: n8n-workflow-helper-scripts
description: Use for safe n8n workflow helper-script templates, including sanitizer helpers, import/export sync helpers, validation, comparison, live-import preparation, and repo/live workflow hygiene. Applies when copying, reviewing, or explaining these helper scripts for a consumer repo, after applying n8n-agent-rules.
---

<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Workflow Helper Scripts

Use this instruction-only skill when the user wants to copy, review, adapt, or reason about reusable n8n workflow helper scripts.

Apply `n8n-agent-rules` first for the full n8n operating contract. A generated local copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability.

## Use When

- Sanitizing raw n8n workflow exports into reviewed template candidates.
- Validating generic n8n workflow JSON before import or publication.
- Comparing repo workflows against live exports.
- Preparing reviewed repo workflow JSON for live import.
- Preserving local credential bindings in ignored consumer-repo metadata.
- Explaining `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, and `.sanitised/**` hygiene.

## Do Not Use When

- The task is unrelated to n8n workflow files or helper scripts.
- The user asks only for actual reusable workflow JSON templates.
- The request would run live n8n actions without explicit current-turn confirmation.

## Rules

- Treat these scripts as review-required templates, not trusted runtime code.
- Follow `n8n-agent-rules` for workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, and live n8n safety.
- Do not run live n8n import/export from this toolkit repo.
- Do not run live n8n import/export in CI.
- Do not commit `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, `.sanitised/**`, live import/export JSON, credentials, credential bindings, private keys, or `.env` files.
- Keep consumer-repo workflow JSON inactive unless the user explicitly confirms activation in the target live instance.
- Review workflow diffs before committing `n8n-workflows/*.json` in a consumer repo.

## Approval Boundary

After scoped user approval in a consumer repo, agents may run non-live local helper actions only for the approved repo and operation:

- Validate repo workflow JSON.
- Sanitise/check local candidate exports.
- Compare/diff already-exported local files.
- Prepare import payloads into ignored `.tmp/**`.
- Check ignored `.n8n-local/**` credential-binding metadata.

Non-live approval does not allow live n8n access, Docker, deployment, activation, credential changes, or source-watch actions. Never commit `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, `.sanitised/**`, credential bindings, live payloads, `.env`, or secrets.

Live n8n actions require explicit current-turn approval naming the target repo, target n8n instance/environment, allowed operation, workflow names/set, and forbidden operations. Live-gated actions include live export/import/sync, activation/deactivation, publish/unpublish, archive/delete, execution, and credential creation/update/delete/binding/replacement.

Stop and ask again if approval does not name the target repo; live approval does not name the target instance/environment or workflow set; the operation is broader than approved; credentials would be touched unexpectedly; activation, publish, delete, archive, or execution would happen unexpectedly; workflow matching is ambiguous; credential bindings are missing, stale, or ambiguous; or ignored scratch folders contain commit-worthy changes.

## Approval Examples

- Non-live: `Yes, in this repo, run the n8n validation script only. Do not run live import/export, Docker, activation, credential, or deployment actions.`
- Live export: `Yes, in this repo, run the live export helper against my local n8n instance only. Export only these workflows: <names>. Do not import, activate, publish, delete, execute, or modify credentials.`
- Live import: `Yes, in this repo, run the prepared live import against my local n8n instance only for these reviewed workflow files: <paths>. Do not activate, publish, delete, execute, or modify credentials.`

## References

- `references/workflow-sync.md`: repo/live sync boundary and safety wrapper.
- `references/import-export-flow.md`: import/export review flow.
- `references/credential-safety.md`: credential and binding hygiene.
- `references/n8n-credential-safety.md`: n8n local binding metadata rules.
- `references/n8n-agent-rules.md`: generated cross-skill copy of the full n8n operating rules.

## Templates

- `templates/helper-scripts/sanitizer/`: sanitizer helper scripts.
- `templates/helper-scripts/import-export-sync/`: import/export, validation, compare, prepare, and sync helper scripts.

## Output

Report:

- Source inspected.
- Helper scripts used or copied.
- Scoped writes allowed in the consumer repo.
- Files excluded and why.
- Validation to run.
- Any live action that still needs explicit confirmation.
