<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Import Export Flow Reference

Use in a consumer repo, not the toolkit repo.

## Boundary

This short safety checklist is not the full runtime guide. Live n8n or Docker work requires approval naming the repo, environment, operation, workflow set, and exclusions.

## Export Review

- Preserve canonical logic, sheet/tab names, approved locators, mappings, expressions, filters, options, nodes, connections, and settings.
- Replace credentials with canonical `{ name }` references plus logical name/type declarations; omit `id` entirely and never commit target IDs or values.
- Remove target workflow/webhook metadata, force `active: false`, and protect mappings unless reviewed source-update mode is explicit.

## Import Review

- Discover only safe credential metadata through a supported transport and resolve one exact logical name/type match without exposing IDs.
- Rebuild from canonical Git, remove every canonical `webhookId`, restore webhook identity only for a uniquely matched existing target node, and apply only declared exact scalar resource bindings.
- Validate the payload and canonical invariant before comparison. Valid non-dry-run import needs no routine confirmation, stays inactive, and verifies the postcondition without execution.
- For a supported unresolved first import, create the reported name/type and rerun. Unsupported transports stop before mutation.
- Optional misses are informational; required, ambiguous, or unsafe matches block.
- Preserve modes transactionally, use repository mode for new files, and keep temporary files private. Revalidate exact target content, type, mode, identity, and parent topology immediately before displacement. Preserve drift; roll back only proven transaction-owned identities and retain bounded recovery evidence otherwise.

Do not run live import/export in CI. Keep `.tmp/**` and `.n8n-local/**` ignored and local.

## Stop Conditions

- Approval does not name the target repo.
- Live approval does not name the target instance/environment.
- Live approval does not name the workflow set.
- Operation is broader than approved.
- Ambiguous workflow match.
- Credential discovery unavailable, zero/duplicate name/type matches, or same-name wrong-type matches.
- Missing required exact resource binding.
- Canonical invariant failure or a target whose inactivity cannot be guaranteed.
- Credentials would be touched unexpectedly.
- Workflow activation, publish, delete, archive, or execution would happen unexpectedly.
- Ignored scratch folders contain commit-worthy changes or private/product data.

Never run live helpers in CI. Never commit `.tmp/**`, `.n8n-local/**`, live payloads, `.env`, or secrets.
