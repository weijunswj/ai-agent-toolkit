<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/4. vps hosting.md
Update the project source and run sync.
-->
# 4. VPS Hosting for n8n

This is the **full hosting guide** for n8n.

It is written for people who want a **real public n8n** with:

* A stable domain.
* Real webhook URLs.
* Backups.
* Updates.
* A setup that can survive beyond local testing.

If you are only testing locally, stop here and use:

* [3. Tunneling Guide](./3.%20tunneling%20guide.md)

---

## 1. First decide which hosting approach you are actually doing

There is no single best path for everyone.

These are **different approaches for different situations**.

### Use **Hostinger direct** when:

* You are starting from zero.
* You do **not** already have company infrastructure.
* You want the easiest beginner path.
* You want n8n online fast with the least setup pain.
* You want to avoid touching an existing office production server.
* You want the fullest no-extra-cost VPS setup without paying for Coolify Cloud.
* You mostly care about convenience over custom infrastructure design.

### Use **free self-hosted Coolify on a fresh VM** when:

* The company already has infrastructure.
* They can give you a **fresh Ubuntu VM** or separate server.
* You want the company to own everything directly.
* You want a cleaner platform for self-hosting than a one-off Docker setup.
* You do **not** want to pay for Coolify Cloud.
* You are okay maintaining Coolify itself.

### Use **Coolify Cloud connected to a company VM/server** when:

* The company already has infrastructure.
* You want to use Coolify.
* You do **not** want to maintain the Coolify control panel yourself.
* The company is fine paying a small recurring fee.
* You still want n8n to run on the company's own server.

### Use **direct Docker Compose on the company server** when:

* The company does **not** want Coolify.
* Their ops team already understands Docker.
* They want the smallest possible stack.
* They are happy managing more setup details manually.

---

## 2. Then decide which n8n shape you need

This also matters.

### Use **default n8n / SQLite** only when:

* You are testing.
* Usage is very light.
* You do not care about a more scalable production shape yet.

### Use **n8n with PostgreSQL** when:

* This is a real deployment.
* You want a more normal production database.
* You do not need worker-based scaling yet.

### Use **n8n with PostgreSQL and Worker / queue mode** when:

* This is a company or production setup.
* You expect heavier workload.
* Multiple executions may overlap.
* You want a cleaner scaling path.
* You want workers to process jobs separately from the main n8n instance.

If you are doing company work and expect real usage, **PostgreSQL** should be the minimum serious choice.

If you want the more production-shaped option, use **PostgreSQL + Redis + Worker / queue mode**.

---

## 3. Quick decision table

| Situation | Use this |
| --- | --- |
| I have no infra and want the easiest path | **Hostinger direct** |
| I have no infra and want the best balance of price and convenience | **Hostinger KVM 2** |
| I want the fullest Hostinger setup without extra platform cost | **Hostinger KVM 2 + n8n queue-mode template** |
| Company already has infra and can give me a fresh VM | **Free self-hosted Coolify on that VM** |
| Company already has infra but I do not want to maintain Coolify itself | **Coolify Cloud + company VM/server** |
| Company refuses Coolify | **Direct Docker Compose** |
| Company has only one busy production server | **Ask for a separate VM, separate server, VPS, or n8n Cloud** |

---

## 4. Important thing people confuse: Hostinger vs Coolify vs Caddy

These are **not** the same kind of thing.

* **Hostinger** = a VPS provider.
* **Coolify** = a deployment / app management platform.
* **Caddy** = a reverse proxy.
* **Traefik** = another reverse proxy.

So:

* **Hostinger** answers: *Where is the server coming from?*
* **Coolify** answers: *How are we managing deployments on our server(s)?*
* **Caddy / Traefik** answer: *How is the app exposed on HTTPS?*

Do not compare them like they are interchangeable.

---

## 5. Important thing people also confuse: free self-hosted Coolify vs paid Coolify Cloud

These are different.

### Free self-hosted Coolify

This means:

* You install Coolify on a server you control.
* Coolify itself runs on **your** VM/server.
* Your apps deploy to servers you control.

This is free apart from your own server costs.

### Paid Coolify Cloud

This means:

* Coolify itself runs on **Coolify's managed infrastructure**.
* Your apps still deploy to **your** VM/server.
* You are paying for the managed **Coolify control panel**, not for Coolify to host n8n for you.

There are no cloud-only deployment features locked behind paywalls.

### Very important: if you use Coolify Cloud, do you manually install Docker or n8n first?

**No, not normally.**

For Coolify Cloud, the normal flow is:

1. Create the Coolify Cloud account.
2. Add your VM/server to Coolify over SSH.
3. Click **Validate Server & Install Docker Engine**.
4. Let Coolify install the needed server components.
5. Deploy **n8n** from Coolify.

So:

* You do **not** manually install **n8n** on the VM first.
* You usually do **not** manually install **Docker** first either.

You only install Docker manually if Coolify cannot do it automatically or if your OS setup needs a manual path.

---

## 6. Recommended plans / defaults

For Docker Compose installs, set `WEBHOOK_URL` and `N8N_PROXY_HOPS` in `.env` or the Compose `environment:` section, not with the local PowerShell `docker run` block.

### If using Hostinger

Default:

* **Hostinger KVM 2**

Budget fallback:

* **Hostinger KVM 1**

Fullest no-extra-cost Hostinger shape:

* **Hostinger KVM 2**
* **Ubuntu 24.04 with n8n (queue mode)**
* Verify **PostgreSQL + Redis + workers** after deployment.

### Hostinger plan snapshot (captured April 2026 — verify before buying)

| Plan | Promo price | Renewal price | Specs |
| --- | --- | --- | --- |
| KVM 1 | $6.49/mo | $11.99/mo | 1 vCPU / 4 GB RAM / 50 GB NVMe / 4 TB bandwidth |
| KVM 2 | $8.99/mo | $14.99/mo | 2 vCPU / 8 GB RAM / 100 GB NVMe / 8 TB bandwidth |

If you do not want to think too much, buy **KVM 2**.

### If using Coolify for a company / production setup

Default:

* **n8n with PostgreSQL and Worker**

Simpler serious option:

* **n8n with PostgreSQL**

Avoid default SQLite for real company usage unless the workload is tiny.

---

## 7. Path A - Hostinger direct: full no-extra-cost n8n setup

This is the easiest full setup when you do **not** want to touch an office server and do **not** want to pay for Coolify Cloud.

The goal is to get a real public n8n instance with:

* A stable domain.
* HTTPS.
* PostgreSQL if available/configured.
* Redis queue mode.
* Worker containers.
* Backups.
* A simple update process.
* No extra paid hosting layer beyond the Hostinger VPS itself.

---

### 7.1 What this path is

Use this path when:

* You want n8n online quickly.
* You want to avoid the company office server.
* You want the fullest Hostinger setup without adding Coolify Cloud.
* You are okay using Hostinger's built-in VPS tools and Docker Compose.
* You want queue mode if Hostinger provides it cleanly.

Do **not** use this path if:

* The company requires everything to stay on-premise.
* You are not allowed to host business automation on a VPS.
* The company refuses external hosting for customer/order data.
* You need enterprise-grade high availability from day one.

---

### 7.2 Final target setup

The target setup is:

```text
Hostinger KVM 2 VPS
└── Docker Compose
    ├── n8n main instance
    ├── PostgreSQL database
    ├── Redis queue
    └── n8n workers
```

Your public URL should be something like:

```text
https://n8n.company.com
```

For small company use, the clean default is:

```text
Hostinger KVM 2 + Ubuntu 24.04 with n8n (queue mode)
```

This should give enough headroom for:

* Normal n8n workflows.
* Scheduled jobs.
* Webhooks.
* API integrations.
* Claude/OpenAI-style AI calls.
* Small-to-medium queue-mode usage.

---

### 7.3 Important expectation

Hostinger gives you the VPS and may give you a ready-made n8n template.

It does **not** remove the need to verify the setup.

After Hostinger creates the server, you must check what actually got deployed:

* Is n8n running?
* Is queue mode enabled?
* Is Redis present?
* Are workers present?
* Is PostgreSQL present?
* Is the domain correct?
* Are backups enabled?

Do not assume. Verify.

---

### 7.4 What to buy

#### Default recommendation

Buy:

```text
Hostinger KVM 2
```

Why:

* Better headroom than KVM 1.
* More comfortable for queue mode.
* More RAM for n8n + Redis + PostgreSQL + workers.
* Still simple and low-cost.

#### Budget fallback

Use this only if cost is very sensitive and workflows are light:

```text
Hostinger KVM 1
```

For company use, prefer KVM 2.

---

### 7.5 What to prepare before starting

Before touching Hostinger, prepare these:

| Item | Example | Notes |
| --- | --- | --- |
| Hostinger account | Company-owned account | Avoid using personal account for company infra. |
| Payment method | Company card | Keep billing owned by company. |
| Domain/subdomain | `n8n.company.com` | Use a subdomain, not root domain. |
| DNS access | Cloudflare / registrar / Hostinger DNS | Needed to point subdomain to VPS IP. |
| Admin email | `automation@company.com` or your company email | Use company email if possible. |
| Password manager | 1Password / Bitwarden / company vault | Store VPS/n8n/admin secrets here. |
| Data policy | Confirm what data may be processed | Especially if workflows touch customer/order data. |

Do not store passwords or API keys in:

* WhatsApp
* Personal notes
* Screenshots
* Public GitHub
* Plain `.env` files committed to repo

---

### 7.6 Choose the Hostinger template

When creating the VPS, choose the n8n template.

Preferred template:

```text
Ubuntu 24.04 with n8n (queue mode)
```

Use this because it should give you the fullest no-extra-cost Hostinger starting point:

* n8n
* Redis queue mode
* Workers
* Docker Compose

Fallback template:

```text
Ubuntu 24.04 with n8n
```

Use the fallback only if:

* Queue mode template is unavailable.
* You want a simpler setup first.
* You are not ready to maintain workers/Redis.

Avoid using a generic blank Ubuntu image unless you intentionally want to build everything manually.

---

### 7.7 First login checklist

After Hostinger provisions the VPS:

1. Open Hostinger hPanel.
2. Go to **VPS**.
3. Open the new server.
4. Find the VPS IP address.
5. Find **Browser Terminal**.
6. Open the default n8n URL.

The default n8n URL usually looks like:

```text
https://n8n.<your-vps-hostname>
```

Example:

```text
https://n8n.srv123456.hstgr.cloud
```

Open it and create the first n8n admin account.

Use a company-controlled email if this is for company use.

---

### 7.8 Verify the server files

Open Hostinger **Browser Terminal**.

First check where Hostinger put the n8n files.

Try:

```bash
cd /root
ls
```

Then check if there is a Compose file:

```bash
ls -la
cat docker-compose.yml
```

Some Hostinger Docker Catalog installs may use:

```bash
cd /docker/n8n
ls -la
cat docker-compose.yml
cat .env
```

Use whichever folder actually exists.

Expected common locations:

```text
/root/docker-compose.yml
/docker/n8n/docker-compose.yml
/docker/n8n/.env
```

If neither location exists, search:

```bash
find / -name 'docker-compose.yml' 2>/dev/null
find / -name '.env' 2>/dev/null | grep n8n
```

---

### 7.9 Verify running containers

Run:

```bash
docker ps
```

You want to see containers for some or all of these:

```text
n8n
n8n-worker
redis
postgres
traefik
```

Then run:

```bash
docker compose ps
```

Run that command from the folder that contains `docker-compose.yml`.

Example:

```bash
cd /root
docker compose ps
```

or:

```bash
cd /docker/n8n
docker compose ps
```

---

### 7.10 Verify queue mode

Open the Compose file:

```bash
cat docker-compose.yml
```

Look for:

```text
EXECUTIONS_MODE=queue
```

or:

```yaml
EXECUTIONS_MODE: queue
```

Also look for Redis settings:

```text
QUEUE_BULL_REDIS_HOST=redis
```

or similar.

Then check for a Redis service:

```yaml
redis:
  image: redis
```

Then check for worker service:

```yaml
n8n-worker:
  image: n8nio/n8n
  command: worker
```

If you see these, queue mode is probably enabled.

If you do **not** see these, you probably deployed the normal non-queue template.

---

### 7.11 Verify workers

From the Compose folder, run:

```bash
docker compose ps
```

You want to see worker containers running.

If using the Hostinger queue-mode template, it may start with 3 workers.

You can also run:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Look for names containing:

```text
worker
```

Example expected shape:

```text
n8n-main        Up
n8n-worker-1    Up
n8n-worker-2    Up
n8n-worker-3    Up
redis           Up
postgres        Up
```

Names may differ. The idea is what matters.

---

### 7.12 Verify PostgreSQL

This is important.

n8n can run on SQLite by default, but for serious company usage, PostgreSQL is preferred.

Open the Compose file:

```bash
cat docker-compose.yml
```

Look for a PostgreSQL service:

```yaml
postgres:
  image: postgres
```

Then look for n8n database variables:

```text
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=postgres
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=...
```

If you see `DB_TYPE=postgresdb`, n8n is configured to use PostgreSQL.

If you do **not** see `DB_TYPE=postgresdb`, assume it may be using SQLite.

#### If PostgreSQL is missing

Do not panic.

You have 3 options:

| Option | What to do | Recommendation |
| --- | --- | --- |
| Keep existing template | Use it as-is first | OK for testing, not ideal for company production. |
| Rebuild with a manual Compose stack | Add PostgreSQL + Redis + workers yourself | Best no-extra-cost full setup, but more hands-on. |
| Use n8n Cloud / managed platform | Avoid infra work | Easiest, but extra monthly cost. |

For this no-extra-cost guide, the best path is:

```text
Use Hostinger queue-mode template if it already has PostgreSQL.
If not, rebuild with your own Docker Compose stack on the same VPS.
```

---

### 7.13 Verify encryption key

This matters because n8n encrypts saved credentials.

In queue mode, all workers must use the same encryption key as the main n8n process.

Open the `.env` file or Compose file:

```bash
cat .env
cat docker-compose.yml
```

Look for:

```text
N8N_ENCRYPTION_KEY=some-long-random-value
```

If it is missing, add one before real company credentials are saved.

Generate a strong random key:

```bash
openssl rand -hex 32
```

Example output:

```text
9f1c7c0f0f9b7c7a2a2d3e1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a
```

Put it in the environment config as:

```text
N8N_ENCRYPTION_KEY=<generated-key>
```

Important:

* Store this key in the company password manager.
* Do not lose it.
* Do not commit it to GitHub.
* Make sure main n8n and all workers use the same key.

---

### 7.14 Point your real domain

Use a subdomain.

Good:

```text
n8n.company.com
```

Avoid:

```text
company.com
```

In DNS, create an A record:

```text
Type: A
Name: n8n
Value: <your-vps-ip>
TTL: Auto or default
```

Then wait for DNS propagation.

You can check with:

```bash
nslookup n8n.company.com
```

or:

```bash
dig n8n.company.com
```

If these commands are unavailable on your machine, use an online DNS checker.

---

### 7.15 Change n8n to use your domain

Hostinger's n8n template usually uses a default hostname like:

```text
srvXXXXX.hstgr.cloud
```

Change it to your real domain.

Open Browser Terminal.

Go to the n8n folder.

Try:

```bash
cd /root
nano docker-compose.yml
```

or:

```bash
cd /docker/n8n
nano .env
```

Find the default hostname and replace it with:

```text
n8n.company.com
```

Save in nano:

```text
Ctrl + X
Y
Enter
```

Restart:

```bash
docker compose down
docker compose up -d
```

Then open:

```text
https://n8n.company.com
```

---

### 7.16 Verify webhook URL settings

In the Compose file or `.env`, check for:

```text
WEBHOOK_URL=https://n8n.company.com/
N8N_PROXY_HOPS=1
```

If n8n sits behind a reverse proxy, these help n8n generate correct webhook URLs.

If Hostinger already handles this correctly, do not over-tune it.

But if webhook URLs still show the old Hostinger domain or `localhost:5678`, set these explicitly.

After changing environment variables, restart:

```bash
docker compose down
docker compose up -d
```

Then check inside n8n:

1. Create a test workflow.
2. Add a Webhook Trigger node.
3. Copy the production webhook URL.
4. Confirm it starts with:

```text
https://n8n.company.com/
```

---

### 7.17 Smoke test n8n

Create a very small workflow:

```text
Webhook Trigger → Set node → Respond to Webhook
```

Use fake/sample data only.

Test the webhook from your browser or terminal.

Example:

```bash
curl https://n8n.company.com/webhook-test/<your-test-path>
```

Then test a production webhook only after you activate the workflow.

Checklist:

* n8n login works.
* Editor loads.
* Workflow saves.
* Manual execution works.
* Webhook test URL works.
* Production webhook URL uses the real domain.
* No workflow touches real company systems yet.

---

### 7.18 Backups

Before building real workflows, confirm backups.

Minimum backup checklist:

* Hostinger VPS backups are enabled.
* You know how often backups run.
* You know how to restore a VPS backup.
* You take a manual backup/snapshot before major changes if available.
* You store important secrets outside the VPS.

Important:

A VPS snapshot is useful, but for serious production you should also know where the important app data lives:

* PostgreSQL data volume
* n8n `.n8n` data or mounted volume
* `.env` file
* `docker-compose.yml` file
* `N8N_ENCRYPTION_KEY`

At minimum, copy these details into a private internal SOP:

```text
VPS provider: Hostinger
VPS plan: KVM 2
n8n domain: https://n8n.company.com
Compose folder: /root or /docker/n8n
Backup frequency: <fill in>
Restore owner: <fill in>
Encryption key stored in: <password manager location>
```

---

### 7.19 Update process

Do not update randomly during working hours.

Before update:

1. Confirm current n8n works.
2. Take backup/snapshot if possible.
3. Export important workflows if needed.
4. Note current version.

Check current image/version:

```bash
docker compose ps
```

Then update from the Compose folder:

```bash
docker compose pull
docker compose down
docker compose up -d
```

After update:

1. Open n8n.
2. Log in.
3. Open one workflow.
4. Run a simple manual test.
5. Test one webhook.
6. Check worker containers are still running.

Check logs:

```bash
docker compose logs -f --tail=100
```

Exit logs with:

```text
Ctrl + C
```

---

### 7.20 Scaling workers

Only do this if queue mode is already working.

From the Compose folder:

```bash
docker compose up -d --scale n8n-worker=3
```

To scale to 5 workers:

```bash
docker compose up -d --scale n8n-worker=5
```

Do not blindly increase workers.

More workers use more RAM/CPU.

For Hostinger KVM 2, start with whatever the template gives you, commonly 3 workers.

Only increase if:

* Many workflows queue up.
* Executions are delayed.
* There are many overlapping jobs.
* The VPS still has enough free RAM/CPU.

Check resources:

```bash
docker stats
```

Exit with:

```text
Ctrl + C
```

---

### 7.21 Basic troubleshooting

#### n8n domain does not load

Check:

```bash
docker compose ps
```

Check DNS:

```bash
nslookup n8n.company.com
```

Check logs:

```bash
docker compose logs -f --tail=100
```

Common causes:

* DNS A record points to wrong IP.
* DNS propagation is not done.
* Containers are down.
* Wrong domain in `.env`.
* HTTPS proxy not ready yet.

#### Webhook URL shows wrong domain

Set or check:

```text
WEBHOOK_URL=https://n8n.company.com/
N8N_PROXY_HOPS=1
```

Restart:

```bash
docker compose down
docker compose up -d
```

Then refresh n8n and check webhook node again.

#### Workers are not running

Check:

```bash
docker compose ps
```

Check logs:

```bash
docker compose logs n8n-worker --tail=100
```

If the service name is different, list services:

```bash
docker compose config --services
```

Then use the actual worker service name.

#### Redis is down

Check:

```bash
docker compose ps
```

Check logs:

```bash
docker compose logs redis --tail=100
```

If Redis is down, queue mode will not work properly.

#### PostgreSQL is down

Check:

```bash
docker compose ps
```

Check logs:

```bash
docker compose logs postgres --tail=100
```

If PostgreSQL is down, n8n may not start or may lose database access.

---

### 7.22 Security basics

Do these:

* Use a strong admin password.
* Enable 2FA if available in your n8n plan/setup.
* Store credentials in n8n credentials, not in workflow text nodes.
* Store VPS credentials in the company password manager.
* Store `N8N_ENCRYPTION_KEY` in the company password manager.
* Do not expose raw database ports publicly.
* Do not commit `.env` to GitHub.
* Do not paste real customer data into AI tools until policy is approved.

For company use, write down:

```text
Who owns the VPS?
Who owns Hostinger billing?
Who can log into Hostinger?
Who can log into n8n?
Who restores backups?
Where are API keys stored?
What data can be processed by n8n/Claude?
```

---

### 7.23 What not to do

Do not:

* Install n8n directly on the office production server.
* Use your personal Hostinger account for company production.
* Use your personal Claude/API keys for company workflows.
* Store API keys in GitHub.
* Activate workflows that touch live systems without testing.
* Assume the Hostinger template uses PostgreSQL without checking.
* Assume queue mode is active without checking workers/Redis.
* Update during business hours without backup.

---

### 7.24 Recommended first company deployment flow

Use this flow:

```text
1. Buy Hostinger KVM 2 under company ownership.
2. Deploy Ubuntu 24.04 with n8n (queue mode).
3. Create first n8n admin account.
4. Verify Docker Compose folder.
5. Verify Redis, workers, and PostgreSQL.
6. Set/confirm N8N_ENCRYPTION_KEY.
7. Point n8n.company.com to VPS IP.
8. Change Hostinger/n8n domain config.
9. Confirm HTTPS loads.
10. Confirm webhook URLs use real domain.
11. Confirm backups.
12. Build only sample-data test workflow first.
13. Move real workflows one by one.
```

---

### 7.25 Quick command cheat sheet

#### Find Compose files

```bash
find / -name 'docker-compose.yml' 2>/dev/null
```

#### Check containers

```bash
docker ps
```

#### Check Compose status

```bash
docker compose ps
```

#### View Compose file

```bash
cat docker-compose.yml
```

#### Edit file

```bash
nano docker-compose.yml
```

or:

```bash
nano .env
```

#### Restart stack

```bash
docker compose down
docker compose up -d
```

#### Update stack

```bash
docker compose pull
docker compose down
docker compose up -d
```

#### View logs

```bash
docker compose logs -f --tail=100
```

#### List service names

```bash
docker compose config --services
```

#### Scale workers

```bash
docker compose up -d --scale n8n-worker=3
```

#### Generate encryption key

```bash
openssl rand -hex 32
```

---

### 7.26 Final Hostinger recommendation

For the fullest Hostinger setup without extra cost, use:

```text
Hostinger KVM 2
+ Ubuntu 24.04 with n8n (queue mode)
+ real subdomain
+ HTTPS
+ verified PostgreSQL
+ verified Redis
+ verified workers
+ backups enabled
```

If the queue-mode template does not include PostgreSQL, either:

1. Use it temporarily for testing only, or
2. Rebuild the stack manually on the same VPS with PostgreSQL + Redis + workers.

Do not add Coolify Cloud unless you specifically want a managed deployment dashboard later.

This path is meant to keep things simple:

```text
One VPS. One n8n stack. No office server. No Coolify Cloud. No extra hosting layer.
```

---

## 8. Path B - Company infra + free self-hosted Coolify on a fresh VM

This is the best path when a company already has infrastructure and can give you a **fresh Ubuntu VM**.

### Use this when

* The company already has infrastructure.
* They can give you a fresh VM or separate server.
* You want no extra Coolify subscription.
* You want a cleaner production platform than random one-off Docker setup.
* You are okay maintaining Coolify itself.

### Do not use this on the same busy production box by default

If the company only has one already-busy production server, do **not** default to installing Coolify there.

Ask for:

* A **fresh Ubuntu LTS VM**.
* Or a separate server.

### What you need

* Ubuntu LTS server with SSH access.
* Root access.
* A domain or subdomain such as `n8n.company.com`.
* Enough resources for n8n plus database and worker if you use queue mode.

### Step-by-step

#### Step 1 - Ask the company for a fresh VM

Ask for:

* Ubuntu LTS
* Public IP or reachable internal IP
* SSH access as root
* Firewall ports opened as needed

#### Step 2 - Install Coolify on that VM

SSH into the VM as root and run:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This installs Coolify and the needed components on that VM.

#### Step 3 - Open Coolify

After install, the script shows a URL like:

```text
http://<server-ip>:8000
```

Open it in a browser and create the first admin account immediately.

#### Step 4 - Decide where n8n will run

You now have two choices.

##### Choice 1 - n8n runs on the same VM as Coolify

Use this only if that VM is dedicated enough.

##### Choice 2 - n8n runs on another company server remotely

This is cleaner if the company already has a second Linux server for workloads.

#### Step 5 - If deploying to another company server, add it to Coolify

In Coolify:

1. Go to **Servers**.
2. Add a new server.
3. Enter the remote server IP.
4. Add or generate an SSH key.
5. Make sure the public key is in root's `~/.ssh/authorized_keys` on the target server.
6. Validate the server.
7. Let Coolify install Docker Engine if needed.

#### Step 6 - Create a project

Inside Coolify:

1. Create a **Project**.
2. Open that project.
3. Add a new **Service**.

#### Step 7 - Pick the n8n variant

For a company setup, pick one of these:

* **n8n with PostgreSQL**.
* **n8n with PostgreSQL and Worker**.

Do not default to SQLite unless the use case is tiny.

#### Step 8 - Set the domain in Coolify

Set the full public URL, for example:

```text
https://n8n.company.com
```

Coolify handles reverse proxy and Let's Encrypt SSL.

#### Step 9 - Deploy the service

Click deploy and wait for the containers to come up.

#### Step 10 - Open n8n and create the admin user

Open your domain:

```text
https://n8n.company.com
```

Create the admin account.

#### Step 11 - Verify the important n8n config

If needed, make sure the deployment uses:

```bash
WEBHOOK_URL=https://n8n.company.com/
N8N_PROXY_HOPS=1
```

#### Step 12 - Configure backups

In Coolify:

* Configure scheduled PostgreSQL backups.
* Send backups to S3-compatible storage if possible.

Remember:

* Backing up Coolify itself is not the same thing as backing up your app data.
* Back up the actual database and important storage.

---

## 9. Path C - Company infra + Coolify Cloud

This is the best path if the company already has servers but you do **not** want to maintain Coolify itself.

### Use this when

* The company already has infrastructure.
* You want to use Coolify.
* You do not want to host and maintain Coolify yourself.
* The company is fine paying a small recurring fee.
* You still want n8n to run on company-owned infrastructure.

### What Coolify Cloud really does

Coolify Cloud means:

* Coolify itself runs on Coolify's managed infrastructure.
* n8n still runs on **your company VM/server**.
* You are paying for the managed control plane.

### Current pricing snapshot

* **$5/month base** for up to 2 connected servers.
* **$3/month per additional server**.

### Very important: do you manually install Docker or n8n on the VM first?

**No, not normally.**

The normal flow is:

1. Create the Coolify Cloud account.
2. Add the server to Coolify Cloud.
3. Click **Validate Server & Install Docker Engine**.
4. Let Coolify prepare the server.
5. Deploy n8n from Coolify.

So:

* Do **not** manually install n8n first.
* Usually do **not** manually install Docker first either.

### Step-by-step

#### Step 1 - Create the Coolify Cloud account

Create the account and choose the plan.

#### Step 2 - Add / generate the SSH key in Coolify Cloud

Inside Coolify Cloud:

1. Add a private SSH key, or generate one.
2. Copy the public key.

#### Step 3 - Prepare the company server

On the company VM/server:

1. Make sure SSH works.
2. Make sure root access works.
3. Add the public key to root's `~/.ssh/authorized_keys`.
4. Make sure the server can install Docker if Coolify needs to do it.

#### Step 4 - Add the server in Coolify Cloud

In Coolify Cloud:

1. Open **Servers**.
2. Add the company server IP.
3. Click **Validate Server & Install Docker Engine**.
4. Wait until the server shows healthy / proxy running.

#### Step 5 - Create a project

Create a project and add a new service.

#### Step 6 - Pick the right n8n variant

For production, pick:

* **n8n with PostgreSQL**.
* Or **n8n with PostgreSQL and Worker**.

#### Step 7 - Set the domain

Use your company subdomain, for example:

```text
https://n8n.company.com
```

#### Step 8 - Deploy

Deploy the service and wait for it to come up.

#### Step 9 - Create the admin account

Open your domain and create the first admin user.

#### Step 10 - Configure backups

Coolify Cloud backs up the **Coolify control-plane database**, not your n8n app data.

So still configure:

* PostgreSQL backups.
* Storage / volume backups if needed.

#### Step 11 - Verify webhook settings if needed

If needed, make sure:

```bash
WEBHOOK_URL=https://n8n.company.com/
N8N_PROXY_HOPS=1
```

---

## 10. Path D - Company infra + direct Docker Compose (no Coolify)

Use this when:

* The company already has a Linux server.
* They do not want Coolify.
* Their ops team is fine with Docker Compose.
* They want the smallest possible management layer.

### Use this for production

Prefer:

* **n8n + PostgreSQL**.
* Or **n8n + PostgreSQL + queue mode**.

### Step-by-step

#### Step 1 - Prepare the server

Make sure you have:

* Ubuntu / Debian style Linux.
* SSH access.
* Docker Engine 24+.
* Docker Compose.
* A domain or subdomain.

#### Step 2 - Decide the public domain

Example:

```text
n8n.company.com
```

#### Step 3 - Point DNS

Create an A record for the server IP.

#### Step 4 - Put n8n behind a reverse proxy

Use a reverse proxy such as:

* Traefik.
* Caddy.

#### Step 5 - Set the important n8n variables

```bash
WEBHOOK_URL=https://n8n.company.com/
N8N_PROXY_HOPS=1
```

#### Step 6 - Start the stack

Bring up your containers.

#### Step 7 - Open n8n and create the admin account

Open the public HTTPS URL and log in.

#### Step 8 - Configure backups

Back up:

* PostgreSQL.
* Important storage / volumes.
* Config files.

#### Step 9 - Update carefully

Before updating:

* Back up first.
* Then update the images.
* Restart the stack.
* Test login and webhook behavior.

This path is fine, but it is more hands-on.

---

## 11. Production tips that matter

### 1. Use a subdomain

Good:

```text
n8n.company.com
```

Bad:

* Stuffing n8n onto the main homepage domain.

### 2. Use PostgreSQL for real usage

Do not treat SQLite as the production default.

### 3. Use Worker / queue mode for heavier usage

Queue mode gives the better scaling path.

### 4. Back up before upgrades

Always.

### 5. Test after every major change

After domain changes, updates, or proxy changes:

* Open login page.
* Test a small workflow.
* Test one webhook.

---

## 12. Final recommendations by situation

### I have no infrastructure and want the easiest path

* Hostinger KVM 2

### I have no infrastructure and want the fullest no-extra-cost Hostinger path

* Hostinger KVM 2
* Ubuntu 24.04 with n8n (queue mode)
* Verify **PostgreSQL + Redis + workers** before real production use

### I have no infrastructure and want the cheapest Hostinger option

* Hostinger KVM 1

### I am doing company work and the company can give me a fresh VM

* Free self-hosted Coolify on that VM.
* Deploy **n8n with PostgreSQL and Worker** if you want the more production-shaped setup.

### I am doing company work and want less maintenance for the control plane

* Coolify Cloud + company VM/server

### The company refuses Coolify

* Direct Docker Compose

### The company has only one busy production server

* Do **not** blindly install Coolify or n8n on that same box.
* Ask for a separate VM, separate server, Hostinger VPS, or n8n Cloud.

---

## References

* [Hostinger - n8n VPS pricing](https://www.hostinger.com/pricing/n8n-hosting)
* [Hostinger - How to Use the N8N VPS Template at Hostinger](https://www.hostinger.com/support/10473267-how-to-use-the-n8n-vps-template-at-hostinger/)
* [Hostinger - Changing the Domain for n8n on VPS at Hostinger](https://www.hostinger.com/support/11927159-changing-the-domain-for-n8n-on-vps-at-hostinger/)
* [Hostinger - How to Update N8N at Hostinger](https://www.hostinger.com/support/11767754-how-to-update-n8n-at-hostinger/)
* [Coolify - Pricing](https://coolify.io/pricing/)
* [Coolify Docs - Self-hosted installation](https://coolify.io/docs/get-started/installation)
* [Coolify Docs - Cloud](https://coolify.io/docs/get-started/cloud)
* [Coolify Docs - Server introduction](https://coolify.io/docs/knowledge-base/server/introduction)
* [Coolify Docs - Services introduction](https://coolify.io/docs/services/introduction)
* [Coolify Docs - n8n service](https://coolify.io/docs/services/n8n)
* [Coolify Docs - Backups](https://coolify.io/docs/databases/backups)
* [n8n Docs - Configure webhook URLs with reverse proxy](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
* [n8n Docs - Queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/)
