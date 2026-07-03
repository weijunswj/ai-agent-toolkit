# DESIGN.md Contract Reference

Use this reference with the Secure UI/UX Frontend Design skill when a target app already has, or would benefit from, a `DESIGN.md` or `design.md` file.

This Toolkit reference is adapted from Google Labs `design.md`, tracked in `_projects/design/google-design-md/SOURCE-LOCK.json`. It is documentation/reference support only. It does not add the upstream CLI or any package tooling.

## What DESIGN.md Is

`DESIGN.md` is a plain-text design contract for coding agents. It can combine optional YAML front matter for machine-readable design tokens with Markdown sections that explain design rationale, visual identity, component intent, and practical do/don't guidance.

Treat it as a portable design-system contract that helps agents preserve visual direction across sessions and tools. The upstream format is alpha, so prefer conservative interpretation and manual review over strict automation.

## When To Read An Existing DESIGN.md

Read an existing `DESIGN.md` or `design.md` before changing frontend visuals, including colors, typography, spacing, radius, elevation, component variants, imagery, iconography, layout density, or page composition.

Use it alongside local implementation sources:

- Existing design-token files.
- CSS variables or theme files.
- Tailwind, shadcn/ui, Material, Chakra, or other framework config.
- Component libraries and style modules.
- Brand docs, screenshots, mockups, and product requirements.

Existing app tokens, CSS, theme config, and component code remain the implementation source of truth unless the user explicitly asks to convert or reconcile them. If `DESIGN.md` conflicts with shipped code or local docs, report the conflict and make the smallest change consistent with the requested task.

## When To Propose Or Create One

If no design contract exists, propose a `DESIGN.md` only when it would clearly reduce design drift, help multiple agents or contributors preserve a visual identity, or make repeated UI changes safer.

Create one only when it is useful and within the user's requested scope. Derive it from inspected local sources rather than inventing a full brand system from scratch. Keep it stack-neutral unless the target app's source of truth is already stack-specific.

Do not overwrite an existing `DESIGN.md` without explicit current-turn approval that names the file and operation.

## Safe Authoring Boundaries

When drafting or updating a `DESIGN.md`:

- Preserve existing app tokens and component contracts unless the user asked for a migration.
- Include token values only when they are public design values, not secrets or private data.
- Keep guidance stack-neutral by default. Do not lock the contract to Tailwind, CSS variables, or any one framework unless the app already uses that source of truth.
- Document component states, responsive behavior, accessibility constraints, and privacy/security boundaries when relevant.
- Keep generated or proposed content reviewable. Mark uncertain sections as draft instead of presenting them as verified source truth.

## Tooling Boundary

Do not run `npx @google/design.md`, install `@google/design.md`, add package scripts, fetch remote assets, call external validators, or use upstream executable tooling by default.

Those actions require explicit current-turn approval and must also be allowed by the target repo policy. Even with approval, keep the action local, narrow, documented, and separate from the instruction-first UI/UX skill unless the user asked for tooling integration.

## Not A Replacement For Readiness Checks

`DESIGN.md` is a design contract. It does not replace:

- Accessibility review and WCAG contrast checks.
- Privacy, consent, analytics, and data-display review.
- Auth, authorization, CSRF, CORS, CSP, cookie, and role-boundary checks.
- Form validation, rate limits, upload limits, and abuse protection.
- Production-readiness, test, or security validation.

Use it with the UI/UX skill's design-system workflow, local generator when appropriate, and security/privacy/accessibility gates.

