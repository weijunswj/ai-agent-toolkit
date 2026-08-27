# Component Patterns

Use these patterns as implementation planning guidance. Reuse existing project components before inventing new ones.

## Navigation

- Keep primary navigation stable and predictable.
- Show the current location.
- Use breadcrumbs for deep admin or settings flows.
- Make mobile navigation reachable, keyboard accessible, and dismissible.
- Avoid hiding important security or billing destinations.

## Hero sections

- State the product, audience, and primary value quickly.
- Use one clear primary action and one optional secondary action.
- Support trust with concrete proof, not fake urgency.
- Keep text readable over imagery.
- Avoid decorative effects that slow first paint or reduce contrast.

## Feature sections

- Group features by user outcome.
- Use consistent icon, heading, text, and action structure.
- Prefer specific benefits over generic claims.
- Avoid overloading the page with repeated cards.

## Pricing

- Make plan differences scannable.
- Surface material limits, billing cadence, renewal terms, and cancellation implications.
- Do not hide fees or preselect upgrades deceptively.
- Make primary CTA labels honest.

## Forms

- Use labels, helper text, validation, and errors close to the field.
- Keep required and optional fields clear.
- Preserve autofill and password manager support.
- Avoid disabling submit without explaining why.
- Provide success and recovery states.

## Tables

- Prioritize columns by task.
- Support sort, filter, pagination, and empty states when data is complex.
- Keep row actions predictable and permission-aware.
- Use responsive strategies: stacked rows, priority columns, horizontal scroll, or summary cards.
- Mask sensitive values by default when full display is not needed.

## Cards

- Use cards for repeated items, not every page section.
- Keep one primary idea or action per card.
- Avoid nested cards.
- Ensure hover effects do not imply unavailable actions.

## Dashboards

- Start with summary metrics, then trends, then details.
- Define stale, loading, empty, and error states.
- Explain unusual spikes or missing data where possible.
- Keep filters visible and resettable.
- Avoid exposing PII in default views.

## Modals and drawers

- Use modals for focused decisions and confirmations.
- Use drawers for contextual detail that benefits from staying near the parent page.
- Trap focus correctly and restore focus on close.
- Avoid modals for long multi-step workflows.
- Make destructive confirmations explicit.

## Toasts and alerts

- Use toasts for transient confirmation.
- Use inline alerts for persistent or blocking information.
- Provide recovery actions when possible.
- Do not rely on colour alone.

## Empty states

- Explain why the state is empty.
- Provide the next best action.
- Avoid blaming the user.
- Do not reveal private data or permission details.

## Loading states

- Use skeletons for predictable layouts.
- Use progress indicators for longer operations.
- Avoid layout shift.
- Disable risky duplicate actions during submission.

## Error states

- State what failed and what the user can try.
- Keep raw technical details out of public UI.
- Provide retry, contact, or fallback options when appropriate.
- Preserve entered form data where safe.

## AI chat panels

- Make data sources and agent capability clear.
- Separate drafting from sending or executing.
- Show citations or evidence when possible.
- Provide stop, retry, edit, and clear controls.
- Redact sensitive data in visible logs and transcripts.

## Workflow builders

- Distinguish draft, test, active, paused, and failed states.
- Make triggers and external side effects visible.
- Add confirmation for activation, deletion, credential changes, and executions.
- Provide validation before activation.
- Keep error routing and retry behavior understandable.

## n8n-like automation screens

- Treat webhook URLs, credentials, workflow IDs, execution payloads, and activation toggles as sensitive.
- Keep credentials referenced by name only, never by secret value.
- Show environment labels when available.
- Prefer inactive defaults for newly created workflows unless the user explicitly asks otherwise.
- Provide audit-friendly copy for destructive or production-impacting actions.
