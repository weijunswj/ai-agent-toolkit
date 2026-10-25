# External Operation Preflight Skill

Copy the whole [external-operation-preflight](./) skill folder when an agent needs to check a live change on an outside system before the owner approves it: deploys, merges into auto-deploying branches, new or renamed resources, migrations, restores and trigger pauses.

This README is only an install and identity note. Runtime guidance lives in `SKILL.md`. The offline checker is `scripts/preflight-check.cjs` (Node, no packages), the plan format is `templates/operation-plan.example.json`, and the backup and restore evidence rules are in `references/backup-and-recovery.md`.

The checker never calls a provider and never reads credentials. Plans carry key names and references only.
