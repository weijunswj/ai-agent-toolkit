# Cleanup Policy

Cleanup must preserve auditability and avoid deleting useful migration context too early.

## Temporary Files Allowed During Migration

Temporary scratch files are allowed only outside committed toolkit content or in ignored paths. The repo ignores:

- `.tmp/`
- `.n8n-local/`
- `.to-sanitise/`
- `.sanitised/`
- `.n8n-workflow-backups/`
- `_dist/`

Do not commit files from those folders. They are allowed only as local staging/output folders for reviewed helper runs.

## Must Never Be Committed

- `.env` or unsafe `.env.*`.
- `.n8n-local/`.
- `.tmp/`.
- Credential exports or credential bindings.
- Live n8n import/export JSON.
- Private keys.
- Product/customer workflow JSON.
- Generated ZIP/TGZ/package outputs.

## Durable Provenance

Keep historical source provenance in [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md) and `_projects/**/SOURCE-LOCK.json`. Do not recreate temporary migration checklists as active repo policy.

## Old Root Folders

Old root skill folders are removed only after their skill contents are moved under `skills/` and validation confirms the new paths.

## Old Project Sources

Do not delete project source material during toolkit migration.

Recommended retirement flow for old external project homes after their module exists here:

1. Confirm the replacement project module exists under `_projects/<category>/<project>/_main/`.
2. Confirm AI-facing consumer surfaces link to that module.
3. Add README redirects in the old project home.
4. Archive the old project home first.
5. Wait 30-60 days.
6. Delete only if no tools, links, agents, workflows, or humans depend on it and backups exist.
