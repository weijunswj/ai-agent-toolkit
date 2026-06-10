---
name: hostinger-coolify-production-guide
description: Prepare repositories for human-owned Hostinger VPS plus Coolify production deployments. Use for safe repo readiness review, placeholder-only Docker/Coolify notes, env examples, health checks, migrations, CORS, logging, and production-readiness reports. Do not use to buy VPS plans, change DNS, enter real secrets, deploy live apps, run production migrations, or perform cutover/rollback without explicit human approval.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.hostinger-coolify-production-guide
Source: _projects/development/hostinger-coolify-production-guide/curated_output_for_ai/skills/hostinger-coolify-production-guide/SKILL.md
Update the curated output and run sync.
-->
# Hostinger Coolify Production Guide

Use this skill when the user wants safe repository preparation for a Hostinger VPS plus Coolify deployment, or when they ask for the local full guide for a human-owned zero-to-production runbook.

The full runtime guide is in [references/hostinger-coolify-production-guide.md](references/hostinger-coolify-production-guide.md). Read it when exact runbook structure, manual-vs-agent boundaries, checklists, or troubleshooting detail matters.

## Scope

Agent-safe work is limited to repository preparation and review:

- Inspect framework, package manager, build command, start command, internal port, environment variables, database usage, migration command, health endpoint, CORS, logging, Dockerfile, Compose, and Coolify readiness.
- Add or improve placeholder-only `.env.example`, Dockerfile, `docker-compose.example.yml`, or deployment notes when requested and appropriate.
- Add health check requirements or safe local health endpoint implementation when requested.
- Document migration commands and preflight checks, without running production migrations.
- Check for committed secrets, localhost-only assumptions, wrong container bind address, and non-configurable frontend API base URLs.
- Produce production-readiness notes that clearly separate human-owned actions from agent-safe repo changes.

## Hard Boundaries

Do not perform these actions unless the human gives explicit current-turn approval naming the target and operation:

- Buy, resize, rebuild, reboot, or delete a Hostinger VPS.
- Create or administer the live Coolify account.
- Connect GitHub in the live Coolify UI.
- Create live Coolify projects, environments, apps, databases, backups, or deployments.
- Enter real secrets, tokens, passwords, private keys, database URLs, or credential exports.
- Change DNS records, domains, SSL/proxy settings, firewalls, or public exposure.
- Deploy live production apps, restart live services, run production migrations, perform restore tests, cut over production traffic, or roll back production.
- Store real production deployment settings, real customer domains, production VPS details, product repo code, customer data, backups, or logs in this toolkit repo.

## Workflow

1. Confirm whether the user wants repository preparation, a readiness review, or the human-owned full guide.
2. For repository work, inspect only the relevant app files before editing.
3. Identify framework, package manager, build/start commands, app port, env vars, database usage, migration command, health endpoint, CORS, logging, and Docker/Coolify readiness.
4. Make narrow, safe repo changes only when requested.
5. Keep all examples placeholder-only.
6. Run the smallest relevant local validation for the touched repo files.
7. Report agent-safe changes separately from manual production actions.

## Expected Output

Return a compact production-readiness report with:

- App inventory: framework, package manager, build command, start command, internal port, health endpoint, database, migration command, required env vars, CORS/API base URL, logging, and Docker/Coolify readiness.
- Agent-safe changes made or recommended.
- Human-owned Hostinger/Coolify/DNS/secrets/deploy/migration/backup/cutover/rollback steps.
- Validation run and remaining blockers.
- Confirmation that no real secrets or live production actions were added or performed.
