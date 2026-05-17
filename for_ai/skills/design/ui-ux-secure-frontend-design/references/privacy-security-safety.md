# Privacy, Security, and Safety Gates

Use these gates before implementing or approving frontend changes on high-risk surfaces.

## Auth and session UI

- Do not expose tokens, session IDs, internal account IDs, or raw auth errors.
- Keep sign-in, sign-out, account switching, password reset, and MFA states clear.
- Preserve secure cookie, CSRF, CORS, CSP, and role-based access behavior.
- Avoid UI shortcuts that bypass permission checks.

## Forms

- Keep client validation aligned with server validation.
- Show actionable errors without leaking system details.
- Mark required fields clearly.
- Preserve consent and communication preferences.
- Avoid prechecked marketing opt-ins unless explicitly required and legally reviewed.

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
- Avoid stack traces, raw database errors, request headers, private URLs, secrets, or infrastructure names.
- Use generic public-facing copy and detailed server-side logs where appropriate.

## Logs and debug UI

- Hide debug panels in production unless explicitly authorized.
- Redact headers, cookies, tokens, PII, and private payloads.
- Avoid copy buttons for sensitive logs unless there is a clear safety reason.
- Make environment labels visible.

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
