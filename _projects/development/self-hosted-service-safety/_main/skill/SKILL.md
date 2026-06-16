---
name: self-hosted-service-safety
description: Use only when reviewing or planning non-n8n self-hosted service setup, Docker Compose services, VPS deployment notes, reverse proxies, public ports, DNS/TLS, tunnels, admin panels, backups, or first-run hardening. Do not use for ordinary app coding, local-only dev servers, or n8n work.
---

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
- Host access and ports: prefer SSH key-only access with password login disabled only after key access, recovery access, and a second session are verified. Expose only required ports, usually HTTP/HTTPS and tightly controlled SSH; keep database, cache, and admin ports private by default.
- Deployment observability: before public exposure, define a metadata-only daily PASS/WARN/FAIL rollup, event allowlist, health/smoke-test status, rollback-readiness signal, and manual-approval state. Do not run provider calls, notification tests, production mutations, or auto-remediation without explicit current-turn approval naming the target operation.
- AI-module observability: if the service includes AI features, log only a metadata AI attempt ledger, failure taxonomy, latency/retry/status fields, and safe output-shape diagnostics. Do not log raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, payment data, or private files.

## Output

Return a compact Self-Hosted Service Safety Review with risk level, blocked actions, approval-gated actions, safe first-run plan, required config changes, backup/restore notes, privacy-safe deployment/AI observability baseline, and verification checks before public exposure.

## Safety Boundary

Review-only by default. Docker, DNS/TLS, tunnels, firewall/public ports, VPS/cloud changes, credentials, production data, or deployment commands require explicit current-turn approval.
