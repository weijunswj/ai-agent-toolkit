---
name: managed-app-foundation-review
description: Review an app implementation plan to decide whether to use low-cost or free managed providers instead of building auth, user accounts, databases, CRM/contact pipelines, admin dashboards, forms, email, storage, analytics, traffic/security monitoring, or account security from scratch. Use when the user asks to cut build scope, reduce security risk, compare build-vs-buy, choose managed services, or revisit a plan around CRM, accounts, databasing, signup/login/password reset, email verification, contact forms, or low-cost app foundations.
---

# Managed App Foundation Review

## Overview

Use this skill before implementation momentum turns common platform work into custom code. The goal is to cut scope and reduce security risk by choosing managed foundations where they are low-cost enough to justify the integration work.

Do not run a full provider search for every ordinary feature. Trigger the full review when the plan includes platform primitives such as auth, accounts, databases, CRM/contact records, forms, email, storage, admin dashboards, billing, analytics, traffic/security monitoring, or abuse prevention.

Keep the review practical: recommend building from scratch only when product constraints, data ownership, compliance, offline needs, cost at expected scale, or provider lock-in make managed services a poor fit.

## Core Rule

- Prefer managed, boring, well-maintained foundations for auth, accounts, password reset, email verification, database access controls, file storage, email sending, CRM/contact records, admin workflows, audit logs, traffic/security telemetry, and abuse controls.
- Do not treat a provider as secure by default. Identify the configuration still required: rate limits, email verification, RLS/security rules, least-privilege keys, webhook verification, CSRF/session settings, backup/restore, export path, and data retention.
- Do not claim current pricing, free-tier limits, feature availability, or compliance posture unless you have checked current official provider docs in this turn. If browsing is unavailable or not requested, state that pricing and limits must be verified before commitment.
- Do not create accounts, enter secrets, migrate data, modify DNS, configure production services, or write to external systems without explicit current-turn approval naming the provider and operation.

## Review Workflow

1. Inspect the current plan, repo, or requested feature list.
2. If the user has not already asked for managed alternatives, pause with a compact choice: explain that the feature can be built from scratch, but managed low-cost options may cut work and security risk; ask whether to compare them before implementing.
3. List the foundation capabilities being custom-built:
   - Auth, signup, login, password reset, email verification, MFA, roles, and sessions.
   - User/customer database, row permissions, storage, backups, and exports.
   - CRM/contact pipeline, lead capture, contact forms, support inbox, and customer notes.
   - Email sending, notifications, templates, unsubscribe, bounce handling, and abuse limits.
   - Admin dashboard, moderation queue, audit logs, traffic/security telemetry, and incident review.
   - Payments, billing, file uploads, search, analytics, and scheduled jobs when relevant.
4. For each capability, choose `buy`, `build`, `skip`, or `hybrid`.
5. Prefer low-cost managed candidates first, but compare total implementation cost: integration time, security configuration, limits at expected usage, export/migration path, vendor lock-in, and support burden.
6. Keep private secrets server-side. Public client keys are acceptable only when backed by provider rules, scoped policies, and quota controls.
7. Produce a cut list of custom work to remove from the plan.

## Provider Selection Guardrails

- Browse or otherwise verify current official pricing, free-tier limits, and security docs when making concrete provider recommendations. Prefer official pricing/docs/status pages over blogs, old comparison posts, or memory.
- If the user asks to minimize token or browsing cost, do a two-step review: first identify which capabilities are worth comparing, then browse only the official docs for the short-listed provider categories.
- Do not maintain exact provider pricing or "best tools this month" claims inside this skill. Any cached provider landscape doc must be dated, non-authoritative, and treated as a starting point that still requires current official verification before use.
- If a recurring GitHub Actions or scheduled review is proposed, keep it notification-only by default: open an issue or PR with links and human review prompts, do not auto-update recommendations, auto-copy vendor docs, auto-merge, or treat search results as approved source.
- Use provider categories before brand names when the exact vendor is not important: managed auth, hosted Postgres, serverless database, CRM/free contact pipeline, form backend, email API, object storage, analytics/security logs, or helpdesk.
- Common candidate names may be useful for search, but verify current official pricing and limits before recommending them. Examples include Supabase, Firebase, Clerk, Auth0, Neon, Turso, PlanetScale, Airtable, Baserow, HubSpot, Zoho, Google Sheets, Notion, Resend, Brevo, Postmark, Cloudflare, Vercel, and Netlify.
- Favor providers with clear free or low-cost entry, export paths, role/permission support, maintained SDKs, documented security controls, and usage alerts.
- Avoid providers that require broad client-side secrets, unclear data ownership, weak export paths, hidden overage risk, or security features locked behind a paid tier that the project cannot afford.
- For CRM-style needs, consider whether a simple hosted form plus spreadsheet/CRM table is enough before building a custom customer database and admin panel.

## Security Baseline To Preserve

- Signup, login, and forgot-password/reset-email flows need server-side rate limits.
- Account systems need email verification before meaningful account use when accounts can affect data, billing, messaging, automation, or abuse.
- State-changing forms/routes/actions need CSRF/session protection when the stack uses cookies or browser credentials.
- Public contact forms and email-sending flows need abuse throttles and safe generic errors.
- Browser code must not receive private API keys, database credentials, service-role keys, webhook secrets, Firebase service account JSON, or paid provider tokens.
- Public/anon client keys must be backed by RLS, Firebase Security Rules, scoped API routes, auth checks, and provider quotas.
- Traffic/security monitoring should use first-party logs, proxy/WAF events, rate-limit counters, and privacy-preserving telemetry before broad third-party trackers.

## Output

Return:

- A `Managed App Foundation Review` table with columns for capability, current custom plan, recommended decision, low-cost candidates, security work avoided, remaining configuration, and cost caveat.
- A `Cut List` of custom work to remove or defer.
- A `Keep/Build List` for genuinely product-specific work.
- A `Verify Before Commit` list of official pricing/docs, free-tier limits, export paths, and security settings to check before implementation.
- A `Security Still Required` list so managed-service adoption does not hide remaining rate-limit, CSRF, key-handling, backup, logging, and access-control work.

## Safety Boundary

Review-only by default. External account creation, provider configuration, DNS changes, production data migration, credentials, billing setup, deployment, or live-service mutation require explicit current-turn approval.
