<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Import Export Flow Reference

Use this flow in a consumer repo, not from the toolkit repo.

## Boundary

This is a short safety checklist, not the full runtime guide. Scoped non-live actions may validate repo workflow JSON and prepare local files for the named consumer repo and operation. Live n8n or Docker actions require explicit current-turn approval naming the repo, instance/environment, operation, workflow set, and forbidden operations.

## Export Review

- Preserve canonical logic, real sheet/tab names, approved non-secret locators, mappings, expressions, filters, matching columns, options, nodes, connections, and settings.
- Replace credentials with portable `{ id: null, name }` references and logical name/type declarations; never commit IDs or values.
- Remove target workflow/webhook metadata, force `active: false`, and protect generated mapping domains unless reviewed source-update mode is explicit.

## Import Review

- Discover only safe credential metadata through a supported transport and resolve exactly one logical name/type match without exposing target IDs.
- Rebuild from canonical Git, restore dedicated webhook identity, and apply only declared exact scalar resource bindings.
- Validate the prepared workflow and canonical invariant before effective comparison. A valid non-dry-run import proceeds without routine confirmation, stays inactive, performs no execution, and verifies the postcondition.
- For a supported unresolved first import, create the reported logical name/type and rerun the same command. Unsupported transports stop before mutation.

Do not run live import/export in CI. Keep `.tmp/**` and `.n8n-local/**` ignored and local.

## Stop Conditions

- Approval does not name the target repo.
- Live approval does not name the target instance/environment.
- Live approval does not name the workflow set.
- Operation is broader than approved.
- Ambiguous workflow match.
- Credential discovery unavailable, zero/duplicate name/type matches, or same-name wrong-type matches.
- Missing required exact resource binding.
- Canonical invariant failure or an active target whose inactivity cannot be guaranteed without restart.
- Credentials would be touched unexpectedly.
- Workflow activation, publish, delete, archive, or execution would happen unexpectedly.
- Ignored scratch folders contain commit-worthy changes or private/product data.

Never run live helpers in CI. Never commit `.tmp/**`, `.n8n-local/**`, live payloads, `.env`, or secrets.
