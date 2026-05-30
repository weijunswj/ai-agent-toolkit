<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/Page 3 - VPS Hosting.md
Update the project source and run sync.
-->
# VPS Hosting for n8n

This guide is for moving n8n from local testing to a public, always-on instance using Hostinger.

It is written for people who want a **real public n8n** with:
* A stable domain.
* Real webhook URLs.
* Backups.
* Updates.
* A setup that can survive beyond local testing.

If you are only testing locally, stick to [1. Local Setup](local-setup.md).

---

## 1. Why Hostinger?

Hostinger provides a direct path to getting n8n online quickly with minimal setup pain. They offer pre-built n8n templates and a Docker Manager that handles the difficult parts of reverse proxying and SSL generation.

## 2. Moving From Local ngrok To Hostinger

If you were previously testing locally using ngrok:
1. Ensure your local workflows are saved or exported.
2. Remember that your webhook URLs will change. You must update any external services sending data to your n8n webhooks to point to your new Hostinger public domain.
3. Your local `.env` file should not be uploaded directly. Hostinger templates provide their own environment configuration.

## 3. What Plan To Choose

Choose a Hostinger plan that supports Docker or their n8n template. Typically, the entry-level VPS or Docker hosting plans are sufficient for getting started. Ensure the plan gives you SSH access or a Docker Manager UI.

## 4. Domain and Subdomain

Before deploying, ensure you have:
1. A domain name.
2. A subdomain chosen for n8n (e.g., `n8n.yourdomain.com`).
3. DNS A-records pointed to your Hostinger VPS IP address.

## 5. First Login and Setup

When your Hostinger VPS is provisioned with the n8n template:
1. Access the VPS via SSH or the Hostinger panel terminal.
2. Hostinger commonly stores the n8n Docker Compose files in `/root` or `/docker/n8n`.
3. Locate the `.env` or `docker-compose.yml` and set your domain variables (like `WEBHOOK_URL`).

## 6. Verifying Containers

To verify n8n is running:

```bash
cd /root  # or /docker/n8n
docker compose ps
```

If the template uses queue mode, ensure the `n8n-worker` and `redis` containers are also healthy.

## 7. Safety and Backups

1. Hostinger provides snapshot backups on most VPS plans. Enable them.
2. Never commit your production `.env` file or credentials anywhere public.
3. For updates, see the [Upgrading Guide](upgrading.md).
