# Stack Playbooks

Use these notes when the target stack is known. Prefer the project's existing conventions over new dependencies.

## React

- Keep component boundaries aligned with user tasks and reusable UI primitives.
- Prefer controlled state where it improves validation and predictability.
- Avoid unnecessary global state for local UI concerns.
- Memoize only when there is a measured render problem.
- Keep effects focused on synchronization with external systems.

## Next.js App Router

- Prefer server components for static or server-fetched UI.
- Use client components only for interactivity that needs browser APIs or local state.
- Keep loading, error, not-found, and empty states explicit.
- Avoid pushing secrets or private server data into client components.
- Check metadata, image handling, route boundaries, and streaming states.

## Tailwind CSS

- Use design tokens and semantic utility groupings consistently.
- Avoid one-off colour values when a token should exist.
- Keep responsive classes intentional and test small screens.
- Extract repeated patterns into project-appropriate components.
- Avoid style churn that fights the existing system.

## shadcn/ui

- Use existing primitives and variants before creating new ones.
- Keep Radix accessibility behavior intact.
- Extend variants through the local component pattern.
- Preserve focus rings, keyboard behavior, and ARIA attributes.
- Avoid replacing primitives with custom div-based controls.

## Radix UI

- Preserve focus management, portals, labels, and keyboard interactions.
- Keep controlled and uncontrolled usage consistent.
- Test dialogs, popovers, menus, tabs, and selects with keyboard navigation.
- Avoid styling that hides focus or disabled states.

## Framer Motion

- Use motion to clarify transitions, disclosure, reordering, and feedback.
- Keep durations short and easing calm.
- Respect reduced-motion preferences.
- Avoid motion that blocks input, delays task completion, or distracts from critical content.
- Do not animate sensitive confirmations in ways that obscure consequences.

## Charting libraries

- Choose charts that match the question: trend, comparison, composition, distribution, or relationship.
- Keep labels, units, time ranges, and filters visible.
- Provide accessible summaries for chart meaning.
- Avoid colour-only encoding.
- Handle empty, partial, stale, and loading data.
- Do not expose sensitive drill-down data by default.

## Forms and validation

- Keep client validation consistent with server validation.
- Use schema validation if the project already has it.
- Keep error copy actionable and close to the field.
- Preserve entered data after recoverable errors.
- Avoid exposing raw validation internals.
- Make destructive submits explicit and confirm when needed.

## Design tokens

- Define tokens for colour roles, typography, spacing, radius, border, elevation, motion, and z-index.
- Use semantic names such as `primary`, `surface`, `danger`, and `focus` instead of raw appearance names.
- Keep light and dark mode parity if the app supports themes.
- Document token changes when they affect shared UI.

## Accessibility testing

- Check keyboard-only navigation.
- Check visible focus and logical focus order.
- Check labels, headings, landmarks, and form descriptions.
- Check contrast in normal, hover, disabled, and error states.
- Check reduced-motion behavior.
- Use automated tools where available, but do not rely on automation alone.
