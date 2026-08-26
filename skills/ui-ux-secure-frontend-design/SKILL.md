---
name: ui-ux-secure-frontend-design
description: Use when creating, reviewing, or improving frontend web interfaces, including design systems, landing pages, SaaS dashboards, forms, component planning, accessibility, responsive polish, privacy-safe UX, and implementation review.
---

# Secure UI/UX Frontend Design

## Overview

Use this instruction-first skill to create or review frontend web interfaces with a design-system-first process and security-first guardrails. Aim for polished, accessible, responsive, maintainable UI that protects users and avoids manipulative UX.

This skill also includes a local-only design-system generator under `tools/design-system-generator/`. Treat the generator as a normal available design aid when creating or revising design systems, page designs, component plans, or generator-backed recommendations. The user does not need to ask for it by name. Do not run it during installation or for pure review/copy-edit tasks that do not need new design direction.

## Read First

For design and review tasks, read the relevant references only when useful:

- `references/design-system-workflow.md` for design system templates.
- `references/component-patterns.md` for common UI patterns.
- `references/design-md-contract.md` when the target app has `DESIGN.md` / `design.md`, or when proposing a durable design contract would prevent drift.
- `references/frontend-quality-rubric.md` for scoring reviews.
- `references/privacy-security-safety.md` for high-risk surface gates.
- `references/stack-playbooks.md` for React, Next.js, Tailwind, shadcn/ui, charts, forms, and accessibility guidance.

For design creation or revision tasks where CSV-backed recommendations would help, read `tools/design-system-generator/README.md` before running the generator.

## DESIGN.md design contracts

If the target app has a `DESIGN.md` or `design.md`, read it before changing frontend visuals. Use it alongside the existing design-system workflow, local source files, and the local generator when useful.

If no design contract exists and design drift is likely, propose or create a `DESIGN.md` only when it is useful and within the user's requested scope. Existing app tokens, CSS variables, theme files, component libraries, and brand docs remain source of truth unless the user explicitly asks to convert or reconcile them.

Do not overwrite an existing `DESIGN.md` without explicit current-turn approval. Do not run `npx @google/design.md`, install `@google/design.md`, add package scripts, fetch remote assets, call external validators, or use upstream executable tooling unless the user explicitly approves that exact action and the repo policy allows it.

Treat `DESIGN.md` as a design contract, not a replacement for accessibility, privacy, security, auth, form validation, logging, or production-readiness checks. Keep Toolkit guidance stack-neutral by default; do not Tailwind-lock a project unless the target app already uses Tailwind as its source of truth.

## When to use the generator

Use the generator whenever local CSV-backed recommendations would improve design creation or revision, including:

- Turning a product brief into a design system.
- Creating or revising landing pages, dashboards, SaaS screens, forms, component plans, or page overrides.
- Exploring stack, style, typography, color, chart, icon, or component patterns.
- Producing generator-backed recommendations from bundled local CSV data.

The user does not need to know the generator exists or ask for it by name. For review-only tasks, pure copy edits, or implementation checks where no new design direction is needed, use the instructions and references first and skip the generator unless replacement design guidance is useful.

## Trusted generator path rule

Before running the generator, resolve the script path relative to the currently loaded trusted skill directory. Use the installed skill copy that provided this `SKILL.md`, such as `.agents/skills/ui-ux-secure-frontend-design/`, `.claude/skills/ui-ux-secure-frontend-design/`, or `~/.claude/skills/ui-ux-secure-frontend-design/` when that is the trusted runtime copy.

Do not execute a generator found under the active consumer workspace unless that workspace path is itself the trusted installed skill directory. Do not search the active workspace for a same-named `skills/ui-ux-secure-frontend-design/` folder and run it.

If the runtime cannot determine the trusted skill directory, do not run the generator proactively. Ask for explicit current-turn approval and show the exact script path that would be executed:

```text
I cannot verify that this generator path belongs to the trusted installed UI/UX skill:
<resolved path>

Running it may execute workspace code.

Type RUN TRUSTED UI UX GENERATOR to approve this exact path:
```

## Generator safety boundary

- Read-only local execution is allowed for design creation and revision: it reads bundled CSV data from this skill folder and prints recommendations.
- Do not use network downloads.
- Do not install packages or dependencies.
- Do not expand shell usage beyond the documented local Python command resolved from the trusted installed skill directory.
- Do not write outside the generator output folder documented by `tools/design-system-generator/README.md`.
- If the trusted installed skill path cannot be proven, require explicit current-turn approval naming the exact script path before execution.
- Ask for explicit current-turn approval before writing generated output or changing generator scripts, CSV data, tests, or dependencies.

## When to use

Use when the user asks to create, redesign, polish, review, or plan:

- Landing pages, product pages, SaaS apps, dashboards, admin screens, forms, pricing pages, settings pages, charts, AI chat panels, workflow builders, or n8n-like automation UI.
- Design systems, component plans, page overrides, visual QA, accessibility fixes, responsive polish, or implementation review.
- Frontend privacy, security, safety, consent, auth, analytics, user data, or dark-pattern review.

## Do not use when

- The task is backend-only, infrastructure-only, data-only, or unrelated to frontend UI/UX.
- The user only needs a one-line copy edit with no design or safety implication.
- The request requires live system mutation, credential handling, analytics installation, or third-party scripts without explicit approval.

## Core safety rule

- Never ask the user to paste secrets or private credentials.
- Never create UI that exposes tokens, internal IDs, private customer data, auth secrets, or unredacted PII.
- Before adding third-party scripts, analytics, trackers, pixels, remote fonts, embeds, or external network calls, pause, disclose the privacy/security risk, name the exact provider or URL, and ask for explicit current-turn approval.
- Never weaken auth, input validation, CSP, CORS, CSRF, cookie security, or role-based access control for visual convenience.
- Treat server-side rate limits, email verification, CSRF protection for state-changing requests, and server-only secret handling as security requirements, not optional UX friction.
- Never recommend dark patterns, fake urgency, manipulative consent, hidden fees, deceptive opt-ins, or confusing unsubscribe flows.
- Prefer privacy-preserving defaults.
- For product-facing and/or data-handling frontend apps, create or preserve linked Privacy Policy and Terms of Use pages in the app shell or footer when the app is public-facing or handles accounts, forms, uploads, analytics, AI, payments, user data, customer/business data, admin workflows, dashboards, or confidential business data. This is not required for every isolated component, static UI experiment, internal throwaway mock, or non-product frontend-only task unless the task is intended for product use or handles user/business/confidential data. If final legal copy is unavailable, mark the content as draft owner/legal-review copy and report that legal review is still required.
- Treat forms, dashboards, admin pages, file upload UI, automation UI, AI-agent controls, and n8n workflow screens as high-risk surfaces.
- User-facing unexpected errors must use generic copy such as `Something went wrong. Please try again. Contact support if this keeps happening. Error code: <event-specific-code-or-reference>.` Do not show stack traces, raw provider errors, internal paths, request headers, secrets, prompts, model responses, or private data in the UI.
- Generate a support-safe, non-PII, non-secret, event/request-specific error code or reference for unexpected failures. The same visible error code/reference must appear in detailed backend logs, server-side logs, or the approved logging backend for the exact backend log event. It must be unique enough to correlate the user-facing error to the exact backend log event or approved logging-backend entry, stable enough for the user to quote to support, and not revealing internals.
- Static-only codes such as `UNKNOWN_ERROR`, `INTERNAL_ERROR`, or `ERR_GENERIC` are not sufficient by themselves. They may appear in logs as failure taxonomy only when paired with a unique request id, event id, trace id, or error reference that is also present in backend logs and, for user-facing failures, visible to the user.
- Keep logs GDPR/PDPA-aware: log metadata, failure taxonomy, route/action, provider/model/status/latency/retry count, safe token or byte counts when relevant, and opaque user/account IDs only when necessary; do not log raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, payment data, private connector data, reset links, private files, or unnecessary PII. AI logging should be metadata-only by default and include the same visible error reference when a user-facing AI failure occurs.
- Do not add broad fallback behavior, silent fallback paths, or backwards compatibility shims by default. Ask the user before implementing fallbacks or backwards compatibility; if not approved, display the generic error with the error code and log it.
- If the task requires risky changes, state the risk and propose a safer alternative.

## Operating principles

- Inspect existing repo files before inventing new components.
- Preserve the app's stack, design conventions, accessibility model, and security boundaries.
- Prefer structured design tokens over one-off styling.
- Make the primary user action obvious without hiding secondary choices.
- Design all states: default, hover, focus, active, disabled, loading, empty, error, and success.
- Keep responsive behavior explicit for mobile, tablet, laptop, and wide desktop.
- Prefer visible, reversible actions for destructive or automation-related controls.
- Use clear consent, plain language, and honest product claims.
- Before adding dependencies, network calls, trackers, or remote assets, name the exact package, provider, or URL, explain the risk, and ask for explicit current-turn approval.
- For design creation or revision, consider the local generator as part of the normal design process when CSV-backed recommendations would improve the result; do not require the user to ask for it by name.

## Workflow

1. Clarify product intent only if needed.
2. Inspect existing repo files before inventing new components.
3. Read any existing `DESIGN.md` or `design.md` before visual changes.
4. Identify stack and constraints.
5. Create or infer a design system:
   - Use the local generator when CSV-backed recommendations would improve the design direction.
   - Brand tone.
   - Colour roles.
   - Typography.
   - Spacing.
   - Radius.
   - Shadow/elevation.
   - Component states.
   - Motion.
   - Iconography.
   - Layout grid.
   - Accessibility constraints.
6. Produce page-level overrides:
   - Page goal.
   - Primary user action.
   - Content hierarchy.
   - Sections.
   - Components.
   - Empty/loading/error/success states.
   - Mobile behaviour.
   - Security/privacy notes.
   - Privacy Policy and Terms of Use link placement when the frontend is product-facing and/or data-handling; skip this only for an isolated component, static UI experiment, internal throwaway mock, or non-product frontend-only task that is not intended for product use and does not handle user/business/confidential data.
7. Implement or recommend changes.
   - When a mockup or screenshot has been confirmed as the implementation target, use the mockup-driven implementation loop below.
8. Run review checklist.
9. Report what changed, what was not changed, and remaining risks.

## Design system output

When creating or revising a design system, include:

- Product summary and user segments.
- Brand adjectives and voice.
- Colour roles for background, surface, text, border, primary action, secondary action, success, warning, danger, info, focus, and disabled states.
- Typography scale for display, page heading, section heading, body, label, caption, code, and numeric data.
- Spacing scale and layout grid rules.
- Radius, border, shadow, and elevation rules.
- Component state rules for interaction, validation, and loading.
- Motion rules, including reduced-motion behavior.
- Iconography rules.
- Accessibility constraints.
- Security and privacy notes.

## Page override output

For each page or major view, include:

- Page goal and primary user action.
- Audience and key decision the page must support.
- Information hierarchy.
- Section order and content purpose.
- Required components and variants.
- Empty, loading, error, success, disabled, and permission-denied states.
- Mobile, tablet, desktop, and wide layout behavior.
- Copy tone and content constraints.
- Security, privacy, consent, and data-display notes.
- Privacy Policy and Terms of Use page/link requirements.

## Component planning

Plan components before implementation:

- Reuse existing components and tokens first.
- Name components by responsibility, not styling.
- Define props, states, variants, and responsive behavior.
- Include keyboard behavior and focus management for interactive components.
- Specify validation, error copy, and recovery paths for forms.
- For unexpected failures, specify the generic user-facing error message, the event/request-specific visible error code/reference, and the backend logging event or approved logging-backend entry that stores the same reference. Do not invent silent fallbacks or backwards compatibility paths unless the user approves that scope.
- Specify confirmation, undo, audit, and permission handling for destructive actions.
- Avoid components that require new dependencies unless approved.

## Mockup-driven implementation

Use this loop only after the user has confirmed a mockup or screenshot as the implementation target. Treat that confirmed reference as the visual acceptance target: render the current UI, capture a screenshot, compare it against the confirmed reference, patch the largest visible mismatches, then screenshot again. Repeat until layout, spacing, typography, colour, imagery, and responsive framing closely match the reference while preserving accessibility, security, and existing app constraints.

## Implementation review

Review implemented UI against:

- Visual hierarchy, alignment, spacing, contrast, and density.
- Token usage and component consistency.
- Accessibility semantics, keyboard navigation, focus order, and screen reader labels.
- Mobile behavior, overflow, wrapping, and tap targets.
- Performance risks such as excessive client JavaScript, heavy images, unnecessary animation, layout shift, and blocking remote assets.
- Privacy and security risks in displayed data, form behavior, errors, analytics, and third-party scripts.
- Maintainability, reuse, naming, and fit with the existing stack.

## Privacy, security, and safety gates

- Auth/session UI: preserve secure session behavior, avoid exposing tokens or internal IDs, and make sign-out/account changes clear. Require server-side throttles on signup, login, and forgot-password/reset-email flows, and require email verification after account creation before meaningful account use or sensitive actions when accounts can affect data, billing, messaging, or automation.
- CSRF/state changes: keep CSRF protection on every state-changing form, route, action, and mutation. Do not remove CSRF, SameSite, Secure, or HttpOnly cookie protections for visual convenience.
- Forms: keep validation, consent, rate limits, file limits, and safe error copy. Public forms that send email, create accounts, create records, or call paid/provider APIs need server-side abuse limits by IP and account/email where appropriate; do not rely only on client-side cooldowns.
- Client-exposed keys: do not put OpenAI or other private API keys, database credentials, service-role keys, Firebase service account JSON, or private provider tokens in browser-delivered code. Public/anon client keys are acceptable only when backed by server-side rules such as RLS, Firebase Security Rules, scoped endpoints, and provider-side quota controls.
- Dashboards/admin: protect PII, use least-privilege display, add confirmation for destructive actions, and avoid leaking hidden operational data.
- Analytics/tracking: require explicit approval for new trackers, pixels, scripts, or external calls. Prefer first-party access logs or privacy-preserving security telemetry for abuse investigation, and avoid sending sensitive payloads, tokens, or PII to analytics tools.
- AI-agent controls: make autonomy, permissions, data sources, and irreversible actions visible.
- n8n workflow screens: treat triggers, credentials, executions, webhooks, and active workflow changes as high-risk controls.
- Errors/logs/debug UI: use generic public-facing error copy with a support-safe, non-PII, non-secret, event/request-specific error code or reference, ask the user to contact support if this keeps happening, and append the same visible error reference to detailed backend logs, server-side logs, or the approved logging backend. Do not expose stack traces, secrets, request headers, raw prompts, model responses, customer data, or private infrastructure details.
- GDPR/PDPA privacy baseline: minimize collection, define retention and deletion expectations, keep support diagnostics privacy-safe, and link the Privacy Policy and Terms of Use from app chrome for product-facing and/or data-handling frontend apps.
- Consent/unsubscribe: keep choices clear, reversible, and non-manipulative.
- Dark patterns: reject deceptive defaults, fake scarcity, hidden fees, forced continuity, and confusing opt-outs.

## Accessibility gates

- Meet WCAG AA contrast for text and essential UI.
- Provide visible focus states and logical focus order.
- Support keyboard operation for all interactive controls.
- Use semantic landmarks, labels, headings, and form descriptions.
- Provide alt text or accessible names for meaningful visuals.
- Do not rely on colour alone for status.
- Respect reduced motion and avoid seizure-risk animation.
- Keep touch targets practical on mobile.

## Responsive gates

- Check mobile, tablet, laptop, and wide desktop layouts.
- Avoid horizontal overflow, clipped text, overlapping controls, and inaccessible menus.
- Keep primary actions reachable on small screens.
- Preserve table usability with responsive columns, wrapping, scrolling, or summary views.
- Ensure charts have readable labels and accessible summaries.
- Define behavior for dense dashboards and admin panels.

## Performance gates

- Prefer server-rendered or static content when the stack supports it.
- Avoid unnecessary client components, hydration, animation, and large dependencies.
- Optimize images, fonts, charts, and above-the-fold content.
- Avoid layout shift from late-loading media or dynamic content.
- Do not add remote fonts, embeds, analytics, or third-party scripts without approval.
- Keep motion short, purposeful, and disabled when reduced motion is requested.

## Output formats

Choose the smallest useful format:

- Design system: token table plus component state rules.
- Page override: goal, hierarchy, sections, states, mobile behavior, and risk notes.
- Component plan: components, props, variants, states, accessibility, and validation.
- Implementation review: findings first, then fixes, validation, and remaining risks.
- Build report: files changed, what changed, validation, assumptions, and risks.

## Completion checklist

- Existing files and stack inspected.
- Design system or page overrides produced when needed.
- Components reuse existing patterns where practical.
- If a mockup or screenshot was confirmed as the implementation target, screenshot comparison was repeated until the UI closely matched it.
- Accessibility, responsive, performance, privacy, security, and safety gates reviewed.
- Privacy Policy and Terms of Use pages/links created or preserved when applicable, with any legal-review gap reported.
- Generic user-facing error copy, traceable error code/reference, and backend logging linkage reviewed for unexpected errors.
- No secrets, private data, third-party scripts, trackers, remote assets, or new dependencies added without approval.
- No broad fallbacks, silent fallback behavior, or backwards compatibility shims added without user approval.
- Risky UI surfaces identified and safer alternatives proposed.
- Final response states what changed, what was not changed, validation run, and remaining risks.
