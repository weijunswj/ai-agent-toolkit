# Privacy, Security, and Safety Gates

Use these gates before implementing or approving frontend changes on high-risk surfaces.

## Auth and session UI

- Do not expose tokens, session IDs, internal account IDs, or raw auth errors.
- Keep sign-in, sign-out, account switching, password reset, and MFA states clear.
- Preserve secure cookie, CSRF, CORS, CSP, and role-based access behavior.
- Avoid UI shortcuts that bypass permission checks.
- Rate-limit signup, login, and forgot-password/reset-email flows on the server. Use IP and account/email based controls where appropriate, and keep error copy generic enough to avoid account enumeration.
- Require email verification after account creation before meaningful account use, posting, messaging, billing, automation, or access to sensitive data.
- Add step-up checks such as CAPTCHA, proof-of-work, MFA, temporary lockout, or manual review only when the product risk justifies the friction.

## Forms

- Keep client validation aligned with server validation.
- Show actionable validation errors without leaking system details. Unexpected failures must use generic public-facing copy such as `Something went wrong. Please try again. Contact support if this keeps happening. Error code: <code>.`
- Mark required fields clearly.
- Preserve consent and communication preferences.
- Avoid prechecked marketing opt-ins unless explicitly required and legally reviewed.
- Rate-limit public forms that send email, create records, call paid/provider APIs, or trigger automation. Use server-side IP and account/email limits where appropriate; do not rely only on disabled buttons or client-side cooldowns.
- Contact forms should avoid confirming whether a target mailbox, user, or tenant exists.

## Privacy notices and legal pages

- For product-facing and/or data-handling frontend apps, create or preserve linked Privacy Policy and Terms of Use pages in the app shell or footer when the app is public-facing or handles accounts, forms, uploads, analytics, AI, payments, user data, customer/business data, admin workflows, dashboards, or confidential business data.
- Privacy Policy and Terms of Use pages are not required for every isolated component, static UI experiment, internal throwaway mock, or non-product frontend-only task unless the task is intended for product use or handles user/business/confidential data.
- Keep legal pages visible from normal navigation or footer chrome; do not hide them only inside settings, source code, or a modal that is hard to rediscover.
- If final legal copy is unavailable, use clearly labelled draft owner/legal-review content only when appropriate and report that counsel or the owner must review the live Privacy Policy, Terms of Use, sub-processors, retention periods, deletion process, and cross-border transfer terms before launch.
- Treat GDPR and PDPA compliance as a product requirement, not a copywriting afterthought: minimize collection, document purposes, define retention/deletion expectations, provide a support/data-request path, and keep consent choices clear and reversible.

## CSRF and state-changing requests

- Keep CSRF protection on every state-changing form, route, action, and mutation.
- Preserve SameSite, Secure, HttpOnly, path, and domain cookie protections.
- Do not describe read-only pages as needing CSRF unless they trigger a state change, but verify that hidden autosave, tracking opt-ins, logout, webhook, billing, or account actions are protected.
- Do not weaken CSRF or cookie protections to work around a design, embed, cross-domain frame, or third-party script.

## Client-exposed keys and service configuration

- Never ship private API keys, database credentials, service-role keys, Firebase service account JSON, webhook secrets, or private provider tokens to browser code.
- OpenAI or other paid provider calls that require private keys should go through a server route, server action, edge function, or backend service with rate limits and quota controls.
- Supabase anon keys or Firebase public config are not secrets by themselves, but they must be backed by Row Level Security, Firebase Security Rules, scoped policies, auth checks, and provider-side quotas.
- Environment variables with public prefixes such as `NEXT_PUBLIC_`, `PUBLIC_`, `VITE_`, or runtime public config are browser-visible. Do not place secrets in them.

## File uploads

- Show accepted types, size limits, and privacy implications.
- Avoid previewing sensitive content by default.
- Keep malware scanning, moderation, and validation expectations visible when applicable.
- Make removal and replacement clear.

## Dashboards and admin

- Minimize PII by default.
- Redact or collapse sensitive columns.
- Use role-aware empty and permission-denied states.
- Require confirmation for destructive or broad changes.
- Prefer audit-friendly labels for high-impact actions.

## PII display

- Show only what the user needs to complete the task.
- Mask identifiers where full values are not necessary.
- Avoid exporting, copying, or logging sensitive data by default.
- Provide clear context when data is stale, incomplete, or user-generated.

## Analytics and tracking

- Do not add trackers, pixels, session replay, fingerprinting, or remote analytics without explicit approval.
- Prefer privacy-preserving analytics and aggregated metrics.
- Keep consent choices clear and reversible.
- Do not hide tracking in vague UI copy.
- For abuse investigation, prefer first-party access logs, proxy logs, WAF events, rate-limit counters, and minimal security telemetry over broad third-party tracking.
- Do not log request bodies, tokens, cookies, passwords, reset links, payment data, or unnecessary PII into analytics or traffic-tracking tools.

## AI-agent controls

- Show what the agent can read, write, send, delete, or execute.
- Separate draft, preview, approve, and execute states.
- Add confirmation for irreversible or external actions.
- Make logs and outputs safe to display.
- Do not expose hidden prompts, credentials, private connectors, or sensitive data.

## n8n workflow controls

- Treat triggers, webhook URLs, credentials, executions, activation toggles, and deletion as high-risk.
- Keep workflow activation explicit.
- Show environment context when available, such as local, staging, or production.
- Require confirmation for active workflow changes, destructive edits, credential changes, or execution actions.
- Do not display credential values or private webhook secrets.

## Error messages

- Say what the user can do next.
- Unexpected user-facing errors must be generic public-facing messages that do not reveal internals. Use wording like `Something went wrong. Please try again. Contact support if this keeps happening. Error code: <event-specific-code-or-reference>.`
- Generate a support-safe, non-PII, non-secret, event/request-specific error code or reference for unexpected failures. The same visible error code/reference must appear in detailed backend logs, server-side logs, or the approved logging backend for the exact backend log event. It must be unique enough to correlate the user-facing error to the exact backend log event or approved logging-backend entry, stable enough for the user to quote to support, and not revealing internals.
- Static-only codes such as `UNKNOWN_ERROR`, `INTERNAL_ERROR`, or `ERR_GENERIC` are not sufficient by themselves. They may appear in logs as failure taxonomy only when paired with a unique request id, event id, trace id, or error reference that is also present in backend logs and, for user-facing failures, visible to the user.
- Avoid stack traces, raw database errors, request headers, private URLs, secrets, or infrastructure names.
- Use generic public-facing copy and detailed server-side logs where appropriate.

## Logs and debug UI

- Hide debug panels in production unless explicitly authorized.
- Redact headers, cookies, tokens, PII, and private payloads.
- Keep logs GDPR/PDPA-aware and privacy-minimized: prefer metadata, failure taxonomy, route/action, status, latency, request id, provider/model, retry count, token or byte counts, and opaque or hashed user/account IDs only when needed for support, abuse prevention, billing, or security review.
- Do not log raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, payment data, reset links, private connector data, or long free-text/user-provided payloads unless the owner explicitly approves a reviewed retention and access-control plan.
- For AI features, log a metadata-only AI attempt ledger by default with provider, model, feature/module, status, latency, retry count, safe token/byte counts, failure taxonomy, output-shape diagnostics, and the same visible error reference when a user-facing AI failure occurs.
- Avoid copy buttons for sensitive logs unless there is a clear safety reason.
- Make environment labels visible.

## Fallbacks and backwards compatibility

- Do not add broad fallback behavior, silent fallback paths, or backwards compatibility shims by default.
- Ask the user before implementing fallbacks or backwards compatibility. If approved, keep the path narrow, visible, logged, tested, and documented with a removal or review condition.
- If a feature fails and no approved fallback exists, display the generic error with the error code/reference and log the detailed server-side diagnostics.

## Consent and unsubscribe flows

- Make opt-in and opt-out choices symmetric and clear.
- Do not use confusing labels, hidden fees, fake urgency, or shame copy.
- Make unsubscribe and cancellation flows easy to find.
- Confirm successful changes without adding friction.

## External scripts

- Require explicit approval before adding remote fonts, embeds, analytics, widgets, chat tools, maps, ads, or pixels.
- Explain the data that may leave the app.
- Prefer local assets and first-party controls.
- Check CSP impact and fallback behavior.

## CSP, CORS, and cookies

- Do not loosen CSP, CORS, SameSite, Secure, HttpOnly, or path/domain rules for visual convenience.
- Treat any UI change that requires security header changes as high risk.
- Ask for security review when a design depends on third-party frames or scripts.

## Dark-pattern ban

Do not recommend or implement:

- Fake scarcity or fake urgency.
- Hidden fees or unclear renewal terms.
- Deceptive opt-ins.
- Forced continuity.
- Confusing unsubscribe or cancellation flows.
- Shame copy.
- Obscured destructive consequences.
- Visual hierarchy that hides material terms.
