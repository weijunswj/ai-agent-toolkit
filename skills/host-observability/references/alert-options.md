# Alert And Heartbeat Options

Toolkit picks no alert channel and no heartbeat service. At set-up, ask the owner how alerts and the off-host heartbeat should reach them, offer the options below, and record the answer in the env file on the host. If the owner skips either, say plainly that the host will show `OBSERVABILITY_DEGRADED` until it is set up.

## Ask

1. "Where do you want server alerts to reach you?" Offer the alert options. More than one is fine.
2. "Which outside service should notice if this server goes quiet?" Offer the heartbeat options. It must run somewhere other than this host.

Never ask the owner to paste a token, chat ID, webhook URL or heartbeat URL into chat. They put the values into the env file on the host themselves. Webhook and heartbeat URLs carry secrets, so they must be `https`; plain `http` is accepted only to the host itself (`127.0.0.1`, `localhost` or `[::1]`).

## Alert Channels

| Option | Env settings | Good for | Watch out for |
| --- | --- | --- | --- |
| Webhook to Slack | `ALERT_CHANNELS=webhook`, `ALERT_WEBHOOK_FORMAT=slack`, `ALERT_WEBHOOK_URL` | teams already in Slack | the webhook URL is a secret |
| Webhook to Discord | `ALERT_WEBHOOK_FORMAT=discord` | personal or small-team servers | messages are cut to fit Discord's size limit |
| ntfy push (hosted or self-hosted) | `ALERT_WEBHOOK_FORMAT=ntfy`, the topic URL | phone push without a chat app | a public topic name is readable by anyone who guesses it; use a long random topic or access control |
| Telegram bot | `ALERT_CHANNELS=telegram`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | owners who already use Telegram | the bot token is a secret |
| Email | `ALERT_CHANNELS=email`, `ALERT_EMAIL_TO` | inbox-based owners | needs `mail` or `sendmail` on the host; the pulse's sandbox has no write access to a local mail queue, so use a mailer that relays straight out (for example msmtp). The mailer config holds the SMTP password and must be readable by `host-pulse` and nobody else, for example owner root, group `host-pulse`, mode 640; never make it world-readable. Many VPS providers block outbound mail |
| Any other webhook | `ALERT_WEBHOOK_FORMAT=json` (or `text`) | your own automation or incident tool | it receives `source`, `host`, `subject` and `text` fields |

## Off-Host Heartbeat

The pulse pings `HEARTBEAT_URL` on every run. The heartbeat service alarms when pings stop, which covers the cases the host cannot report itself: it is down, out of disk, or the timer was stopped.

| Option | Notes |
| --- | --- |
| Hosted dead-man's-switch service (for example Healthchecks.io, Better Stack heartbeats or Cronitor) | Set the expected period to one hour and a grace time of about 15 minutes. Healthchecks-style services also accept a `/fail` ping; put that in `HEARTBEAT_FAIL_URL` to alarm sooner on emergency or degraded pulses. |
| Self-hosted Healthchecks | Same as the hosted one, run on a different machine. |
| Self-hosted push monitor (for example an Uptime Kuma push monitor) | Run it on a different machine; a monitor on the same host goes down with it. Use the push URL its settings show. |

Check the chosen service's own docs for the ping URL and its free-tier limits before recommending it; they change.

## After Set-Up

Run the tests through the two installed test units, so systemd reads the env file and applies the same sandbox as the hourly timer:

```bash
sudo systemctl start host-pulse-test-alert.service; sudo journalctl -u host-pulse-test-alert.service -n 5 --no-pager
sudo systemctl start host-pulse-test-heartbeat.service; sudo journalctl -u host-pulse-test-heartbeat.service -n 5 --no-pager
```

Do not load the env file with a shell instead: a shell reads `$`, backticks, `&` and `;` differently from systemd, so a test could pass while the timer fails.

Then confirm with the owner that the test alert arrived and the heartbeat service shows a ping. Only then report alerting as working. A test unit that failed (for example before the env file was filled in) stays in systemd's failed list until `sudo systemctl reset-failed host-pulse-test-alert.service host-pulse-test-heartbeat.service`; the pulse leaves those two units out of its own checks.

A failure heartbeat URL matters: when an alert fails to send, the pulse pings `HEARTBEAT_FAIL_URL`. With no failure URL it skips the ping instead, so the off-host monitor still raises its missed-ping alarm and the owner hears that something is wrong.
