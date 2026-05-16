# Cleanup Policy

Cleanup must preserve auditability and avoid deleting useful migration context too early.

## Temporary Files Allowed During Migration

Temporary scratch files are allowed only outside committed toolkit content or in ignored paths. The repo ignores:

- `.tmp/`
- `.to-sanitise/`
- `.sanitised/`
- `.n8n-workflow-backups/`
- `_dist/`

Do not commit files from those folders.

## Must Never Be Committed

- `.env` or unsafe `.env.*`.
- `.n8n-local/`.
- `.tmp/`.
- Credential exports or credential bindings.
- Live n8n import/export JSON.
- Private keys.
- Product/customer workflow JSON.
- Generated ZIP/TGZ/package outputs.

## Migration Checklist

`MIGRATION_CHECKLIST.md` can be deleted only after:

1. All final validation commands pass.
2. The user explicitly approves final cleanup.

## Old Root Folders

Old root skill folders are removed only after their skill contents are moved under `skills/` and validation confirms the new paths.

## Old Source Repos

Do not delete source repos during toolkit migration.

Recommended source repo retirement flow:

1. Add README redirects in old source repos.
2. Archive old source repos first.
3. Wait 30-60 days.
4. Delete only if no tools, links, agents, workflows, or humans depend on them and backups exist.
