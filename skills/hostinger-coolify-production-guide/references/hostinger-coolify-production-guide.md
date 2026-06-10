<!--
Generated from toolkit project source. Do not edit directly.
Project: development.hostinger-coolify-production-guide
Source: _projects/development/hostinger-coolify-production-guide/_main/hostinger-coolify-production-guide.md
Update the project source and run sync.
-->
# Hostinger VPS + Coolify Zero-to-Production Guide

This guide helps a human owner take a typical web app from zero to production on a Hostinger VPS using Coolify. It covers a frontend app, a backend/API app, and a Postgres-backed app with domains, HTTPS, environment variables, health checks, migrations, backups, cutover, rollback, logs, and troubleshooting.

It is written for practical execution, not DevOps theory. Use placeholders such as `<YOUR_DOMAIN>`, `<APP_NAME>`, `<API_DOMAIN>`, `<FRONTEND_DOMAIN>`, `<DATABASE_NAME>`, and `<COOLIFY_URL>` until a human enters real production values in Hostinger, DNS, GitHub, and Coolify.

## Safety Notes And Hard Boundaries

This guide separates human-owned production operations from agent-safe repository preparation.

Do not ask an AI agent to own production. An agent can help inspect and prepare a repository, draft placeholder-only deployment notes, and review readiness. A human owner must make or approve every live production change.

Do not put any of these values in this toolkit repo or in a product repo unless the file is explicitly a placeholder-only example:

- Real passwords, API keys, tokens, private keys, SSH keys, database URLs, JWT secrets, encryption keys, SMTP credentials, OAuth client secrets, or webhook signing secrets.
- Real customer domains, production VPS IP addresses, billing details, production admin URLs, private project names, database dumps, backup archives, or production logs with sensitive data.
- Real Coolify, Hostinger, DNS, GitHub, or database production settings.

Do not let an agent do any of the following without explicit current-turn human approval naming the target and operation:

- Buy, resize, rebuild, reboot, or delete a VPS.
- Change DNS records, firewall rules, reverse proxy settings, or public exposure.
- Enter real secrets into Coolify, GitHub, Hostinger, DNS, or a production app.
- Deploy or restart a live production service.
- Run production database migrations.
- Create, delete, overwrite, download, or restore production backups.
- Perform production cutover or rollback.

## Fast Path ( Full Guide Below )

| Phase | Human-owned action | Agent-safe repo preparation | Expected result |
| --- | --- | --- | --- |
| 1. Decide architecture | Choose frontend, API, database, domains, and owner responsibilities. | Identify framework, package manager, ports, build/start commands, env vars, and database usage. | A short deployment inventory exists. |
| 2. Prepare app repo | Approve app changes and review secrets policy. | Add or improve `Dockerfile`, optional `docker-compose.example.yml`, `.env.example`, health endpoint notes, migration notes, and deployment README. | Repo is container-ready without secrets. |
| 3. Prepare VPS | Choose Hostinger VPS, install or open Coolify, create admin account, and secure access. | Do not perform billing, VPS, or admin bootstrap actions. | Coolify dashboard is reachable by the human owner. |
| 4. Connect GitHub | Connect the correct GitHub account or app in Coolify. | Document required repository access and branch names. | Coolify can read the intended repo. |
| 5. Create resources | Create Coolify project/environment/application/database resources. | Provide placeholder resource names and port/build/start recommendations. | Resources exist but secrets are not in files. |
| 6. Configure domains | Create DNS records and assign domains in Coolify. | Document required domains and CORS/API base URL variables. | DNS points to the VPS and Coolify can route traffic. |
| 7. Configure secrets | Enter real env vars manually in Coolify. | Maintain `.env.example` with safe placeholders only. | App config is complete without committed secrets. |
| 8. Deploy and verify | Trigger deployment, review logs, verify HTTPS, health, app flows, and migrations. | Provide checks and troubleshooting notes. | Staging or production URL is healthy. |
| 9. Back up and test restore | Configure backups and perform a restore test in a safe target. | Document backup requirements and restore-test checklist. | Recovery path is proven before cutover. |
| 10. Cut over | Lower DNS TTL, switch traffic, monitor, and freeze risky changes. | Provide cutover and rollback checklists. | Production traffic reaches the new deployment. |
| 11. Roll back if needed | Revert DNS/app version/database plan according to approved rollback. | Provide rollback decision notes, never execute destructive rollback alone. | Service is restored or stabilized. |

## Before You Start

### You Need

| Item | Purpose | Owner |
| --- | --- | --- |
| Hostinger VPS access | Hosts Coolify and the deployed apps. | Human |
| Domain registrar or DNS access | Points app domains to the VPS. | Human |
| GitHub repository | Source for GitHub-connected Coolify deployments. | Human plus agent-safe repo prep |
| Coolify admin access | Creates projects, resources, env vars, domains, backups, deployments. | Human |
| App build and start knowledge | Lets Coolify build and run the app correctly. | Agent-safe to inspect and document |
| Database plan | Defines Postgres ownership, migrations, backups, and restore testing. | Human approves, agent can document |

### Placeholder Conventions

| Placeholder | Replace with |
| --- | --- |
| `<APP_NAME>` | Short app name, such as `my-saas-api`. |
| `<FRONTEND_DOMAIN>` | Frontend hostname, such as `app.<YOUR_DOMAIN>`. |
| `<API_DOMAIN>` | API hostname, such as `api.<YOUR_DOMAIN>`. |
| `<YOUR_DOMAIN>` | The owned domain. Do not commit the real value if it is private. |
| `<COOLIFY_URL>` | Coolify dashboard URL. Do not commit the real admin URL if it is private. |
| `<APP_PORT>` | Internal app port inside the container, such as `3000`, `8080`, or `8000`. |
| `<DATABASE_NAME>` | Database name. Use a placeholder in docs and examples. |

### Copy-Safe Local Inventory Commands

Run these in a product repository only when normal local inspection is safe. They do not contact production.

```sh
pwd
git status --short
find . -maxdepth 2 -type f \( -name "package.json" -o -name "Dockerfile" -o -name "docker-compose*.yml" -o -name "pyproject.toml" -o -name "requirements.txt" -o -name "go.mod" -o -name "Cargo.toml" \) -print
```

PowerShell fallback:

```powershell
Get-Location
git status --short
Get-ChildItem -File -Recurse -Depth 2 | Where-Object { $_.Name -in @('package.json','Dockerfile','docker-compose.yml','docker-compose.yaml','pyproject.toml','requirements.txt','go.mod','Cargo.toml') } | Select-Object -ExpandProperty FullName
```

Expected result: you know the app framework, package manager, likely build command, start command, and whether container/deployment files already exist.

## 1. Decide The Generic Production Architecture

Use this baseline unless the app has a documented reason to differ.

| Component | Baseline | Notes |
| --- | --- | --- |
| Frontend | One Coolify application connected to GitHub. | Static or server-rendered frontend. API URL must be configurable. |
| Backend/API | One Coolify application connected to GitHub. | Must bind to `0.0.0.0` inside the container and listen on `<APP_PORT>`. |
| Database | Coolify-managed Postgres or an explicitly approved external Postgres. | Keep database private. Do not expose Postgres publicly by default. |
| Reverse proxy | Coolify default proxy. | Coolify currently documents Traefik as the default proxy, with Caddy as an optional/experimental alternative. Prefer the default unless a human owner intentionally chooses otherwise. |
| Domains | Separate frontend and API hostnames. | Example placeholders: `<FRONTEND_DOMAIN>` and `<API_DOMAIN>`. |
| HTTPS | Managed by Coolify's proxy for assigned domains. | DNS must point to the VPS before certificate issuance can succeed. |
| Backups | Automated database backups plus manual restore test. | Backups are not proven until restore is tested. |
| Rollback | Previous app image/commit plus database rollback plan. | Database rollbacks require special approval and may be forward-fix only. |

## 2. Manual Vs Agent-Safe Decision Table

| Task | Manual/human-owned | Agent-safe support |
| --- | --- | --- |
| Choose or buy a Hostinger VPS | Yes. Billing and infrastructure selection are human-owned. | Agent may list capacity questions and non-binding considerations. |
| Open first-time Coolify setup | Yes. Admin bootstrap is human-owned. | Agent may explain what information to expect. |
| Create Coolify admin account | Yes. | Agent must not enter credentials. |
| Connect GitHub to Coolify | Yes. | Agent may document repo, branch, and deploy-key/app access requirements. |
| Create Coolify project/environment/resources | Yes. | Agent may propose names and dependency order. |
| Enter production secrets | Yes. | Agent may maintain `.env.example` placeholders and missing-env checklists. |
| Configure DNS and domains | Yes. | Agent may draft DNS checklist using placeholders only. |
| Deploy production | Yes. | Agent may prepare repo files and verification commands. |
| Run production migrations | Yes, explicit approval required. | Agent may document migration commands and preflight checks. |
| Configure backups | Yes. | Agent may document backup requirements and retention questions. |
| Restore test | Yes. | Agent may provide checklist and safe target naming. |
| Cutover | Yes. | Agent may provide cutover checklist. |
| Rollback | Yes. | Agent may provide rollback decision tree, not execute live rollback. |
| Inspect repo readiness | No live mutation. | Yes. This is the primary agent-safe task. |

## 3. Prepare The Application Repository

Do this before touching production settings. The goal is a repository that Coolify can build and run without hidden local assumptions.

### Repository Readiness Checklist

| Area | What to verify | Expected result |
| --- | --- | --- |
| Framework | Identify frontend/backend framework and runtime. | Build pack or Dockerfile choice is clear. |
| Package manager | `npm`, `pnpm`, `yarn`, `pip`, `poetry`, `go`, `cargo`, etc. | Lockfile and install command are known. |
| Build command | Example: `npm run build`. | Command works locally or in CI. |
| Start command | Example: `npm run start`. | Starts production server, not dev server. |
| Internal port | Example: `3000`. | App listens on one known container port. |
| Bind address | Backend/server should bind to `0.0.0.0`. | App is reachable from container network. |
| Health endpoint | Example: `/health` or `/api/health`. | Returns 200 without requiring login. |
| Env vars | All required variables documented. | `.env.example` has placeholders only. |
| Database | Driver, migrations, and `DATABASE_URL` shape known. | Database is not hardcoded to localhost. |
| CORS | Allowed frontend origin is configurable. | Backend can allow `<FRONTEND_DOMAIN>`. |
| Logs | App logs to stdout/stderr. | Coolify logs are useful. |
| Secrets | No real secret committed. | `git status` and scans are clean. |

### Copy-Safe `.env.example` Pattern

```dotenv
# Placeholder-only example. Do not put real production values here.
NODE_ENV=production
PORT=<APP_PORT>
APP_URL=https://<FRONTEND_DOMAIN>
API_BASE_URL=https://<API_DOMAIN>
DATABASE_URL=postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DATABASE_NAME>
JWT_SECRET=<GENERATE_A_LONG_RANDOM_SECRET_IN_COOLIFY>
CORS_ORIGIN=https://<FRONTEND_DOMAIN>
LOG_LEVEL=info
```

Expected result: the real values are entered manually in Coolify, while the repository only explains what is required.

### Dockerfile Baseline

Use the app framework's official production guidance when available. If the repository already has a good Dockerfile, improve it rather than replacing it. The example below is a safer generic Node baseline to adapt, not a universal Dockerfile.

Production Dockerfiles require a restrictive `.dockerignore`, especially when the build context is the repository root. A `.dockerignore` reduces the chance of sending `.env` files, `.git`, private keys, backups, logs, or local runtime folders into the build context. Selective `COPY` statements are still preferred; do not rely on `.dockerignore` as the only protection.

Baseline `.dockerignore` to adapt:

```dockerignore
.git
.env
.env.*
*.pem
*.key
*.p12
*.pfx
node_modules
dist
build
.next
coverage
.tmp
.n8n-local
*.log
backup*
backups/
```

Safer generic Node Dockerfile baseline:

```dockerfile
# Example only. Review for the actual framework before use.
# Requires a restrictive .dockerignore.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
# Copy only the actual framework config/public files this app needs.
# Examples: COPY public ./public
# Examples: COPY next.config.js ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
# Adjust the build output path for the actual framework.
# Examples: /app/.next, /app/build, /app/server, /app/public

USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
```

Do not copy this blindly into every app. Inspect the actual framework, package manager, lockfile, build output, runtime files, start command, and port. Copy only the source, config, public assets, and build artifacts the app actually needs. If the framework does not output `dist`, replace that placeholder with the real build/runtime output path.

### Optional Compose Example For Multi-Service Apps

Coolify Docker Compose deployments treat the compose file as the source of truth for services. Keep production secrets out of the file and use variable references that Coolify can request in the UI.

```yaml
# docker-compose.example.yml
# Placeholder-only example. Do not commit real secrets.
services:
  api:
    build: .
    environment:
      NODE_ENV: production
      # Beginner-friendly default: use PORT from Coolify when set, otherwise 3000.
      PORT: ${PORT:-3000}
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
      CORS_ORIGIN: ${CORS_ORIGIN:?CORS_ORIGIN is required}
    expose:
      # Keep this aligned with the default PORT above and the healthcheck URL below.
      - "3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Do not expose database ports publicly unless a human owner explicitly approves a specific reason and compensating controls.

## 4. Prepare The Hostinger VPS

Human owner action. Do not delegate billing or VPS mutation to an agent.

| Step | Human action | Expected result |
| --- | --- | --- |
| Choose VPS | Select a Hostinger VPS plan sized for the app, database, logs, backups, and expected traffic. | VPS exists and owner has admin access. |
| Choose Coolify path | Use Hostinger's Coolify VPS template when appropriate, or install Coolify manually on a supported VPS. | Coolify is installed or ready for first-time setup. |
| Secure access | Store VPS and Coolify admin credentials in an approved password manager. | No credentials are pasted into repos or chat. |
| Record non-secret inventory | Note OS, region, resource size, and owner contacts in a private operations document. | Operations owner can find the system later. |

Expected-result checks from the human workstation:

```sh
# Replace with the public hostname only when the owner is ready to check it.
# This checks whether HTTP(S) is reachable, not whether the app is ready.
curl -I https://<COOLIFY_DOMAIN>
```

PowerShell fallback:

```powershell
Invoke-WebRequest -Method Head -Uri "https://<COOLIFY_DOMAIN>"
```

Do not commit the real Coolify admin URL if it should remain private.

## 5. First-Time Coolify Setup

Human owner action.

1. Open `<COOLIFY_URL>` from a trusted device.
2. Create the Coolify admin account manually.
3. Store the admin credentials in a password manager.
4. Configure the server according to Coolify's current UI prompts.
5. Keep Coolify updated through the supported UI or documented maintenance path.

Expected result: the human owner can log into Coolify and see the server dashboard.

Do not ask an agent to enter admin credentials, create the admin account, or perform live server setup without explicit current-turn approval.

## 6. Connect GitHub Deployments

Human owner action with agent-safe documentation support.

| Step | Human action | Agent-safe preparation |
| --- | --- | --- |
| Choose repo | Select the exact GitHub repo and branch. | Document repo URL placeholder and branch name. |
| Connect GitHub | Authorize Coolify using the chosen GitHub integration path. | Do not handle tokens or credentials. |
| Select branch | Pick production branch, such as `main`, or a release branch. | Document branch strategy. |
| Decide auto-deploy | Enable or disable auto-deploy based on release policy. | Document expected release flow. |

Recommended baseline:

- Use GitHub-connected deployments for application resources.
- Keep production deploys on a protected branch or controlled release branch.
- Require passing CI before merging to the branch that Coolify deploys.
- Disable auto-deploy until the first production cutover plan is rehearsed, if the team is not ready for automatic releases.

## 7. Create Coolify Project, Environment, Apps, And Database

Human owner action.

Suggested names:

| Coolify object | Example placeholder | Notes |
| --- | --- | --- |
| Project | `<APP_NAME>` | Human-readable product or service name. |
| Environment | `production` | Use a separate `staging` environment when possible. |
| Frontend application | `<APP_NAME>-frontend` | Connects to frontend repo or monorepo path. |
| API application | `<APP_NAME>-api` | Connects to backend repo or monorepo path. |
| Database | `<APP_NAME>-postgres` | Prefer private network access only. |

For monorepos, document the root directory for each app. For example:

| App | Repository path | Build command | Start command | Internal port |
| --- | --- | --- | --- | --- |
| Frontend | `apps/web` | `npm run build` | `npm run start` | `3000` |
| API | `apps/api` | `npm run build` | `npm run start` | `8080` |

Expected result: Coolify has separate resources for frontend, API, and database, with no real secrets committed to the repo.

## 8. Domains, DNS, And HTTPS/SSL

Human owner action.

Recommended domain layout:

| Purpose | Placeholder | DNS record |
| --- | --- | --- |
| Coolify dashboard | `<COOLIFY_DOMAIN>` | `A` record to VPS IPv4, optional `AAAA` to IPv6 if supported. |
| Frontend | `<FRONTEND_DOMAIN>` | `A` record to VPS IPv4, optional `AAAA` to IPv6 if supported. |
| API | `<API_DOMAIN>` | `A` record to VPS IPv4, optional `AAAA` to IPv6 if supported. |

DNS checklist:

1. Confirm the VPS public IP from Hostinger.
2. Create or update DNS records at the authoritative DNS provider.
3. Wait for DNS propagation according to the current TTL.
4. Assign the domain to the correct Coolify resource.
5. Let Coolify's proxy issue HTTPS certificates.
6. Verify HTTPS from a device outside the VPS.

Copy-safe checks:

```sh
# DNS should resolve to the VPS IP.
dig +short <FRONTEND_DOMAIN>
dig +short <API_DOMAIN>

# HTTPS should return headers after Coolify routing and SSL are ready.
curl -I https://<FRONTEND_DOMAIN>
curl -I https://<API_DOMAIN>/health
```

PowerShell fallback:

```powershell
Resolve-DnsName <FRONTEND_DOMAIN>
Resolve-DnsName <API_DOMAIN>
Invoke-WebRequest -Method Head -Uri "https://<FRONTEND_DOMAIN>"
Invoke-WebRequest -Uri "https://<API_DOMAIN>/health"
```

Do not repeatedly change proxy labels, domains, or DNS while certificates are issuing. Make one intended change, wait, check logs, and then decide the next change.

## 9. Environment Variables And Secrets

Real production values are entered manually in Coolify by the human owner. The repository should only contain placeholder-only examples and documentation.

### Frontend Variables

| Variable | Example placeholder | Required | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | Yes | Usually safe to document. |
| `API_BASE_URL` | `https://<API_DOMAIN>` | Yes | Must not be hardcoded to localhost. |
| `APP_URL` | `https://<FRONTEND_DOMAIN>` | Often | Used by auth redirects and metadata. |
| `SENTRY_DSN` | `<OPTIONAL_MONITORING_DSN>` | Optional | Treat real DSN as sensitive enough to avoid committing unless policy allows. |

### Backend/API Variables

| Variable | Example placeholder | Required | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | Yes | Runtime mode. |
| `PORT` | `<APP_PORT>` | Yes | Must match Coolify internal port. |
| `DATABASE_URL` | `postgresql://<...>` | For database apps | Enter real value only in Coolify. |
| `CORS_ORIGIN` | `https://<FRONTEND_DOMAIN>` | Browser APIs | Do not use `*` for credentialed production APIs. |
| `JWT_SECRET` | `<GENERATE_IN_COOLIFY>` | If auth uses JWT | Generate long random secret. |
| `SESSION_SECRET` | `<GENERATE_IN_COOLIFY>` | If sessions are used | Generate long random secret. |
| `LOG_LEVEL` | `info` | Optional | Keep logs useful without leaking secrets. |

### Database Variables

| Variable | Example placeholder | Required | Notes |
| --- | --- | --- | --- |
| `POSTGRES_DB` | `<DATABASE_NAME>` | Yes for DB creation | Keep stable after creation. |
| `POSTGRES_USER` | `<DB_USER>` | Yes | Store in Coolify/password manager. |
| `POSTGRES_PASSWORD` | `<DB_PASSWORD>` | Yes | Never commit. |
| `DATABASE_URL` | `postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DATABASE_NAME>` | App runtime | Prefer internal hostname from Coolify networking. |

Expected result: every required variable has a safe placeholder in docs and a real value in Coolify, and no real value is committed.

## 10. Health Checks

A production app should provide a lightweight health endpoint.

Recommended behavior:

| Endpoint | Requirement |
| --- | --- |
| `/health` | Returns HTTP 200 when the process is alive. |
| `/ready` | Optional deeper readiness check for database/cache dependencies. |
| Auth | Health should not require login. |
| Response | Small JSON such as `{ "status": "ok" }`. |
| Secrets | Never include env vars, credentials, build metadata with secrets, or stack traces. |

Example checks:

```sh
curl -fsS https://<API_DOMAIN>/health
curl -fsS https://<FRONTEND_DOMAIN>/
```

Expected result: health checks are boring, fast, and safe to run repeatedly.

## 11. Database Migrations

Production migrations are human-owned. An agent may document the command and preflight checklist, but must not run production migrations without explicit approval.

Migration checklist:

| Check | Required before production migration |
| --- | --- |
| Backup exists | Confirm a fresh backup completed. |
| Restore path known | Confirm restore test or rollback plan is documented. |
| Migration command known | Example: `npm run migrate:deploy`, `prisma migrate deploy`, `alembic upgrade head`, or framework equivalent. |
| App version matched | Migration is intended for the app version being deployed. |
| Backward compatibility reviewed | Decide whether old app can run against migrated schema. |
| Maintenance window | Required for risky or locking migrations. |
| Human approval | Required for production. |

Placeholder migration note for repo docs:

```md
## Production Migration

Command: `<MIGRATION_COMMAND>`

Owner: Human production owner.

Preflight:
- Confirm fresh backup.
- Confirm restore test target.
- Confirm app version and database target.
- Confirm expected runtime and lock risk.
- Approve the exact production command before running.
```

Expected result: migrations are deliberate, logged, and recoverable.

## 12. Backups And Restore Verification

Backups are only useful after restore is tested.

### Backup Baseline

| Item | Baseline |
| --- | --- |
| Database backup | Automated scheduled Postgres backup. |
| Retention | Human owner chooses retention based on business needs. |
| Storage | Keep backup storage separate from the running container when possible. |
| Encryption | Use approved secure storage for sensitive backups. |
| Monitoring | Human owner checks backup success/failure signals. |
| Restore test | Required before production cutover. |

### Restore Test Checklist

Human owner action. Do not restore over production during a test.

1. Pick a safe restore target, such as staging or a disposable test database.
2. Confirm the selected backup timestamp.
3. Restore to the safe target.
4. Start the app against the restored target if appropriate.
5. Run read-only smoke checks.
6. Record the restore duration, issues, and owner signoff in private operations notes.
7. Delete disposable restore targets only after the owner confirms they are no longer needed.

Expected result: the team knows that a backup can be restored and roughly how long it takes.

## 13. Frontend Deployment Checklist

| Check | Expected result |
| --- | --- |
| Build command works | `npm run build` or equivalent succeeds. |
| Start command is production-safe | Does not run a dev server in production. |
| API URL configurable | Uses `API_BASE_URL` or equivalent, not hardcoded localhost. |
| Domain assigned | `<FRONTEND_DOMAIN>` points to frontend app. |
| HTTPS works | Browser shows valid certificate. |
| Static assets load | No broken JS/CSS asset URLs. |
| Auth redirects | Redirect URLs use production domains. |
| Error monitoring | Optional, configured without committed secrets. |

Expected-result checks:

```sh
curl -I https://<FRONTEND_DOMAIN>
curl -fsS https://<FRONTEND_DOMAIN> >/dev/null
```

## 14. Backend/API Deployment Checklist

| Check | Expected result |
| --- | --- |
| App binds to `0.0.0.0` | Coolify proxy can reach it. |
| Internal port correct | Coolify service port matches `<APP_PORT>`. |
| Health endpoint works | `https://<API_DOMAIN>/health` returns 200. |
| Database URL configured | App connects through private network or approved external database. |
| CORS configured | Frontend origin is allowed. |
| Logs useful | Startup errors and request failures appear in Coolify logs. |
| Secrets present | Required env vars are set in Coolify, not committed. |
| Migrations handled | Production migration plan is approved. |

Expected-result checks:

```sh
curl -fsS https://<API_DOMAIN>/health
curl -I https://<API_DOMAIN>
```

## 15. Database Deployment Checklist

| Check | Expected result |
| --- | --- |
| Postgres resource created | Database exists in Coolify or approved external provider. |
| Private access | Database is not publicly exposed by default. |
| Credentials stored safely | Password manager and Coolify secret storage only. |
| Connection string set | `DATABASE_URL` points to intended database. |
| Migrations approved | Human has approved production migration. |
| Backup configured | Automated backup schedule exists. |
| Restore tested | Safe restore target proved backup usability. |
| Monitoring/logging | Owner can see database errors and backup failures. |

Do not expose Postgres to the public internet for convenience.

## 16. Production Cutover Checklist

Human owner action.

Before cutover:

- Confirm deployment owner and rollback owner are available.
- Confirm DNS TTL has been lowered ahead of time if needed.
- Confirm latest app version is deployed and healthy on production domains or temporary domains.
- Confirm database backup completed.
- Confirm restore test was completed in a safe target.
- Confirm migrations are complete or approved for the cutover window.
- Confirm frontend can call backend.
- Confirm auth redirects and CORS use production domains.
- Confirm logs are visible.
- Freeze unrelated production changes.

During cutover:

1. Make the smallest intended DNS or routing change.
2. Wait for DNS/routing to settle.
3. Verify HTTPS certificate.
4. Verify frontend loads.
5. Verify API health.
6. Verify login or critical user path if applicable.
7. Watch logs for errors.
8. Keep old deployment available until the rollback window closes, if possible.

After cutover:

- Record timestamp, deployed commit, database migration state, and owner signoff in private operations notes.
- Restore DNS TTL to the normal value if it was temporarily lowered.
- Keep monitoring elevated during the initial production window.

## 17. Rollback Checklist

Human owner action. Rollback can be more dangerous than deploy, especially after database migrations.

| Situation | Preferred response |
| --- | --- |
| Frontend-only bug | Re-deploy previous frontend commit or switch DNS/routing back. |
| API bug without schema change | Re-deploy previous API commit. |
| API bug after backward-compatible migration | Re-deploy previous app only if it is compatible with the migrated schema. |
| Destructive or incompatible migration | Stop and use the approved database recovery plan. Forward-fix may be safer than restoring. |
| DNS mistake | Revert DNS record to the last known good target and wait for TTL. |
| SSL/proxy issue | Check DNS, assigned domain, proxy logs, and app health before changing multiple settings. |

Rollback preflight:

- Identify exact failing symptom.
- Decide whether rollback affects app code, DNS, proxy, or database.
- Confirm last known good commit/image.
- Confirm database compatibility.
- Confirm whether backup restore is needed.
- Get explicit human approval for the rollback operation.

Do not delete backups during rollback. Do not restore a database over production unless the owner approves the exact target, backup timestamp, and expected data loss window.

## 18. Logs And Troubleshooting

Use Coolify deployment logs, runtime logs, proxy logs, and app logs. Prefer one change at a time.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| DNS points to wrong IP | Wrong `A`/`AAAA` record, stale DNS provider, or old TTL. | Check authoritative DNS, update to VPS IP, wait for TTL, and verify with `dig` or `Resolve-DnsName`. |
| SSL not issuing | DNS not pointing to VPS, domain assigned to wrong resource, port/proxy unreachable, or certificate rate limits. | Fix DNS first, verify HTTP reaches Coolify, check proxy logs, avoid repeated domain churn. |
| App builds but does not start | Wrong start command, missing runtime dependency, dev-only command, or crash on boot. | Check runtime logs, run the production start command locally if safe, fix Dockerfile/build pack settings. |
| Wrong exposed/internal port | App listens on one port but Coolify routes to another. | Set app `PORT`, Docker `EXPOSE`, Coolify service port, and health check to the same internal port. |
| Missing env var | Required variable not entered in Coolify or variable name mismatch. | Compare `.env.example` to Coolify variables and app startup error. Enter real value manually in Coolify. |
| Database connection failure | Wrong `DATABASE_URL`, database not ready, network mismatch, bad credentials, SSL requirement mismatch. | Verify database resource, internal hostname, credentials, and app logs. Do not expose DB publicly as a shortcut. |
| Migration failure | Migration incompatible, missing permissions, locked table, wrong database target. | Stop deployment if needed, preserve logs, confirm backup, decide forward-fix vs rollback with human approval. |
| CORS failure | API does not allow frontend origin or credentials settings mismatch. | Set `CORS_ORIGIN=https://<FRONTEND_DOMAIN>` or framework equivalent and redeploy API. |
| Frontend cannot call backend | Hardcoded localhost API URL, wrong `API_BASE_URL`, DNS/SSL issue, CORS issue. | Inspect browser network tab, verify `API_BASE_URL`, API health, DNS, SSL, and CORS. |
| Container restarts | Process crash, health check failure, memory limit, missing env var, bad migration-on-start pattern. | Read first crash log, check memory, disable risky migration-on-start for production unless intentional. |
| Logs unclear | App logs to files only, swallowed errors, no startup config summary. | Log to stdout/stderr, add safe startup checks, never log secrets. |

### Debug Order

1. Check DNS.
2. Check HTTPS/proxy route.
3. Check container health and port.
4. Check app startup logs.
5. Check required environment variables.
6. Check database connection.
7. Check frontend browser network errors.
8. Change one thing, redeploy, and recheck.

## 19. Agent-Safe Repository Preparation Output

When an AI agent uses this guide for a product repository, the safe output should be a short production-readiness patch or report, not a live deployment.

Expected agent-safe deliverables:

- Deployment inventory: framework, package manager, build command, start command, port, health endpoint, env vars, database use, migration command, CORS, logs, Docker/Coolify readiness.
- Placeholder-only `.env.example` updates.
- Dockerfile or `docker-compose.example.yml` improvements when appropriate.
- `docs/deployment.md` or README deployment notes with placeholders only.
- Health endpoint requirement or implementation if requested and safe.
- Migration instructions, not production migration execution.
- Secret hygiene checks, such as confirming no `.env` or private keys are committed.
- Localhost-hardcode checks for backend bind address and frontend API base URL.
- A human-owned Coolify runbook checklist that clearly says which steps require manual approval.

Agent-safe final report format:

```md
## Production Readiness Summary

- Framework:
- Package manager:
- Build command:
- Start command:
- Internal port:
- Health endpoint:
- Database:
- Migration command:
- Required env vars:
- CORS/API base URL:
- Logging:
- Docker/Coolify readiness:

## Human-Owned Actions

- Create or administer Hostinger VPS.
- Create Coolify admin account.
- Connect GitHub in Coolify.
- Enter real secrets.
- Configure DNS/domains/HTTPS.
- Deploy production.
- Run production migrations.
- Configure and test backups.
- Cut over or roll back production.

## Agent-Safe Changes Made

- Placeholder-only docs/config examples.
- Local repo readiness fixes.
- No real secrets or live production actions.
```

## 20. Final Production Acceptance Checks

Before declaring production ready, the human owner should verify:

- Frontend URL loads over HTTPS.
- API health endpoint returns 200 over HTTPS.
- Frontend can call API from a browser.
- Authentication and redirects use production domains.
- Database-backed create/read/update flows work.
- Required env vars are present in Coolify.
- No real secrets are committed to the repo.
- Logs are visible and do not leak secrets.
- Automated backups are configured.
- Restore test completed in a safe target.
- Migration state is documented.
- Cutover timestamp and deployed commit are recorded.
- Rollback plan is still valid after migrations.

If any item is unknown, do not call the deployment complete. Mark it as pending and assign a human owner.

## Documentation Source Notes

This first-party guide uses public vendor documentation only as factual context. No third-party guide text or code is copied here. Always check current official vendor docs before making live production changes, especially because proxy, deployment, and platform behavior can change.

Official docs to re-check before live work:

| Vendor area | Official doc | Use before |
| --- | --- | --- |
| Hostinger Coolify VPS template | [How to use the Coolify VPS template](https://support.hostinger.com/en/articles/9615197-how-to-use-the-coolify-vps-template) | Selecting or opening the Hostinger Coolify VPS flow. |
| Coolify supported proxies | [Supported Proxy](https://coolify.io/docs/knowledge-base/server/proxies) | Assuming default reverse proxy behavior or changing proxies. |
| Coolify Traefik overview | [Traefik Proxy](https://coolify.io/docs/knowledge-base/proxy/traefik/overview) | Reviewing default proxy, routing, and SSL assumptions. |
| Coolify domains and HTTPS | [Domains](https://coolify.io/docs/knowledge-base/domains) | Assigning domains or troubleshooting HTTPS/SSL. |
| Coolify Docker Compose deployments | [Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose) | Writing compose files, ports, labels, or compose env syntax. |
| Coolify environment variables | [Environment Variables](https://coolify.io/docs/knowledge-base/environment-variables) | Entering real env vars or deciding build-time vs runtime variables. |
| Coolify health checks | [Health checks](https://coolify.io/docs/knowledge-base/health-checks) | Configuring health checks, rolling updates, or proxy routing behavior. |

At the time this guide was authored, Coolify documentation described Traefik as the default proxy, Caddy as optional/experimental, domains as proxy-configured, Docker Compose deployments as compose-file-driven, and compose variable references as visible in Coolify's UI. Treat those as review points, not permanent guarantees.
