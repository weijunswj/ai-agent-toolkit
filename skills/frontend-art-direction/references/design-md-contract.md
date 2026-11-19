# DESIGN.md Contract Reference

Use this reference with the Secure UI/UX Frontend Design skill when a target app already has, or would benefit from, a `DESIGN.md` or `design.md` file.

This Toolkit reference is adapted from Google Labs `design.md`, tracked in `repo/source-watch/provenance/google-design-md/SOURCE-LOCK.json`. It is documentation/reference support only. It does not add the upstream CLI or any package tooling.

## What DESIGN.md Is

`DESIGN.md` is a plain-text design contract for coding agents. It combines machine-readable YAML design tokens with Markdown sections that explain design rationale, visual identity, component intent, and practical do/don't guidance.

Treat it as a portable design-system contract that helps agents preserve visual direction across sessions and tools. The upstream format is alpha, so prefer conservative interpretation and manual review over strict automation.

The tokens may also declare sections that are intentionally omitted from a design system. An `omitted` declaration describes the contract's scope; it does not replace missing token values or ask an agent to invent them.

## Where Tokens Live

Tokens can sit in YAML front matter at the top of the file (between two `---` lines), in interleaved fenced `yaml` code blocks inside the relevant sections, or both. Read every block: they merge into one design token tree, so a file with no front matter can still define tokens. Defining the same top-level key in more than one block is an error; report it rather than picking one.

## Section Order

All sections use `##` headings. Sections may be left out, but those present follow this order:

1. **Overview** (also "Brand & Style")
2. **Colors**
3. **Typography**
4. **Layout** (also "Layout & Spacing")
5. **Elevation & Depth** (also "Elevation")
6. **Shapes**
7. **Motion & Micro-interaction** (also "Motion & Micro-interactions", "Motion")
8. **Voice & Content Strategy**
9. **Components**
10. **Do's and Don'ts**

Preserve unknown section headings. Two sections with the same heading make the file invalid.

## Motion Tokens

`motion` maps purpose-named tokens, such as `state-change`, `surface-enter` and `surface-exit`, to timing values:

```yaml
motion:
  <token-name>: <Motion>
```

Each Motion token has `duration` and `delay` (a Duration: a string ending in `ms`, such as `150ms`) and `timingFunction` (a CSS easing such as `ease-out` or `cubic-bezier(...)`). Unknown motion token names are valid motion. The section's prose should say what moves and what does not, keep small changes faster than large transitions, honour `prefers-reduced-motion`, and prefer animating `transform` and `opacity`.

## Voice & Content Strategy

This section is prose only. It sets tone of voice, capitalisation, canonical terminology, button and action label grammar, empty, loading and error state copy, and number, date and unit formats. Follow it when writing interface copy.

## Optional Omitted Sections

`omitted` is an optional array of sections that are intentionally omitted from the design system:

```yaml
omitted: <string[]|OmittedSection[]> # optional
```

Each entry can be either:

- A string naming the omitted section, such as `spacing` or `motion`.
- An object of the form `{ section: string, reason?: string }`, where `section` names the omitted section and the optional `reason` documents why it does not apply.

For example:

```yaml
omitted:
  - spacing
  - section: rounded
    reason: "No rounded corners defined in brand book"
```

The `reason` field is optional. A string entry intentionally carries no reason; when a reason is supplied, it should explain the project-specific omission without pretending to define that section. The declaration may suppress compatible linter warnings for missing sections, but this Toolkit reference is documentation-only and does not add or run the upstream linter.

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
- Use `omitted` only for sections that are intentionally outside the contract. Keep any supplied `reason` concise and specific to the project.
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
