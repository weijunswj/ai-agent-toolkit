# Upgrading

This guide covers the safest low-friction ways to update a self-hosted n8n instance.

Important:
1. Back up first.
2. Read the release notes before big version jumps.
3. Do a quick smoke test after every upgrade.
4. Do not commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.

---

## 1. Upgrade This Guide’s Local Setup

If you followed the local setup from this repo, update from the local stack folder that contains `docker-compose.yml` and the local `.env`.

Run this in PowerShell:

```powershell
cd "$env:USERPROFILE\Desktop\n8n-local"
docker compose pull
docker compose up -d --force-recreate
```

The `n8n_data` and `postgres_data` Docker volumes keep local runtime data during the recreate.

---

## 2. Upgrade Hostinger n8n

### 2.1. Option A. Docker Manager UI

If your n8n instance was deployed through Hostinger Docker Manager:
1. Open Docker Manager.
2. Find the n8n project.
3. Use **Update**.

### 2.2. Option B. SSH / Browser Terminal

For Hostinger VPS templates or Docker Catalog deployments, the n8n project commonly lives under `/docker/n8n` or `/root`.

Typical update flow:

```bash
cd /docker/n8n  # or cd /root
docker compose pull
docker compose down
docker compose up -d
```

---

## 3. Upgrade Other VPS / Docker Compose n8n

If you are running a standard Docker Compose based install on any provider:

```bash
cd /path/to/your/compose/project
docker compose pull
docker compose down
docker compose up -d
```

---

## 4. Verify The Upgrade

### 4.1. Check containers

```bash
docker compose ps
```

### 4.2. Check the app itself

After the stack comes back:
1. Open the n8n editor.
2. Trigger a simple workflow.
3. Confirm webhooks still load.

---

## 5. Rollback Plan

If you want easier rollbacks, pin a specific n8n image tag instead of always tracking `stable` or `latest`.

If something breaks, switch the image tag back to the last known-good version and restart the stack.

---

## 6. When Not To Update Immediately

If your instance runs business-critical automations, do not update blindly the moment a new release lands.

Wait long enough to read the release notes, then update with a backup or snapshot ready.

---

## 7. References

* [n8n Docs - Update self-hosted n8n](https://docs.n8n.io/hosting/installation/updating/)
* [n8n Docs - Release notes](https://docs.n8n.io/release-notes/)
* [Hostinger - How to Update N8N at Hostinger](https://www.hostinger.com/support/11767754-how-to-update-n8n-at-hostinger/)
* [Hostinger - How to Use the N8N VPS Template at Hostinger](https://www.hostinger.com/support/10473267-how-to-use-the-n8n-vps-template-at-hostinger)
