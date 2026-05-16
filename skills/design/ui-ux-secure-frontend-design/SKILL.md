---
name: ui-ux-secure-frontend-design
description: Security-first frontend UI/UX design skill for creating, reviewing, and improving web interfaces. Use for design systems, landing pages, SaaS dashboards, forms, component planning, accessibility, responsive polish, privacy-safe UX, and implementation review.
---

# Secure UI/UX Frontend Design

## Overview

Use this instruction-only skill to create or review frontend web interfaces with a design-system-first process and security-first guardrails. Aim for polished, accessible, responsive, maintainable UI that protects users and avoids manipulative UX.

Load reference files only when useful:

- `references/design-system-workflow.md` for design system templates.
- `references/component-patterns.md` for common UI patterns.
- `references/frontend-quality-rubric.md` for scoring reviews.
- `references/privacy-security-safety.md` for high-risk surface gates.
- `references/stack-playbooks.md` for React, Next.js, Tailwind, shadcn/ui, charts, forms, and accessibility guidance.

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
- Never add third-party scripts, analytics, trackers, pixels, remote fonts, embeds, or external network calls without explicit approval.
- Never weaken auth, input validation, CSP, CORS, CSRF, cookie security, or role-based access control for visual convenience.
- Never recommend dark patterns, fake urgency, manipulative consent, hidden fees, deceptive opt-ins, or confusing unsubscribe flows.
- Prefer privacy-preserving defaults.
- Treat forms, dashboards, admin pages, file upload UI, automation UI, AI-agent controls, and n8n workflow screens as high-risk surfaces.
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
- Do not add dependencies, network calls, trackers, or remote assets unless the user approves.

## Workflow

1. Clarify product intent only if needed.
2. Inspect existing repo files before inventing new components.
3. Identify stack and constraints.
4. Create or infer a design system:
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
5. Produce page-level overrides:
   - Page goal.
   - Primary user action.
   - Content hierarchy.
   - Sections.
   - Components.
   - Empty/loading/error/success states.
   - Mobile behaviour.
   - Security/privacy notes.
6. Implement or recommend changes.
7. Run review checklist.
8. Report what changed, what was not changed, and remaining risks.

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

## Component planning

Plan components before implementation:

- Reuse existing components and tokens first.
- Name components by responsibility, not styling.
- Define props, states, variants, and responsive behavior.
- Include keyboard behavior and focus management for interactive components.
- Specify validation, error copy, and recovery paths for forms.
- Specify confirmation, undo, audit, and permission handling for destructive actions.
- Avoid components that require new dependencies unless approved.

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

- Auth/session UI: preserve secure session behavior, avoid exposing tokens or internal IDs, and make sign-out/account changes clear.
- Forms: keep validation, consent, rate limits, file limits, and safe error copy.
- Dashboards/admin: protect PII, use least-privilege display, add confirmation for destructive actions, and avoid leaking hidden operational data.
- Analytics/tracking: require explicit approval for new trackers, pixels, scripts, or external calls.
- AI-agent controls: make autonomy, permissions, data sources, and irreversible actions visible.
- n8n workflow screens: treat triggers, credentials, executions, webhooks, and active workflow changes as high-risk controls.
- Errors/logs/debug UI: do not expose stack traces, secrets, request headers, customer data, or private infrastructure details.
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
- Accessibility, responsive, performance, privacy, security, and safety gates reviewed.
- No secrets, private data, third-party scripts, trackers, remote assets, or new dependencies added without approval.
- Risky UI surfaces identified and safer alternatives proposed.
- Final response states what changed, what was not changed, validation run, and remaining risks.
