# Design System Workflow

Use this template when creating or inferring a design system before page or component work.

## Product summary

- Product:
- Category:
- Primary user problem:
- Primary user action:
- Business goal:
- Key constraints:

## User segments

| Segment | Need | Risk or accessibility concern |
|---|---|---|
| Primary users |  |  |
| Secondary users |  |  |
| Admin/operators |  |  |

## Brand adjectives

Choose 3-5 adjectives and translate them into UI decisions.

| Adjective | UI implication |
|---|---|
| Trustworthy | Clear hierarchy, calm colours, transparent copy, strong validation states. |
| Efficient | Dense but scannable layouts, predictable navigation, low-friction actions. |
| Premium | Refined spacing, restrained colour, high-quality imagery, deliberate motion. |

## Colour roles

Define roles before choosing individual component colours.

| Role | Token | Guidance |
|---|---|---|
| Background |  | App or page base. |
| Surface |  | Cards, panels, nav, popovers. |
| Text primary |  | Main readable text. |
| Text secondary |  | Supporting text with AA contrast. |
| Border |  | Dividers, inputs, panels. |
| Primary action |  | Main CTA and focus action. |
| Secondary action |  | Lower-priority actions. |
| Success |  | Confirmed positive state. |
| Warning |  | Needs attention, not failure. |
| Danger |  | Destructive or irreversible actions. |
| Info |  | Neutral guidance or system status. |
| Focus |  | Keyboard focus ring. |
| Disabled |  | Disabled controls while preserving readability. |

## Typography scale

| Use | Guidance |
|---|---|
| Display | Use sparingly for true hero or campaign moments. |
| Page heading | Clear page identity and task context. |
| Section heading | Scannable grouping inside pages. |
| Body | Comfortable reading and form guidance. |
| Label | Inputs, controls, compact metadata. |
| Caption | Secondary metadata without becoming illegible. |
| Code | Tokens, IDs, snippets, or technical values only when safe to display. |
| Numeric data | Align and format consistently for tables and charts. |

## Spacing scale

- Use a small consistent scale, such as 4, 8, 12, 16, 24, 32, 48, and 64.
- Use tighter spacing for dense admin tools and wider spacing for marketing pages.
- Keep related labels, fields, errors, and helper text visually grouped.
- Avoid card nesting. Use sections, tables, tabs, or panels instead.

## Radius and elevation

- Define a default radius for controls and panels.
- Reserve larger radius for major surfaces only if it matches the product tone.
- Use shadows to clarify layering, not as decoration.
- Prefer borders and background contrast for dense dashboards.

## Component state rules

Every interactive component should define:

- Default.
- Hover.
- Focus.
- Active/pressed.
- Disabled.
- Loading.
- Selected/current.
- Error.
- Success.
- Permission denied or unavailable when relevant.

## Layout rules

- Define page max width, content grid, sidebar width, gutter, and breakpoints.
- Keep primary navigation predictable.
- Put destructive actions away from routine primary actions.
- Give dashboards a clear summary-to-detail flow.
- Ensure tables and charts remain usable on small screens.

## Accessibility rules

- Meet WCAG AA contrast for text and essential UI.
- Use semantic headings in order.
- Ensure every control has a label or accessible name.
- Preserve keyboard navigation and visible focus.
- Do not rely on colour alone for state.
- Respect reduced-motion preferences.

## Motion rules

- Use motion to explain change, not to distract.
- Keep standard transitions short.
- Avoid motion on critical tasks that can cause accidental input.
- Provide reduced-motion alternatives.

## Security and privacy notes

- Identify high-risk surfaces: auth, billing, admin, PII, file uploads, AI controls, automation controls, and workflow execution UI.
- Minimize sensitive data display.
- Redact private values by default.
- Avoid adding external scripts, remote fonts, trackers, or embeds without approval.
- Keep consent clear and reversible.
- Do not expose internal IDs, tokens, secrets, stack traces, or private logs in UI.
