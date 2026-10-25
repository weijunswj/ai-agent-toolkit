
# Secure CI/CD Installer Skill

Secure CI/CD installer planning, approval-gated template review, safe docs-based status tracking, and a bundled personal-data guard (`scripts/personal-data-guard.cjs` with its installer `scripts/install-personal-data-guard.cjs` and the CI template `templates/github-actions/personal-data-guard.yml`), and a read-only CI check-up (`scripts/ci-checkup.cjs`, procedure in `templates/cicd/ci-checkup.md`) that finds where CI has fallen behind the code.

The `SKILL.md` file is a canonical AI-facing surface in this folder. Update it directly, then run the targeted checks:

```powershell
node repo/scripts/audit-skill-portability.cjs
```
