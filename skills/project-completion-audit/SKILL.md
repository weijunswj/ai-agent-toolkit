---
name: project-completion-audit
description: Use when running a guarded final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, "make sure everything works", "is this production ready", "/goal" readiness remediation, security-readiness check, or final readiness check. Performs preflight only until explicit confirmation authorizes scope.
---

<!--
Generated from toolkit project source. Do not edit directly.
Project: development.project-completion-audit
Source: _projects/development/project-completion-audit/_main/skill/SKILL.md
Update the project source and run sync.
-->
# Project Completion Audit

## Invocation Policy

This skill is intentionally guarded because final readiness audits can become broad, expensive, and security-sensitive. Its platform metadata sets `allow_implicit_invocation: false` where supported.

If a platform still routes this skill implicitly, perform only lightweight preflight and then stop for explicit confirmation. Do not treat skill invocation as permission to run broad validation, full builds, browser sweeps, security scans, deployment checks, external-service checks, or remediation.

## Phase 0: Lightweight Preflight Only

Inspect only enough context to prepare a safe confirmation prompt:

- Repo or app name.
- Current branch/ref when available.
- App type: frontend, backend, full-stack, data/tooling, or mixed.
- Likely audit scope and whether a full-repo or scoped-folder audit is appropriate.
- Relevant local docs/instructions available, such as `AGENTS.md`, playbook index, `MEMORY.md`, README, product specs, architecture notes, runbooks, test docs, or validation docs.
- Whether UI, backend, data, deployment, auth, admin, upload, API, logging, privacy, payment, billing, entitlement, external integration, webhook, or other security-sensitive surfaces appear to exist.
- Whether Codex Security skills or plugin capabilities appear installed/available, if detectable from the current environment.
- Whether Playwright, browser, screenshot, or click-through verification appears available, when the app has UI surfaces.

During preflight, do not run broad validation, full builds, browser sweeps, security scans, live/deployment checks, external-service checks, remediation, or destructive cleanup.

## Mandatory Confirmation Guard

After preflight, stop and ask the user to confirm all of the following:

- Target repo/app.
- Branch/ref.
- Audit scope.
- Full-repo audit or scoped-folder audit.
- Whether Codex Security should be invoked if installed and available.
- Whether standard security scan or deep security scan is approved.
- Whether screenshot and browser click-through verification is approved for UI apps.
- Confirmation that no live-system, deployment, destructive, external-service, credential, payment, customer-data, or private-data actions are allowed without separate explicit current-turn approval naming the target and action.

Ask for an explicit affirmative reply similar to:

```text
Proceed with full production-readiness audit for <target>.
```

Do not accept vague replies such as `ok`, `sure`, `go`, or `continue` unless the target and scope were already unambiguous in the immediately preceding confirmation prompt. If the reply is ambiguous, ask again and keep the work at preflight.

## Full Audit Phases

After explicit confirmation, run the work in two main phases:

1. Production-readiness audit.
2. Security-readiness audit.

Inspect intent, docs, and current implementation before making fixes. Read:

- Root `AGENTS.md`.
- Repo playbook/index if present.
- Root `MEMORY.md` if present.
- Relevant product, architecture, requirements, source-of-truth, generated-output, setup, runbook, test, readiness, or validation docs.

Compare intended behavior against actual implementation. Do not assume undocumented behavior is production-ready.

## Production-Readiness Audit

Review the surfaces that match the repo type:

- Frontend apps: user-facing flows, protected/admin flows, responsive behavior, accessibility basics, loading/empty/error states, privacy policy and Terms of Use links for product-facing or data-handling apps, and browser/click-through verification where available.
- Backend apps: API behavior, auth and authorization boundaries, input validation, error handling, rate limits, logging, test coverage, migrations/schema safety, fixtures, and error-path checks.
- Full-stack apps: frontend-to-backend contracts, auth/session behavior, API errors surfaced to users, upload and external integration flows, database reads/writes, privacy-safe logging, and end-to-end workflow completeness.
- Data/tooling repos: CLI behavior, dry-runs, fixtures, schemas, generated outputs, idempotency, failure modes, validation commands, and artifact freshness.
- Mixed products: combine the relevant checks and call out any unverified or deferred surface.

For UI projects, use browser/click-through verification where available, preferably Playwright or screenshots when practical and approved. For backend, data, or tooling projects, use targeted tests, fixtures, CLI dry-runs, schemas, output checks, and error-path checks where applicable.

Review at minimum:

- User-facing workflow completeness.
- Admin/protected workflow completeness.
- API/backend behavior.
- Error handling.
- Privacy-safe logging.
- Generic user-facing errors with traceable error references where applicable.
- Privacy Policy and Terms of Use page/linking requirements where product-facing or data-handling frontend/backend behavior exists.
- Security-sensitive surfaces such as auth, admin, uploads, webhooks, external integrations, secrets, database reads/writes, customer/company/personal/private data, payment, billing, credits, entitlements, and logging.

## Security-Readiness Audit

Explicitly invoke Codex Security if installed and available for final production-readiness audits and for security-sensitive changes involving:

- Authentication or authorization.
- Admin routes.
- File uploads or media handling.
- User-submitted forms.
- API handlers.
- Webhooks.
- External integrations.
- Secrets or environment config.
- Logging or error handling.
- Customer, company, quote, enquiry, invoice, personal, or private data.
- Database reads/writes.
- Payment, billing, credits, or entitlement logic.

Prefer a standard security scan first. Do not run a deep security scan unless the user explicitly approved deep scan in the confirmation step.

Record in the audit report:

- Whether Codex Security was available.
- Whether it was invoked.
- Scan type.
- Scan target/scope.
- Scan status.
- Findings.
- Unresolved findings.
- False positives.
- Deferred findings.
- Generated report or artifact paths.

If Codex Security is unavailable, state that clearly and fall back to manual security review, static checks, and targeted tests where practical.

## Audit Report

Create or update a repo-local audit report. Use an existing docs/audit-style location if present. Otherwise use:

```text
docs/audits/YYYY-MM-DD-production-readiness-audit.md
```

Include:

- Scope inspected.
- Instruction sources used.
- Docs/requirements reviewed.
- Current branch/ref.
- App/repo type.
- Validation commands run and exact results.
- UI/browser flows checked, if applicable.
- Screenshot or artifact paths, if generated.
- Security scan availability and scope.
- Findings table.
- Release gates.
- Proposed remediation batches.
- Known manual checks.
- Unverified, skipped, failed, inaccessible, unavailable, or deferred areas.

Use these finding severities:

- P0 production blocker.
- P1 release blocker.
- P2 quality gap.
- P3 nice-to-have/defer.

## Claim Rules

Never claim "all security is covered" or imply perfect security. Use accurate wording such as:

- `No known unresolved P0/P1 security blockers found in the checks performed.`
- `Security coverage is limited to the declared scan scope and validation evidence.`
- `Unverified, unavailable, skipped, or deferred areas remain not production-cleared.`

Do not call the repo/app production-ready if:

- Any P0 production blocker remains open.
- Any P1 release blocker remains open.
- Codex Security was skipped, unavailable, incomplete, or found unresolved high/critical-equivalent issues, unless the user explicitly accepts the risk and the exception is recorded.
- Required validation failed, was skipped, or was inaccessible without clear disclosure.
- Live/deployment/external-service/customer-data/private-data checks are assumed rather than verified or explicitly deferred.

## Remediation Loop

Start remediation only after the audit report exists.

- Fix P0 before P1, and P1 before P2, unless the user explicitly reprioritizes.
- Make small coherent remediation batches.
- Keep diffs scoped.
- Run targeted validation after each batch.
- Re-run relevant click-through/browser verification for affected user-facing flows.
- Update the audit report after each remediation batch.
- Record which findings were closed, partially closed, deferred, or newly found.
- Commit to a non-main branch, push, and open or update a PR unless the user explicitly asks for local-only.
- Check CI/status when accessible.
- Stop for ambiguous product decisions, live-system actions, deployment, secrets, external services, destructive actions, customer/private data, or security-sensitive operations requiring explicit approval.

## Safety Boundary

Do not run live-system, production, deployment, external-service, destructive, credential, import/export, sync, payment, customer-data, private-data, or irreversible actions without explicit current-turn approval naming the target and action.

Do not hide failed, pending, skipped, inaccessible, unavailable, or deferred validation.
