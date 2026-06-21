# Project Completion Audit

Guarded workflow for final project completion, release-candidate, launch-readiness, QA, and production-readiness audits across frontend apps, backend apps, full-stack apps, data/tooling repos, and mixed products.

## Use This Skill For

- A final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, security-readiness check, final readiness check, or "make sure everything works" request.
- A request such as "Is this production ready?", "Use /goal to finish this", or "Audit against the original docs."
- A remediation loop after a readiness audit report exists.

## Core Guard

Start with lightweight preflight only. Do not run broad validation, full builds, browser sweeps, security scans, deployment checks, external-service checks, or remediation until the user explicitly confirms the target and scope.

The confirmation phrase should be equivalent to:

```text
Proceed with full production-readiness audit for <target>.
```

Do not treat vague replies such as `ok`, `sure`, `go`, or `continue` as approval unless the target and scope were unambiguous in the immediately preceding confirmation prompt.

## Expected Output

First output a preflight summary and confirmation prompt. After explicit confirmation, produce or update a repo-local audit report at an existing audit docs path or `docs/audits/YYYY-MM-DD-production-readiness-audit.md`, then run remediation in small validated batches only after the report exists.

## Safety Boundary

Do not run live-system, production, deployment, external-service, destructive, credential, import/export, sync, payment, customer-data, private-data, or irreversible actions without separate explicit current-turn approval naming the target and action.

