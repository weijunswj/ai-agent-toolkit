---
name: host-observability
description: Use when explicitly asked to set up, check or repair monitoring on a Linux server or VPS, including an hourly host pulse, capacity states, an off-host heartbeat, or alert channel set-up. Do not use for app performance tuning, log analysis, update tracking or n8n work.
---

# Host Observability

## Overview

One monitor per Linux host, assuming the provider offers no monitoring. A read-only hourly pulse classifies the host, an off-host heartbeat notices when the host goes quiet, and alerts go wherever the owner chose. Toolkit runs no central service: everything runs on the target host.

## Use When

- Setting up, checking or repairing host monitoring on a Linux server or VPS.
- Reading a pulse report, or deciding whether a host needs more capacity.
- Choosing how alerts and the off-host heartbeat reach the owner.

## Do Not Use When

- App-level performance, tracing or log analysis inside one service.
- n8n work: apply `n8n-safety-router` first.
- Broader exposure, DNS, TLS or first-run hardening: use `self-hosted-service-safety`.
- Tracking OS, Docker or platform updates: out of scope for this skill.

## Steps

1. **Discover, read-only.** With SSH access the owner already set up (keys in their own `.ssh`), check the OS, that systemd is running (the installer refuses without it), whether Docker is present, the disks that matter, and any health URLs. Run `scripts/host-pulse.sh` with `--dry-run` from a copy on the host; it changes nothing.
2. **Ask about alerts and the heartbeat.** No channel is a default. Ask the owner, offer the options in `references/alert-options.md`, and record the answer. Prefer a heartbeat service with a failure URL; without one, a failed alert skips the ping so the monitor still alarms. Never ask for a token or URL in chat; the owner puts values in the env file on the host.
3. **Show the install plan.** Ask whether to turn on Docker checks (`--with-docker`), and say plainly that Docker socket access gives the service the equivalent of root on this host. Run `scripts/install-host-observability-systemd.sh` (plus `--with-docker` if chosen) with no other option: it prints what it would change. Install with `--install` only after the owner approves that host and that choice. A failed install puts back what was there before.
4. **Prove it works.** Run `systemctl start host-pulse-test-alert.service` and `host-pulse-test-heartbeat.service` (same env file and sandbox as the timer; output in `journalctl -u`); confirm with the owner that the alert arrived and the heartbeat service saw the ping. Read the first pulse report.
5. **Check later.** `sudo host-pulse.sh --status` gives the last state and its age. Read `latest-pulse.md` under `/var/lib/host-observability/reports/`.
6. **Remove or roll back.** `--remove` stops the timer and removes the units, scripts and backups, deletes the `host-pulse` system user if the installer created it, and keeps the env file and reports; for a full removal also delete `/etc/host-observability/host-pulse.env` (it holds the secrets) and `/var/lib/host-observability/` (the service's state). To roll back an upgrade, copy the files in `/etc/host-observability/backup/previous/` back and run `systemctl daemon-reload`.

## States

`NORMAL`, `REVIEW_CAPACITY`, `UPGRADE_OR_REBALANCE_REQUIRED`, `EMERGENCY_PRESSURE` and `OBSERVABILITY_DEGRADED`, with services reported beside them. A pulse older than 60 minutes, a failed collector, a missing tool, a failed alert delivery, or missing alerting or heartbeat is `OBSERVABILITY_DEGRADED`, never healthy. Thresholds are per-host settings. Details: `references/host-states.md`.

## Files

- `scripts/host-pulse.sh`: the pulse (also `--dry-run`, `--status`, `--test-alert`, `--test-heartbeat`).
- `scripts/install-host-observability-systemd.sh`: plan by default; `--install` or `--remove`. Writes `host-pulse.service`, `host-pulse.timer` and the two test units.
- `scripts/lib/host-observability-common.sh`: shared redaction and alert delivery.
- `templates/host-pulse.env.example`: every setting, placeholders only.

## Output

Report the host, its state and services, every non-normal row with its evidence, whether alerting and the heartbeat were proven with a test, and the owner decisions still needed. Say "not checked" for anything not run.

## Safety Boundary

- The pulse is read-only. It runs as `host-pulse`, an unprivileged system user with no login that the installer creates, with no capabilities, a read-only view of the system and write access only to its state folder; systemd reads the env file for it.
- Docker checks are off unless installed with `--with-docker`. Docker socket access is full control of Docker, which equals full root on this host, and the sandbox does not limit what Docker can be asked to do; the pulse itself only lists and inspects containers.
- Remediation, resizes, package upgrades, reboots and restarts are separate owner-approved actions.
- Installing or removing the timer, editing the env file, and sending test alerts change a live host or send messages: each needs the owner's approval naming the host.
- Secrets stay in the env file on the host (mode 600), never in chat, git, reports or alerts; the scripts redact them.
- Provider metrics (for example Hostinger or Coolify dashboards) are optional extra evidence only.
