# Frontend Quality Rubric

Score each category from 1 to 5. Use the score to guide fixes, not to produce ceremony.

| Score | Meaning |
|---:|---|
| 1 | Blocking issue. The UI is confusing, inaccessible, unsafe, broken, or misleading. |
| 2 | Significant weakness. Users can proceed, but friction, risk, or inconsistency is high. |
| 3 | Acceptable baseline. Works, but needs polish or stronger edge-case handling. |
| 4 | Strong. Clear, consistent, accessible, responsive, and low-risk. |
| 5 | Excellent. Polished, resilient, privacy-safe, and clearly aligned with product goals. |

## Categories

| Category | What to check |
|---|---|
| Visual hierarchy | The page communicates priority through layout, type, spacing, and contrast. |
| Accessibility | Keyboard, focus, contrast, labels, headings, screen reader semantics, and reduced motion are handled. |
| Responsive behaviour | Mobile, tablet, laptop, and wide layouts avoid overflow, clipping, overlap, and unreachable controls. |
| Component consistency | Components reuse tokens, variants, spacing, states, and existing patterns. |
| Content clarity | Copy is honest, specific, scannable, and aligned with the user's task. |
| Interaction states | Hover, focus, active, disabled, loading, empty, error, success, and permission states are present. |
| Performance | The UI avoids unnecessary client work, heavy assets, layout shift, blocking resources, and excessive animation. |
| Privacy/security | Sensitive data, auth/session UI, forms, analytics, third-party scripts, and error states are safe. |
| Implementation maintainability | Code structure, component boundaries, names, tokens, and dependencies fit the existing stack. |
| Product conversion without dark patterns | The UI helps users decide without deception, fake urgency, hidden fees, forced opt-ins, or confusing cancellation. |

## Review output

Use this compact format:

```text
Overall: <score>/5

Top findings:
1. <category> - <issue> - <recommended fix>
2. <category> - <issue> - <recommended fix>
3. <category> - <issue> - <recommended fix>

Strengths:
- <what is working>

Remaining risks:
- <manual check or unresolved risk>
```

## Minimum bar before delivery

- No category below 3 unless the user explicitly accepts the risk.
- Privacy/security must be 4 or higher for auth, billing, admin, PII, file upload, AI-agent, and automation UI.
- Accessibility must be 4 or higher for public pages, forms, and core product workflows.
- Conversion improvements must not use dark patterns.
