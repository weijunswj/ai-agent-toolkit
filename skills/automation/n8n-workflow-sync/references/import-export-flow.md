# Import Export Flow

Use this flow in a consumer repo, not from the toolkit repo.

## Export Review

1. Export live workflows to an ignored folder.
2. Strip live-only fields, credentials, credential IDs, webhook IDs, static data, pin data, and unneeded tag metadata.
3. Force `active: false` for committed templates.
4. Write credential binding metadata only to ignored `.n8n-local/`.
5. Review the diff before commit.

## Import Review

1. Validate repo workflow JSON.
2. Prepare import payloads in ignored `.tmp/`.
3. Restore credential references only when binding metadata is unambiguous and local.
4. Restore live webhook IDs only for existing live workflows with unique node matches.
5. Import only after explicit confirmation of target instance and workflow set.

## Stop Conditions

- Ambiguous workflow match.
- Missing or stale credential bindings when credentials are required.
- Product/customer data in template JSON.
- Workflow would activate or publish unexpectedly.
