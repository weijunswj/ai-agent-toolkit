# External Operation Preflight Skill

Copy the whole [external-operation-preflight](./) skill folder when an agent needs to check a live change on an outside system before the owner approves it: deploys, merges into auto-deploying branches, new or renamed resources, migrations, restores and trigger pauses.

This README is only an install and identity note. Runtime guidance lives in `SKILL.md`. The offline checker is `scripts/preflight-check.cjs` (Node, no packages), the plan format is `templates/operation-plan.example.json`, the backup and restore evidence rules are in `references/backup-and-recovery.md`, and `scripts/recovery-identity.cjs` with `references/recovery-identity.md` keeps the exact identity of a temporary resource that later sessions depend on.

Neither script calls a provider or reads credentials. Plans carry key names and references only; the recovery identity script writes only its own record files, in `~/.ai-agent-toolkit/recovery-identities` or the folder it is given.
