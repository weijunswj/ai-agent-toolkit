# GitHub Actions Templates

This toolkit's workflows are intentionally safe by default.

## Rules

- Use explicit permissions.
- Default to `contents: read`.
- Use `issues: write` only for issue-summary workflows.
- Do not use `contents: write` in v1.
- Do not use `pull-requests: write` in v1.
- Do not auto-commit.
- Do not auto-merge.
- Do not print tokens.
- Upload generated artifacts only; never commit them.

Consumer repos should adapt workflows after reviewing their own project structure.
