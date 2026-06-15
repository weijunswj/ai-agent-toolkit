# Managed App Foundation Review

Small planning skill for deciding whether to use low-cost managed providers for auth, user accounts, databases, CRM, forms, email, storage, analytics, and admin workflows instead of building those surfaces from scratch.

## Use This Skill For

- Revisit an implementation plan and cut custom auth, database, CRM, admin, form, email, or analytics work where a managed provider is safer and cheaper.
- Compare build-vs-buy options before implementing account systems, contact pipelines, customer records, password reset, email verification, file storage, traffic/security telemetry, or admin dashboards.
- Produce a low-cost or free-tier-first foundation plan with clear remaining security responsibilities.
- Ask whether to compare managed options before building common platform primitives from scratch, then verify current official pricing and docs when concrete provider recommendations are needed.

## Not For

- Do not use for ordinary feature implementation after the foundation decision is already made.
- Do not claim current provider pricing, free-tier limits, or plan features without checking official sources.
- Do not create provider accounts, enter secrets, migrate production data, change DNS, or configure live services without explicit current-turn approval naming the target operation.

## Expected Output

Return a compact Managed App Foundation Review with a build/buy/skip/hybrid table, low-cost provider candidates, security work avoided, remaining security tasks, cost caveats, and a cut list for custom work that should not be built from scratch.
