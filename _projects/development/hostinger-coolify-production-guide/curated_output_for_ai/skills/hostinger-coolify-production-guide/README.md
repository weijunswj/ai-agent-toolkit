# Hostinger Coolify Production Guide

Safe repository-preparation skill and local reference guide for human-owned Hostinger VPS plus Coolify production deployments.

Use this skill to prepare frontend, backend/API, and Postgres-backed app repositories for Coolify without letting an agent own production deployment.

## Use This Skill For

- Inspecting framework, package manager, build command, start command, app port, env vars, database usage, migrations, health endpoint, CORS, logging, Dockerfile, Compose, and Coolify readiness.
- Adding placeholder-only `.env.example`, Dockerfile, Compose examples, health check notes, migration notes, or deployment docs to a consumer repository.
- Checking that secrets are not committed.
- Checking that backend services bind correctly for containers.
- Checking that frontend API base URLs are configurable.
- Producing a production-readiness report and human-owned Coolify runbook checklist.

## Not For

- Buying, resizing, rebuilding, rebooting, or deleting a Hostinger VPS.
- Creating/administering the live Coolify account.
- Connecting GitHub in the live Coolify UI.
- Creating live Coolify projects, apps, databases, backups, or deployments.
- Entering real secrets or production settings.
- Changing DNS, SSL/proxy settings, firewalls, or public exposure.
- Running production migrations, restore tests, cutover, or rollback without explicit current-turn human approval.

## Local References

- [Full Hostinger VPS + Coolify zero-to-production guide](references/hostinger-coolify-production-guide.md)
- [Reference index](references/README.md)

## Expected Output

Return a production-readiness summary with app inventory, agent-safe changes, human-owned production actions, validation, blockers, and confirmation that no real secrets or live production actions were added or performed.
