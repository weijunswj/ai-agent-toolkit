<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Import Export Flow Reference

Use this flow in a consumer repo, not from the toolkit repo.

## Boundary

This is a short skill-local reference and safety checklist. It is not the full runtime helper guide; live helper detail remains in local templates.

Non-live local helper actions in a consumer repo may run only after scoped user approval for that repo and operation. Allowed non-live actions are validation, sanitising/checking local candidate exports, comparing already-exported local files, preparing `.tmp/**` import payloads, and checking ignored `.n8n-local/**` credential-binding metadata.

Scoped non-live approval still does not allow live n8n access, Docker, deployment, activation, credential changes, or source-watch actions. Do not commit `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, `.sanitised/**`, credential bindings, live payloads, `.env`, or secrets.

Live n8n actions require explicit current-turn approval naming the target repo, target n8n instance/environment, allowed operation, workflow names/set, and forbidden operations. Live-gated actions include live export/import/sync, activation/deactivation, publish/unpublish, archive/delete, execution, and credential creation/update/delete/binding/replacement.

## Export Review

1. Export live workflows to an ignored folder only after live approval.
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

Do not run live import/export in CI. Keep `.tmp/**` and `.n8n-local/**` ignored and local.

## Stop Conditions

- Approval does not name the target repo.
- Live approval does not name the target instance/environment.
- Live approval does not name the workflow set.
- Operation is broader than approved.
- Ambiguous workflow match.
- Missing or stale credential bindings when credentials are required.
- Credentials would be touched unexpectedly.
- Workflow activation, publish, delete, archive, or execution would happen unexpectedly.
- Ignored scratch folders contain commit-worthy changes.
- Product/customer data in template JSON.
- Workflow would activate or publish unexpectedly.
