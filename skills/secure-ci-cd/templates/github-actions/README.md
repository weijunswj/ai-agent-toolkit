# GitHub Actions Templates

This toolkit's workflows are intentionally safe by default.

## Rules

- Use explicit permissions.
- Default to `contents: read`.
- Use `contents: write` only for a tightly scoped generated-template workflow that commits generated outputs back to a same-repo PR branch, and in `dependency-auto-merge.yml`, which needs it to turn auto-merge on and off.
- Use `issues: write` only for issue-summary workflows.
- Do not use `pull-requests: write`, except in `dependency-auto-merge.yml`, which needs it to turn auto-merge on and off and to comment.
- Do not auto-commit except for generated template outputs on same-repo PR branches.
- Do not auto-merge, except `dependency-auto-merge.yml`: Dependabot patch and minor updates only, merge commit only, through GitHub auto-merge so every required check must pass first, and only when the repository's programme binding allows it and a ruleset requires at least one check.
- Do not print tokens.
- Upload generated artifacts only; never commit them.

Consumer repos should adapt workflows after reviewing their own project structure.
