---
name: self-hosted-service-safety
description: Use when reviewing or planning non-n8n self-hosted service setup, Docker Compose services, VPS deployment notes, reverse proxies, public ports, DNS/TLS, tunnels, admin panels, backups, or first-run hardening. Do not use for ordinary app coding, local-only dev servers, or n8n work.
---

<!--
Generated from toolkit project source. Do not edit directly.
Project: development.self-hosted-service-safety
Source: _projects/development/self-hosted-service-safety/_main/skill/SKILL.md
Update the project source and run sync.
-->
# Self-Hosted Service Safety

## Overview

Review self-hosted service setup plans before exposing services, running deployment commands, changing Docker/VPS configuration, or storing credentials. The skill produces a short safety review and safe first-run plan; it is not a deployment playbook.

Keep this skill lightweight. Do not use it as general advice when the task has no setup, exposure, credential, install, or live-system risk.

## Use When

- A user asks to review a Docker Compose, VPS, reverse proxy, tunnel, DNS/TLS, or public-port setup for a self-hosted service.
- A setup guide includes admin panels, default credentials, webhooks, persistent volumes, backups, or production-like data.
- The user wants a safer first-run plan before exposing a service beyond localhost.

## Do Not Use When

- Do not use for ordinary feature work or local dev servers without self-hosting/deployment exposure.
- Do not use for n8n tasks; apply n8n-agent-rules and n8n-local-setup for n8n.
- Do not deploy, run Docker, open firewall ports, create DNS records, configure tunnels, edit credentials, or mutate a VPS/cloud service without explicit current-turn approval naming the target operation.

## Review Checklist

- Exposure boundary: localhost-only vs LAN vs public internet, 0.0.0.0 binds, firewalls, reverse proxies, and tunnels.
- Authentication: default passwords, admin bootstrap, registration settings, token storage, and public admin panels.
- Secrets: .env files, compose variables, private keys, webhook secrets, database credentials, and logs.
- Persistence and recovery: volumes, backups, restore test, upgrade path, and data ownership.
- Transport and abuse risks: TLS, allowed hosts, rate limits, webhook endpoints, email sending, and background jobs.
- Public paths and live data: do not place real admin panels, backups, exports, database dumps, logs, or private files under obvious public paths such as `/admin/`, `/backup/`, `/backups/`, `/dump/`, or `/exports/`.
- Canary paths and honeypots: if obvious paths are used as decoys, they must be inert, contain no real data, trigger no privileged behavior, and log only minimal safe metadata for abuse review.
- Traffic visibility: prefer first-party access logs, reverse-proxy logs, WAF events, rate-limit counters, and privacy-preserving security telemetry for identifying abuse. Do not add third-party trackers or log sensitive payloads without approval.
- Application error handling: user-facing unexpected failures must use generic public-facing copy such as `Something went wrong. Please try again. Contact support if this keeps happening. Error code: <event-specific-code-or-reference>.` Generate a support-safe, non-PII, non-secret, event/request-specific error code or reference. The same visible error code/reference must appear in detailed backend logs, server-side logs, or the approved logging backend for the exact backend log event. It must be unique enough to correlate the user-facing error to the exact backend log event or approved logging-backend entry, stable enough for the user to quote to support, and not revealing internals. Static-only codes such as `UNKNOWN_ERROR`, `INTERNAL_ERROR`, or `ERR_GENERIC` are not sufficient by themselves unless paired with a unique request id, event id, trace id, or error reference that is also present in backend logs; do not expose stack traces, raw provider errors, private paths, request headers, prompts, model responses, secrets, or private payloads.
- GDPR/PDPA logging baseline: before public exposure, define what metadata is logged, why it is needed, who can access it, how long it is retained, and how deletion/access requests are handled. Avoid logging raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, payment data, private files, or unnecessary PII.
- Host access and ports: prefer SSH key-only access with password login disabled only after key access, recovery access, and a second session are verified. Expose only required ports, usually HTTP/HTTPS and tightly controlled SSH; keep database, cache, and admin ports private by default.
- Deployment observability: before public exposure, define a metadata-only daily PASS/WARN/FAIL rollup, event allowlist, health/smoke-test status, rollback-readiness signal, and manual-approval state. Do not run provider calls, notification tests, production mutations, or auto-remediation without explicit current-turn approval naming the target operation.
- AI-module observability: if the service includes AI features, log only a metadata AI attempt ledger by default with provider, model, feature/module, status, latency, retry count, safe token/byte counts, failure taxonomy, output-shape diagnostics, and the same visible error reference when a user-facing AI failure occurs. Do not log raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, payment data, or private files.
- Frontend legal pages: for product-facing and/or data-handling frontend apps, if the exposed service is public-facing or handles accounts, forms, uploads, analytics, AI, payments, user data, customer/business data, admin workflows, dashboards, or confidential business data, require linked Privacy Policy and Terms of Use pages before launch, with owner/legal review noted if final copy is not available. These pages are not required for every isolated component, static UI experiment, internal throwaway mock, or non-product frontend-only task unless the task is intended for product use or handles user/business/confidential data.
- Fallback and compatibility scope: do not add broad fallback behavior, silent fallback paths, or backwards compatibility shims by default. Ask the user before implementing fallbacks or backwards compatibility; if not approved, display the generic error with the error code and log it.

## Output

Return a compact Self-Hosted Service Safety Review with risk level, blocked actions, approval-gated actions, safe first-run plan, required config changes, backup/restore notes, generic public-facing error handling, error code/reference logging, GDPR/PDPA privacy-safe deployment/AI observability baseline, Privacy Policy and Terms of Use link status when a frontend is exposed, and verification checks before public exposure.

## Safety Boundary

Review-only by default. Docker, DNS/TLS, tunnels, firewall/public ports, VPS/cloud changes, credentials, production data, or deployment commands require explicit current-turn approval.
