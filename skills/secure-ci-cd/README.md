
# Secure CI/CD Installer Skill

Secure CI/CD installer planning, approval-gated template review, safe docs-based status tracking, and a bundled personal-data guard (`scripts/personal-data-guard.cjs`, which also checks pull request text for home-folder paths and AI attribution, with its installer `scripts/install-personal-data-guard.cjs` and the CI template `templates/github-actions/personal-data-guard.yml`), and a bundled plain-text check (`scripts/plain-text-check.cjs` with its installer `scripts/install-plain-text-check.cjs` and the CI template `templates/github-actions/plain-text.yml`).

The `SKILL.md` file is a canonical AI-facing surface in this folder. Update it directly, then run the targeted checks:

```powershell
node repo/scripts/audit-skill-portability.cjs
```
