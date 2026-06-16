<!--
Generated from toolkit project source. Do not edit directly.
Project: development.managed-app-foundation-review
Source: _projects/development/managed-app-foundation-review/_main/skill/README.md
Update the project source and run sync.
-->
# Managed App Foundation Review

Small planning skill for deciding whether to use low-cost, free, managed, or owner-hosted foundations for auth, user accounts, backend APIs, databases, workflows/automation, CRM, forms, email, storage, analytics, usage-limit alerts, ops, and admin workflows instead of building those surfaces from scratch.

## Use This Skill For

- Revisit an implementation plan and cut custom auth, database, backend service, workflow automation, CRM, admin, form, email, analytics, observability, or ops work where a managed or owner-hosted foundation is safer and cheaper.
- Compare build-vs-buy options before implementing account systems, contact pipelines, customer records, password reset, email verification, file storage, backend APIs, scheduled jobs, webhooks, traffic/security telemetry, or admin dashboards.
- Consider self-hosted n8n on Hostinger/Coolify for suitable internal workflow automation, while applying `n8n-agent-rules` before any n8n workflow design, JSON, import/export, activation, execution, credentials, or live-instance work.
- Produce a low-cost or free-tier-first foundation plan with clear remaining security responsibilities.
- Define upgrade-watch thresholds so Codex can later suggest cleanup, optimization, or owner-approved upgrades when usage approaches free/low-cost limits.
- Define privacy-safe deployment and AI-module observability before go-live, using daily PASS/WARN/FAIL summaries, event allowlists, AI attempt ledger metadata, failure taxonomy, and output-shape diagnostics without raw prompts, uploads, model responses, secrets, auth headers, cookies, or private connector data.
- Ask whether to compare managed options before introducing or materially changing common platform primitives, then verify current official pricing and docs when concrete provider recommendations are needed.

## Not For

- Do not use for ordinary feature implementation after the foundation decision is already made.
- Do not interrupt small follow-up implementation tasks when the repo or thread already records the foundation decision.
- Do not use this skill to bypass n8n safety rules. n8n workflow work still belongs under `n8n-agent-rules`, and live n8n actions require explicit current-turn approval.
- Do not claim current provider pricing, free-tier limits, or plan features without checking official sources.
- Do not create provider accounts, enter secrets, migrate production data, change DNS, configure live services, change billing, or upgrade paid plans without explicit current-turn approval naming the target operation.

## Expected Output

Return a compact Managed App Foundation Review with a build/buy/skip/hybrid table, low-cost or owner-hosted foundation candidates, security work avoided, remaining security tasks, cost caveats, upgrade-watch thresholds, privacy-safe deployment/AI observability baseline, and a cut list for custom work that should not be built from scratch.
