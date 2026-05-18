<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# GitHub Actions Templates

This toolkit's workflows are intentionally safe by default.

## Rules

- Use explicit permissions.
- Default to `contents: read`.
- Use `contents: write` only for a tightly scoped generated-template workflow that commits generated outputs back to a same-repo PR branch.
- Use `issues: write` only for issue-summary workflows.
- Do not use `pull-requests: write` in v1.
- Do not auto-commit except for generated template outputs on same-repo PR branches.
- Do not auto-merge.
- Do not print tokens.
- Upload generated artifacts only; never commit them.

Consumer repos should adapt workflows after reviewing their own project structure.
