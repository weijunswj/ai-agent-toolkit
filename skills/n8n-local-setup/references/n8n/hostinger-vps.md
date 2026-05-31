<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/Page 2 - Hostinger VPS.md
Update the project source and run sync.
-->
# Page 2 - Hostinger VPS

Use this page when you want an always-on public n8n server on Hostinger instead of a local Docker Desktop setup.

This is not the local ngrok path. If you are only testing on your own computer, start with [Page 1 - Local Setup](local-setup.md).

* Verify current Hostinger plan/template details before buying.
* Use a company-owned account and domain for company automation.
* Set up backups before adding production credentials.
* Do not paste VPS passwords, production `.env` values, or `N8N_ENCRYPTION_KEY` into repo files.

---

## 1. When To Use Hostinger VPS

Use Hostinger VPS when:

- You want a stable public n8n URL such as `https://n8n.company.com`.
- You want webhooks and OAuth callbacks to work without a local computer staying on.
- You want Docker-based n8n with server-side backups and update tools.
- You are comfortable managing an unmanaged VPS or have someone responsible for it.

Do not use this page as approval to move private business data into a VPS. Confirm company policy, data handling, billing ownership, and recovery ownership first.

---

## 2. Choose A Hostinger Plan

Plan snapshot verified against Hostinger sources on 2026-05-31. Pricing, regions, and availability can change, so verify the current Hostinger page before buying.

| Plan | Snapshot specs | Use for n8n |
| --- | --- | --- |
| KVM 1 | 1 vCPU / 4 GB RAM / 50 GB NVMe / 4 TB bandwidth | Budget/light-use only. Use for testing or small personal workflows. |
| KVM 2 | 2 vCPU / 8 GB RAM / 100 GB NVMe / 8 TB bandwidth | Comfortable default for normal n8n use. |
| KVM 4 | 4 vCPU / 16 GB RAM / 200 GB NVMe / 16 TB bandwidth | Heavier workflows, queue mode, more workers, and heavier AI/API workloads. |
| KVM 8 | 8 vCPU / 32 GB RAM / 400 GB NVMe / 32 TB bandwidth | Larger workloads or more concurrent worker capacity. |

Recommendation:

- KVM 2 is the comfortable default for n8n.
- KVM 1 is budget/light-use only.
- KVM 4+ is for heavier workflows, queue mode, more workers, heavier AI/API workloads.

Before buying, prepare:

| Item | Example | Notes |
| --- | --- | --- |
| Owner account | Company-owned Hostinger account | Avoid personal ownership for company automation. |
| Domain/subdomain | `n8n.company.com` | Use a subdomain, not the root website domain. |
| DNS access | Hostinger DNS, Cloudflare, or registrar DNS | Needed to point an A record at the VPS IP. |
| Password manager | Company vault | Store VPS, n8n admin, and encryption-key material privately. |
| Backup owner | Named person/team | Someone must know how to restore. |

---

## 3. Choose The n8n Template

Hostinger documents n8n VPS templates including:

- `Ubuntu 24.04 with n8n`
- `Ubuntu 24.04 with n8n (queue mode)`

Choose `Ubuntu 24.04 with n8n` when you want the simpler template.

Choose `Ubuntu 24.04 with n8n (queue mode)` when workflows may overlap, load may grow, or you want a worker-based scaling path. Queue mode is useful when executions can pile up and workers should process jobs separately from the main n8n instance.

Hostinger's template runs n8n preinstalled in Docker. The queue-mode template can start with workers and can be scaled after you verify the actual Compose file and services.

Avoid a blank Ubuntu image unless you intentionally want to build and maintain the whole Compose stack yourself.

---

## 4. First Login Checklist

After Hostinger says the VPS is provisioned, do these in order.

### 4.1 Open The VPS In hPanel

1. Open a web browser.
2. Go to Hostinger hPanel.
3. Sign in to the Hostinger account that owns the VPS.
4. Open the `VPS` area from the Hostinger dashboard.
5. Click the VPS you just created.
6. Click `Manage` if Hostinger shows a separate manage button.

You should now be on the VPS dashboard for this one server.

### 4.2 Find The VPS IP Address

1. Stay on the VPS dashboard.
2. Look for a card or field named one of these:
   - `IP address`
   - `Server IP`
   - `IPv4`
   - `Dedicated IP`
3. Copy the IP address.
4. Save it in the password manager or private setup notes.

The IP address looks like this:

```text
203.0.113.123
```

Do not copy the Hostinger dashboard URL. You need the server IP address.

### 4.3 Open A Terminal

Use Hostinger Browser Terminal first. It avoids Windows SSH setup.

1. Stay on the VPS dashboard.
2. Look for `Browser Terminal`, `Terminal`, or `SSH`.
3. Open Browser Terminal.
4. Wait until you see a command prompt.

If you prefer SSH from your computer:

1. Open PowerShell.
2. Run:

   ```powershell
   ssh root@203.0.113.123
   ```

3. Replace `203.0.113.123` with the IP address from hPanel.
4. If Windows asks whether to trust the host, read the prompt and type `yes` only if the IP is your VPS.
5. Enter the VPS password or use the SSH key configured in Hostinger.

Terminal commands go in Browser Terminal or SSH. Website URLs go in your web browser.

### 4.4 Open The Default n8n URL

Hostinger's n8n template gives you a default n8n URL before you attach your own domain.

1. In hPanel, look for the n8n access URL, default domain, hostname, or template instructions.
2. Open a web browser.
3. Paste the n8n URL into the browser address bar.

Hostinger's n8n template guide describes the default URL shape as:

```text
https://n8n.<your-vps-hostname>
```

Do not type the n8n URL into Browser Terminal or SSH. It belongs in a web browser.

### 4.5 Create The First n8n Owner Account

The first time n8n opens, it should ask you to create the owner account.

1. Use a company-controlled email address for company deployments.
2. Create a strong password.
3. Save the email, password, n8n URL, and VPS IP address in the password manager.
4. Sign in.
5. Confirm the n8n editor loads.
6. Create a tiny manual test workflow only if you need to confirm the editor saves correctly.

Do not add production credentials yet. First understand backups, domain setup, and who is responsible for restore.

---

## 5. Domain / Subdomain Setup

Use a subdomain:

```text
n8n.company.com
```

Create an A record:

| DNS field | Value |
| --- | --- |
| Type | `A` |
| Name | `n8n` |
| Value | `<your-vps-ip>` |
| TTL | Auto/default |

Wait for DNS propagation before assuming the domain is broken.

To change Hostinger's generated n8n domain to your domain:

1. Open Hostinger Browser Terminal.
2. Go to the n8n folder:

   ```bash
   cd /docker/n8n
   ```

3. If that folder does not exist, check `/root`:

   ```bash
   cd /root
   ```

4. Open `.env` or `docker-compose.yml`.
5. Replace the Hostinger-generated default domain with `n8n.company.com`.
6. Save the file.
7. Restart with Docker Compose:

   ```bash
   docker compose down
   docker compose up -d
   ```

8. Open:

   ```text
   https://n8n.company.com
   ```

If webhook URLs still use the old domain, check environment values such as:

```text
WEBHOOK_URL=https://n8n.company.com/
N8N_PROXY_HOPS=1
```

---

## 6. Verify Server Files

Use Browser Terminal or SSH.

Check common Hostinger locations:

```bash
cd /docker/n8n
ls -la
cat docker-compose.yml
cat .env
```

If `/docker/n8n` does not exist:

```bash
cd /root
ls -la
cat docker-compose.yml
```

If neither location is obvious:

```bash
find / -name 'docker-compose.yml' 2>/dev/null
find / -name '.env' 2>/dev/null | grep n8n
```

Relevant files commonly include:

- `/docker/n8n/docker-compose.yml`
- `/docker/n8n/.env`
- `/root/docker-compose.yml`
- `/root/.env`

Production `.env` files contain secrets. Do not copy them into GitHub, chat, screenshots, tickets, or public docs.

---

## 7. Verify Containers

From the folder that contains `docker-compose.yml`:

```bash
docker compose ps
```

Also check:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Expected services depend on the selected template:

| Template | Expected shape |
| --- | --- |
| Normal n8n | n8n container, plus whatever Hostinger uses for routing/storage. |
| Queue mode | n8n main, one or more workers, Redis, and database/storage services if included by the template. |

Open the editor and confirm:

1. Login works.
2. A small workflow can be saved.
3. A manual test execution works.
4. A webhook test URL uses the intended domain after domain setup.

---

## 8. Queue Mode And Workers

Queue mode generally needs:

- n8n main process.
- Redis queue.
- Worker containers.
- Shared database.
- A consistent `N8N_ENCRYPTION_KEY` across main and workers.

Verify queue mode in `docker-compose.yml` or `.env`:

```text
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=redis
```

Look for worker services:

```yaml
n8n-worker:
  image: docker.n8n.io/n8nio/n8n
  command: worker
```

If queue mode is active, check workers:

```bash
docker compose ps
docker compose logs --tail=100 n8n-worker
```

If the worker service name differs, list services:

```bash
docker compose config --services
```

Only scale workers after you know queue mode is healthy:

```bash
docker compose up -d --scale n8n-worker=3
```

More workers use more CPU and RAM. KVM 4+ is safer for heavier queue-mode workloads.

---

## 9. Backups

Before real workflows:

1. Enable or confirm Hostinger VPS backups/snapshots.
2. Know the backup schedule.
3. Know how to restore a VPS snapshot.
4. Take a manual snapshot before major changes when available.
5. Store important secrets outside the VPS.

Minimum private SOP:

```text
VPS provider: Hostinger
VPS plan: KVM 2
n8n domain: https://n8n.company.com
Compose folder: /docker/n8n or /root
Backup frequency: <fill in>
Restore owner: <fill in>
N8N_ENCRYPTION_KEY stored in: <password manager location>
```

A VPS snapshot is useful, but also understand where n8n data lives:

- Database volume or service.
- n8n data volume.
- `.env`.
- `docker-compose.yml`.
- `N8N_ENCRYPTION_KEY`.

---

## 10. Updating Hostinger n8n

Back up first.

Option A: Docker Compose Manager

1. Open Hostinger Docker Compose Manager.
2. Find the root/n8n project.
3. Use Update.
4. Wait for containers to restart.
5. Verify the n8n dashboard after update.

Option B: Browser Terminal / SSH

```bash
cd /docker/n8n
docker compose pull
docker compose down
docker compose up -d
```

If your Compose file is under `/root`, use:

```bash
cd /root
docker compose pull
docker compose down
docker compose up -d
```

After update:

1. Open n8n.
2. Confirm login works.
3. Open one workflow.
4. Run a small manual test.
5. Test one webhook.
6. If using queue mode, confirm workers are still running.

Check logs:

```bash
docker compose logs -f --tail=100
```

Exit logs with `Ctrl+C`.

---

## 11. Safety Rules

- Keep Hostinger and n8n ownership under the right person or company.
- Do not store production `.env` values in this repo.
- Do not share VPS passwords, n8n credentials, API keys, webhook secrets, or `N8N_ENCRYPTION_KEY`.
- Do not assume the template uses PostgreSQL, Redis, workers, or queue mode without checking.
- Do not update during business-critical hours without a backup.
- Do not activate workflows that touch live systems until they have been tested with safe data.
- Do not expose raw database ports publicly.
- Record who can restore backups before production workflows depend on this instance.

---

## 12. References

- [Hostinger VPS hosting/plans page](https://www.hostinger.com/pricing/n8n-hosting)
- [Hostinger VPS plan parameters](https://support.hostinger.com/en/articles/6976044-parameters-and-limits-of-hosting-plans-in-hostinger)
- [Hostinger n8n VPS template guide](https://www.hostinger.com/support/10473267-how-to-use-the-n8n-vps-template)
- [Hostinger n8n domain-change guide](https://www.hostinger.com/support/11927159-changing-the-domain-for-n8n-on-vps-at-hostinger/)
- [Hostinger n8n update guide](https://www.hostinger.com/support/11767754-how-to-update-n8n-at-hostinger/)
- [n8n queue mode docs](https://docs.n8n.io/hosting/scaling/queue-mode/)
- [n8n webhook URL configuration docs](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
