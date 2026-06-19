---
name: managed-app-foundation-review
description: Review an implementation plan to decide whether to use low-cost, free, managed, or owner-hosted foundations instead of building common product, backend, data, automation, account, admin, ops, and security infrastructure from scratch. Use when the user asks to cut build scope, reduce security risk, compare build-vs-buy, choose managed services, plan upgrade triggers, or revisit a plan around auth, users, databases, backend APIs, workflows/automation, CRM, forms, email, storage, analytics, traffic/security monitoring, signup/login/password reset, email verification, contact forms, or low-cost app foundations.
---

<!--
Generated from toolkit project source. Do not edit directly.
Project: development.managed-app-foundation-review
Source: _projects/development/managed-app-foundation-review/_main/skill/SKILL.md
Update the project source and run sync.
-->
# Managed App Foundation Review

## Overview

Use this skill before implementation momentum turns common platform work into custom code. The goal is to cut scope and reduce security risk by choosing managed or owner-hosted foundations where they are low-cost enough to justify the integration work.

Also use this skill to define an upgrade watch for selected providers: what usage limits matter, what signals Codex should inspect later, what warning threshold should trigger a suggestion, and what owner approval is required before any paid plan change.

Do not run a full provider search for every ordinary feature. Use this skill when the task introduces or materially changes a foundation primitive, or when the user asks to reduce build scope, compare managed options, choose low-cost foundations, or define upgrade triggers. Foundation primitives include auth, accounts, backend APIs, databases, workflow automation, CRM/contact records, forms, email, storage, admin dashboards, billing, queues, scheduled jobs, webhooks, search, analytics, traffic/security monitoring, or abuse prevention. Do not interrupt small follow-up implementation tasks after the foundation decision is already recorded.

Keep the review practical: recommend building from scratch only when product constraints, data ownership, compliance, offline needs, cost at expected scale, or provider lock-in make managed services a poor fit.

## Core Rule

- Prefer managed, boring, well-maintained foundations for auth, accounts, password reset, email verification, database access controls, backend services, workflow automation, file storage, email sending, CRM/contact records, admin workflows, audit logs, traffic/security telemetry, and abuse controls.
- Do not treat a provider as secure by default. Identify the configuration still required: rate limits, email verification, RLS/security rules, least-privilege keys, webhook verification, CSRF/session settings, backup/restore, export path, and data retention.
- Do not claim current pricing, free-tier limits, feature availability, or compliance posture unless you have checked current official provider docs in this turn. If browsing is unavailable or not requested, state that pricing and limits must be verified before commitment.
- For each recommended managed provider, capture upgrade-watch signals such as storage, bandwidth, request volume, database size, email volume, contacts, seats, monthly active users, execution minutes, compute/RAM/disk, API quotas, error rates, and rate-limit events when relevant.
- For deployment and AI modules, define privacy-safe observability before recommending go-live: daily PASS/WARN/FAIL summaries, metadata-only event allowlists, AI attempt ledger fields, failure taxonomy, and output-shape diagnostics. Do not log raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, payment data, or private files.
- For application error handling, require generic public-facing errors with a support-safe, non-PII, non-secret, event/request-specific error code or reference. Suggested public copy: `Something went wrong. Please try again. Contact support if this keeps happening. Error code: <event-specific-code-or-reference>.`
- The same visible error code/reference must appear in detailed backend logs, server-side logs, or the approved logging backend for the exact backend log event. It must be unique enough to correlate the user-facing error to the exact backend log event or approved logging-backend entry, stable enough for the user to quote to support, and not revealing internals. Static-only codes such as `UNKNOWN_ERROR`, `INTERNAL_ERROR`, or `ERR_GENERIC` are not sufficient by themselves; they may appear in logs as failure taxonomy only when paired with a unique request id, event id, trace id, or error reference that is also present in backend logs and, for user-facing failures, visible to the user.
- Keep logging and support diagnostics GDPR/PDPA-aware: collect only what is needed for support, abuse prevention, cost control, security review, billing, and reliability; define retention/deletion expectations; avoid raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, payment data, private connector data, private files, and unnecessary PII.
- For frontend app foundations, require linked Privacy Policy and Terms of Use pages for product-facing and/or data-handling frontend apps when the app is public-facing or handles accounts, forms, uploads, analytics, AI, payments, user data, customer/business data, admin workflows, dashboards, or confidential business data. They are not required for every isolated component, static UI experiment, internal throwaway mock, or non-product frontend-only task unless the task is intended for product use or handles user/business/confidential data.
- Do not add broad fallback behavior, silent fallback paths, or backwards compatibility shims by default. Ask the user before implementing fallbacks or backwards compatibility; if not approved, display the generic error with the error code and log it.
- Treat upgrade recommendations as advisory. Do not upgrade paid plans, change billing, add seats, resize servers, or enable paid add-ons without explicit owner approval naming the provider and operation.
- Do not create accounts, enter secrets, migrate data, modify DNS, configure production services, or write to external systems without explicit current-turn approval naming the provider and operation.

## Review Workflow

1. Inspect the current plan, repo, or requested feature list.
2. If the task introduces or materially changes a foundation primitive and the user has not already asked for managed alternatives, pause with a compact choice: explain that the feature can be built from scratch, but managed low-cost options may cut work and security risk; ask whether to compare them before implementing. If the repo or thread already records the foundation decision and the task is a small follow-up, continue without pausing.
3. List the foundation capabilities being custom-built:
   - Auth, signup, login, password reset, email verification, MFA, roles, and sessions.
   - User/customer database, row permissions, backend APIs, storage, backups, and exports.
   - Workflow automation, webhooks, queues, scheduled jobs, ETL/sync jobs, AI agent handoffs, and internal operations workflows.
   - CRM/contact pipeline, lead capture, contact forms, support inbox, and customer notes.
   - Email sending, notifications, templates, unsubscribe, bounce handling, and abuse limits.
   - Admin dashboard, moderation queue, audit logs, traffic/security telemetry, and incident review.
   - Payments, billing, file uploads, search, analytics, and scheduled jobs when relevant.
4. For each capability, choose `buy`, `build`, `skip`, or `hybrid`.
5. Prefer low-cost managed candidates first, but compare total implementation cost: integration time, security configuration, limits at expected usage, export/migration path, vendor lock-in, and support burden.
6. Define the upgrade watch for any selected provider:
   - Expected starting usage and near-term scale assumption.
   - Official limit or pricing page that must be verified before commitment.
   - Read-only usage source Codex can inspect later, such as provider dashboard export, API usage endpoint, billing alert, application metrics, Coolify/VPS resource report, logs, or database/storage stats.
   - Warning and failure thresholds, such as 70-80 percent of a quota for warning and 90-95 percent for urgent review, adjusted to the provider and workload.
   - Owner action required: optimize, clean up, archive/export, reduce abuse, split workloads, or approve an upgrade.
7. Keep private secrets server-side. Public client keys are acceptable only when backed by provider rules, scoped policies, and quota controls.
8. Produce a cut list of custom work to remove from the plan.

## Provider Selection Guardrails

- Browse or otherwise verify current official pricing, free-tier limits, and security docs when making concrete provider recommendations. Prefer official pricing/docs/status pages over blogs, old comparison posts, or memory.
- If the user asks to minimize token or browsing cost, do a two-step review: first identify which capabilities are worth comparing, then browse only the official docs for the short-listed provider categories.
- Do not maintain exact provider pricing or "best tools this month" claims inside this skill. Any cached provider landscape doc must be dated, non-authoritative, and treated as a starting point that still requires current official verification before use.
- If a recurring GitHub Actions or scheduled review is proposed, keep it notification-only by default: open an issue or PR with links and human review prompts, do not auto-update recommendations, auto-copy vendor docs, auto-merge, or treat search results as approved source.
- Use provider categories before brand names when the exact vendor is not important: managed auth, backend-as-a-service, hosted Postgres, serverless database, workflow automation, queues/schedulers, CRM/free contact pipeline, form backend, email API, object storage, search, analytics/security logs, observability, or helpdesk.
- Use solution categories beyond frontend/websites when they fit: backend-as-a-service, hosted databases, message queues, cron/scheduler platforms, workflow automation, ETL/sync tools, CMS/headless CMS, search, logs/observability, WAF/security telemetry, support/helpdesk, and owner-hosted automation.
- For workflow automation, n8n can be a candidate only as owner-hosted n8n on the user's Hostinger/Coolify or other approved self-hosted environment, not n8n Cloud, unless the user explicitly asks to evaluate n8n Cloud. Before designing, editing, importing, exporting, activating, executing, or touching n8n workflow material, apply `n8n-agent-rules`; keep reusable workflows inactive/unpublished by default; never store secrets in workflow JSON or repo files; and require explicit current-turn approval for live n8n actions.
- Common candidate names may be useful for search, but verify current official pricing and limits before recommending them. Examples include Supabase, Firebase, Clerk, Auth0, Neon, Turso, PlanetScale, Airtable, Baserow, HubSpot, Zoho, Google Sheets, Notion, Resend, Brevo, Postmark, Cloudflare, Vercel, Netlify, self-hosted n8n, Windmill, Activepieces, Directus, Strapi, Meilisearch, Typesense, Sentry, Grafana Cloud, and Uptime Kuma.
- Favor providers with clear free or low-cost entry, export paths, role/permission support, maintained SDKs, documented security controls, and usage alerts.
- Avoid providers that require broad client-side secrets, unclear data ownership, weak export paths, hidden overage risk, or security features locked behind a paid tier that the project cannot afford.
- For CRM-style needs, consider whether a simple hosted form plus spreadsheet/CRM table is enough before building a custom customer database and admin panel.
- Prefer providers that support owner-controlled budget alerts, quota alerts, usage APIs, or exportable usage reports. If those do not exist on the free/low-cost tier, call that out as an operational cost.

## Security Baseline To Preserve

- Signup, login, and forgot-password/reset-email flows need server-side rate limits.
- Account systems need email verification before meaningful account use when accounts can affect data, billing, messaging, automation, or abuse.
- State-changing forms/routes/actions need CSRF/session protection when the stack uses cookies or browser credentials.
- Public contact forms and email-sending flows need abuse throttles and safe generic errors.
- Browser code must not receive private API keys, database credentials, service-role keys, webhook secrets, Firebase service account JSON, or paid provider tokens.
- Public/anon client keys must be backed by RLS, Firebase Security Rules, scoped API routes, auth checks, and provider quotas.
- Traffic/security monitoring should use first-party logs, proxy/WAF events, rate-limit counters, and privacy-preserving telemetry before broad third-party trackers.
- AI-module observability should be metadata-only by default: attempt id, module name, provider/model identifier, status, latency, retry count, safe token or byte counts, failure taxonomy, output-shape validation, and the same visible error reference when a user-facing AI failure occurs. No raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, payment data, private connector data, private files, provider calls, notification tests, production mutations, or auto-remediation without explicit current-turn approval.
- User-facing unexpected failures should show generic public-facing copy with a support-safe, non-PII, non-secret, event/request-specific traceable error code/reference and no stack trace, raw provider error, private URL, request header, internal path, prompt, model response, or private payload. The same code/reference must appear in server-side logs or the approved logging backend for the exact backend log event or approved logging-backend entry.
- Product-facing and/or data-handling frontend apps should link Privacy Policy and Terms of Use pages from the app shell or footer, with final legal review called out before launch.

## Output

Return:

- A `Managed App Foundation Review` table with columns for capability, current custom plan, recommended decision, low-cost or owner-hosted candidates, security work avoided, remaining configuration, and cost caveat.
- A `Cut List` of custom work to remove or defer.
- A `Keep/Build List` for genuinely product-specific work.
- An `Upgrade Watch` list for each selected managed service: key quota, current/expected usage, warning threshold, read-only signal to inspect, review cadence, and owner-approved next action.
- A `Deployment And AI Observability Baseline` with daily PASS/WARN/FAIL signals, allowed metadata events, AI attempt ledger fields, failure taxonomy, and private-payload exclusions.
- An `Application Error And Privacy Baseline` covering generic user-facing error copy, visible error code/reference, server-side log linkage, GDPR/PDPA minimization, Privacy Policy and Terms of Use link requirements, and any owner-approved fallback/backwards-compatibility scope.
- A `Verify Before Commit` list of official pricing/docs, free-tier limits, export paths, and security settings to check before implementation.
- A `Security Still Required` list so managed-service adoption does not hide remaining rate-limit, CSRF, key-handling, backup, logging, and access-control work.

## Safety Boundary

Review-only by default. External account creation, provider configuration, DNS changes, production data migration, credentials, billing setup, deployment, or live-service mutation require explicit current-turn approval.
