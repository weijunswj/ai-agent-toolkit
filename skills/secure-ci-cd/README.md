
# Secure CI/CD Installer Skill

Secure CI/CD installer planning, approval-gated template review, safe docs-based status tracking, and a bundled personal-data guard (`scripts/personal-data-guard.cjs`, which also checks pull request text for home-folder paths and AI attribution, with its installer `scripts/install-personal-data-guard.cjs` and the CI template `templates/github-actions/personal-data-guard.yml`), and a bundled plain-text check (`scripts/plain-text-check.cjs` with its installer `scripts/install-plain-text-check.cjs` and the CI template `templates/github-actions/plain-text.yml`), and a read-only CI check-up (`scripts/ci-checkup.cjs`, procedure in `templates/cicd/ci-checkup.md`) that finds where CI has fallen behind the code.

The `SKILL.md` file is a canonical AI-facing surface in this folder. Update it directly, then run the targeted checks:

```powershell
node repo/scripts/audit-skill-portability.cjs
```

## Plain-text baselines

New plain-text baselines use the `toolkit-plain-references-baseline/v2` format. Each allowance stores a file, rule, SHA-256 fingerprint and positive occurrence count. The fingerprint covers the file, rule and exact matched text; the matched link or text is never stored. Identical findings share an allowance with a count. Editing a link or moving it to another file creates a new finding; moving it to another line does not.

Legacy baselines with stored text still work. Normal checks and installer refreshes leave them unchanged. To replace that stored text explicitly, run the installed checker from the repository root:

```powershell
node .github/scripts/plain-text-check.cjs --migrate-baseline
```

Migration keeps every allowance and count unchanged, including stale allowances, and removes legacy metadata that could contain matched text. It does not scan for or approve new findings. An already migrated baseline is left unchanged. A missing, malformed or unreadable baseline cannot be migrated; errors never print its contents. Fingerprints reduce copied text; they do not encrypt it or make predictable matches impossible to guess.

Migration removes matched text from the current baseline file but not from git history, and a real token found there must be revoked, not just migrated.

Use `--prune-baseline` separately to lower counts or remove stale allowances. Pruning never adds allowances or raises counts, and keeps the existing format. Use `--init-baseline` only when no baseline exists. Baseline write commands cannot be combined with each other, `--files` or `--explain`. Normal checks, including `--files`, are read-only.

For Toolkit's own baseline, use `node repo/scripts/check-plain-references.cjs --migrate-baseline` when migration is wanted. That wrapper also supports read-only scoped checks and shrink-only pruning.
