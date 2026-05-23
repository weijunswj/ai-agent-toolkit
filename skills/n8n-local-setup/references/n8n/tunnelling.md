<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/3. tunneling guide.md
Update the project source and run sync.
-->
# 3. Tunneling Guide ( Local Development )

This guide is for **local development** only.

Use this guide when:

* n8n is running on your own laptop or desktop.
* You need a public URL.
* An outside service needs to call your local n8n.
* You are testing webhooks or OAuth callbacks.

Do **not** use this guide for a real always-on production setup.

If n8n already runs on a VPS with a real domain, use this instead:

* [4. VPS Hosting](./4.%20vps%20hosting.md)

If you want the same local ngrok behaviour but want n8n managed by Docker Compose instead of a long `docker run` command, use this after reading the basics here:

* [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md)

---

## 1. First understand what tunneling is

Your local n8n normally lives at:

```text
http://localhost:5678
```

That works only on **your own computer**.

Outside services such as:

* Stripe
* Telegram
* GitHub
* Typeform
* Meta
* Google OAuth callbacks

cannot call `localhost` on your PC.

A tunnel gives you a **temporary public URL** that forwards traffic to your local n8n.

Example:

```text
https://something.trycloudflare.com -> http://localhost:5678
```

---

## 2. Which tunnel should you use?

### Use **Cloudflare Quick Tunnel** when:

* You want the fastest free path.
* You just want something working quickly.
* You are fine with a random temporary URL.

### Use **ngrok** when:

* You want better debugging.
* You want to inspect requests.
* You want the smoother developer workflow.

### Use **Docker Compose + ngrok** when:

* You still want local ngrok webhook testing.
* You want n8n managed through Docker Compose.
* You want a cleaner base for adding services later.

Use:

* [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md)

### Use **n8n built-in tunnel** when:

* You are following n8n's official local development flow.
* You are **not** using the Windows Docker setup in this repo.

### If you want a real always-on public URL

Do **not** use a tunnel.

Use:

* [4. VPS Hosting](./4.%20vps%20hosting.md)

---

## 3. Before you start

Make sure all of these are already true.

### 1. n8n is running locally

Open this in your browser:

```text
http://localhost:5678
```

If n8n does not open, fix that first.

### 2. You know which local port n8n is using

In this repo, the normal local port is:

```text
5678
```

### 3. You understand the tunnel is temporary

A tunnel is for **testing and local development**.

It is not the final production shape.

---

## 4. Very important: what you must set in n8n

When n8n is behind any reverse proxy or tunnel, n8n says you should set:

```powershell
WEBHOOK_URL=https://your-public-url/
N8N_PROXY_HOPS=1
```

That makes n8n generate the correct webhook URLs instead of showing `localhost:5678` in the editor.

### If you are using the Windows Docker setup from this repo

You set it by recreating the `n8n` container with those environment variables.

For local development, keep this container loopback-only on `127.0.0.1` and use the tunnel URL as the public endpoint.
Do not expose the container port directly to the LAN without reviewing auth, firewall, HTTPS/tunnel, and credential risk.

#### Step 1 - Stop and remove the old container, then start it again with the tunnel settings

Replace `https://your-public-url/` with the real tunnel URL you get later.

Open **PowerShell** and run:

```powershell
$CONTAINER_NAME = "n8n"
$HOST_PORT = "5678"
$CONTAINER_PORT = "5678"
$TZ = "Asia/Singapore"
$VOLUME_NAME = "n8n_data"
$IMAGE = "docker.n8n.io/n8nio/n8n:stable"
$WEBHOOK_URL = "https://your-public-url/"

docker stop $CONTAINER_NAME 2>$null
docker rm $CONTAINER_NAME 2>$null

docker run -d --name $CONTAINER_NAME `
  -p "127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}" `
  -e "GENERIC_TIMEZONE=$TZ" `
  -e "TZ=$TZ" `
  -e "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true" `
  -e "N8N_RUNNERS_ENABLED=true" `
  -e "WEBHOOK_URL=$WEBHOOK_URL" `
  -e "N8N_PROXY_HOPS=1" `
  -v "${VOLUME_NAME}:/home/node/.n8n" `
  $IMAGE
```

#### Step 2 - Check it is running

```powershell
docker ps
```

### If you are using Docker Compose instead

Put these inside the `environment:` section, then restart the stack:

```yaml
WEBHOOK_URL=https://your-public-url/
N8N_PROXY_HOPS=1
```

For a full local Compose + ngrok wrapper flow, use:

* [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md)

---

## 5. Path A - Cloudflare Quick Tunnel ( easiest free option )

This is the fastest free option for most people.

### Use this when

* You want the easiest free path.
* You do not care that the URL is random.
* You are okay with a temporary testing URL.

### Official download link

Download `cloudflared` here:

* [Cloudflare Downloads](https://developers.cloudflare.com/tunnel/downloads/)

Cloudflare's Quick Tunnel docs are here:

* [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)

### Windows step-by-step

#### Step 1 - Download `cloudflared`

Open the Cloudflare downloads page above.

On the **Windows** section:

* Download the **64-bit executable** if your PC is normal modern Windows.
* Save it to your **Downloads** folder.

#### Step 2 - Rename the file

In File Explorer:

1. Open **Downloads**.
2. Find the downloaded file.
3. Rename it to:

```text
cloudflared.exe
```

#### Step 3 - Create a simple folder for it

Create this folder:

```text
C:\cloudflared
```

Move `cloudflared.exe` into that folder.

#### Step 4 - Open PowerShell in that folder

In File Explorer:

1. Open `C:\cloudflared`
2. Click the address bar
3. Type:

```text
powershell
```

4. Press **Enter**

A PowerShell window should open in that folder.

#### Step 5 - Check the binary works

Run:

```powershell
.\cloudflared.exe --version
```

If that prints a version, you are good.

#### Step 6 - Start the tunnel

Run:

```powershell
.\cloudflared.exe tunnel --url http://localhost:5678
```

#### Step 7 - Copy the public URL

Cloudflare will print a URL like:

```text
https://something.trycloudflare.com
```

Copy that exact URL.

#### Step 8 - Put that URL into n8n

Now go back to the Docker command from Section 4 and replace:

```text
https://your-public-url/
```

with your real tunnel URL, including the trailing slash.

Example:

```text
https://something.trycloudflare.com/
```

Then recreate the n8n container with that value.

#### Step 9 - Check the webhook URL in n8n

Open a workflow with a Webhook node.

The webhook URL should now show the public tunnel domain instead of `localhost`.

#### Step 10 - Keep the tunnel window open

Do **not** close the PowerShell window that is running `cloudflared`.

If you close it:

* The tunnel stops.
* The public URL stops working.

### Cloudflare Quick Tunnel limits

Cloudflare says Quick Tunnels are for testing and notes these limits:

* Random subdomain.
* 200 concurrent request limit.
* No Server-Sent Events support.

---

## 6. Path B - ngrok ( better debugging option )

This is the best option if you want to inspect requests and debug more comfortably.

### Use this when

* You want a nicer developer workflow.
* You want traffic inspection.
* You want replay tools.
* You do not mind creating a free ngrok account.

### Official download link

Download ngrok here:

* [ngrok Downloads](https://ngrok.com/downloads)

### Windows step-by-step

#### Step 1 - Download ngrok

Open the ngrok downloads page above.

Download the Windows version and save it to **Downloads**.

#### Step 2 - Extract it

Unzip the archive.

Create this folder:

```text
C:\ngrok
```

Move `ngrok.exe` into that folder.

#### Step 3 - Create a free ngrok account

You need a free account because ngrok wants an authtoken.

After signing in, copy your authtoken from the ngrok dashboard.

#### Step 4 - Open PowerShell in the folder

In File Explorer:

1. Open `C:\ngrok`
2. Click the address bar
3. Type:

```text
powershell
```

4. Press **Enter**

#### Step 5 - Add your authtoken

Run:

```powershell
.\ngrok.exe config add-authtoken <YOUR_AUTHTOKEN>
```

Replace `<YOUR_AUTHTOKEN>` with the real token you copied.

#### Step 6 - Start the tunnel

Run:

```powershell
.\ngrok.exe http 5678
```

#### Step 7 - Copy the HTTPS forwarding URL

ngrok will show an HTTPS URL.

Copy it.

#### Step 8 - Put that URL into n8n

Use it as your `WEBHOOK_URL` in the Docker run command from Section 4.

Example:

```text
https://abc123.ngrok-free.app/
```

#### Step 9 - Recreate the n8n container

Re-run the Docker command with the new `WEBHOOK_URL`.

#### Step 10 - Check the Webhook node URL

Open a workflow with a Webhook node.

It should show the ngrok domain instead of `localhost`.

### ngrok free-plan note

The free plan gives you one assigned dev domain and has usage limits, so this is still a development shape, not the final production answer.

---

## 7. Path C - n8n built-in tunnel

n8n also has its own built-in tunnel flow in the official local development docs.

### Use this when

* You are following n8n's official local dev workflow.
* You are **not** using the normal Windows Docker setup in this repo.

### Do not use this when

* You are just following the local Docker setup in [1. Local Setup](./1.%20local%20setup.md)

### Start the built-in tunnel

Run these in two terminals:

```bash
# Terminal 1
pnpm --filter n8n-containers services --services cloudflared
```

```bash
# Terminal 2
pnpm dev
```

### What this does

It:

* Starts `cloudflared`.
* Gets the public URL automatically.
* Writes `WEBHOOK_URL` and `N8N_PROXY_HOPS=1` into `packages/cli/bin/.env`.
* Lets the n8n dev process use those values automatically.

### Clean up later

```bash
pnpm --filter n8n-containers services:clean
```

### Important note

This is still a development-only path.

---

## 8. What order should you actually do things in?

If you are using the normal Windows Docker setup from this repo, do this exact order:

1. Make sure local n8n opens at `http://localhost:5678`
2. Pick **Cloudflare Quick Tunnel** or **ngrok**
3. Install the tunnel tool
4. Start the tunnel
5. Copy the public tunnel URL
6. Recreate the n8n Docker container with:
   - `WEBHOOK_URL=<that public URL>`
   - `N8N_PROXY_HOPS=1`
7. Open n8n again
8. Check a Webhook node now shows the public URL
9. Put that public URL into the outside service you are testing

That is the whole job.

If you want the same idea but with Docker Compose, use [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) after you understand this basic flow.

---

## 9. Final recommendation

### Easiest free path

* Cloudflare Quick Tunnel

### Best debugging path

* ngrok

### Cleaner local Docker path

* Docker Compose + ngrok wrapper

### Best real long-term path

* Use a VPS instead of a tunnel

---

## References

* [n8n Docs - Configure webhook URLs with reverse proxy](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
* [n8n Docs - Docker installation and tunnel](https://docs.n8n.io/hosting/installation/docker/)
* [n8n Docs - npm installation and tunnel](https://docs.n8n.io/hosting/installation/npm/)
* [Cloudflare Docs - Cloudflare Tunnel overview](https://developers.cloudflare.com/tunnel/)
* [Cloudflare Docs - Downloads](https://developers.cloudflare.com/tunnel/downloads/)
* [Cloudflare Docs - Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
* [ngrok Downloads](https://ngrok.com/downloads)
* [ngrok Docs - Free plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)
