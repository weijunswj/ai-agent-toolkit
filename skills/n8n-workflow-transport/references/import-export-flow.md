# Import Export Flow Reference

Use only in a consumer repo.

## Boundary

This short reference is not the full runtime guide. Live n8n or Docker work requires approval naming repo, environment, operation, workflow set, and exclusions.

## Export Review

- Preserve canonical logic, sheet/tab names, approved locators, mappings, expressions, filters, options, nodes, connections, and settings.
- Resolve a tracked export through its dedicated local file-to-target identity before name fallback. If that recorded target disappears, fail closed instead of selecting a same-name workflow.
- Replace credentials with canonical `{ name }` references plus logical name/type declarations; omit `id` entirely and never commit target IDs or values.
- Remove target workflow/webhook metadata, force `active: false`, and protect mappings unless reviewed source-update mode is explicit.

## Import Review

- Discover only safe credential metadata through a supported transport and resolve one exact logical name/type match without exposing IDs.
- Rebuild from canonical Git, remove every canonical `webhookId`, restore webhook identity only for a uniquely matched existing target node, and apply only declared exact scalar resource bindings.
- Validate the payload and canonical invariant before comparison. Valid non-dry-run import needs no routine confirmation, stays inactive, and verifies the postcondition without execution.
- For a supported unresolved first import, create the reported name/type and rerun. Unsupported transports stop before mutation.
- Optional misses are informational; required, ambiguous, or unsafe matches block.
- Validate the batch before mutation. Existing no-ops stay read-only; missing files use exclusive creation. Changed existing files fail in `PREPARED` with an ignored local batch because Node has no safe conditional replace. Descriptor writes, link evidence, hashes, checks, and locks never authorise mutation; the transaction never deletes or renames a pathname.

## Stop Conditions

- Approval omits the target repo, instance/environment, or workflow set.
- Operation is broader than approved.
- Ambiguous workflow match.
- Credential discovery unavailable, zero/duplicate name/type matches, or same-name wrong-type matches.
- Missing required exact resource binding.
- Canonical invariant failure or a target whose inactivity cannot be guaranteed.
- Credentials would be touched unexpectedly.
- Workflow activation, publish, delete, archive, or execution would happen unexpectedly.
- Ignored scratch folders contain commit-worthy changes or private/product data.

Never run live helpers in CI. Never commit `.tmp/**`, `.n8n-local/**`, live payloads, `.env`, or secrets.
