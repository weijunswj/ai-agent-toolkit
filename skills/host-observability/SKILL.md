---
name: host-observability
description: Use when explicitly asked to set up, check or repair monitoring on a Linux server or VPS, including an hourly host pulse, capacity states, an off-host heartbeat, alert channel set-up, or a read-only update watch for OS packages, Docker and platform parts. Do not use for app performance tuning, log analysis or n8n work.
---

# Host Observability

## Overview

One monitor per Linux host, assuming the provider offers no monitoring. A read-only hourly pulse classifies the host, an off-host heartbeat notices when the host goes quiet, alerts go wherever the owner chose, and a read-only update watch reports what is behind. Toolkit runs no central service: everything runs on the target host.

## Use When

- Setting up, checking or repairing host monitoring on a Linux server or VPS.
- Reading a pulse or update-watch report, or deciding whether a host needs more capacity.
- Choosing how alerts and the off-host heartbeat reach the owner.

## Do Not Use When

- App-level performance, tracing or log analysis inside one service.
- n8n work: apply `n8n-safety-router` first.
- Broader exposure, DNS, TLS or first-run hardening: use `self-hosted-service-safety`.

## Steps

1. **Discover, read-only.** With SSH access the owner already set up (keys in their own `.ssh`), check the OS, whether systemd and Docker are present, the disks that matter, and any health URLs. Run `scripts/host-pulse.sh` and `scripts/update-watch.sh` with `--dry-run` from a copy on the host; both change nothing.
2. **Ask about alerts and the heartbeat.** No channel is a default. Ask the owner, offer the options in `references/alert-options.md`, and record the answer. Never ask for a token or URL in chat; the owner puts values in the env file on the host.
3. **Show the install plan.** Run `scripts/install-host-observability-systemd.sh` with no option: it prints what it would change. Install with `--install` only after the owner approves that host.
4. **Prove it works.** Run `host-pulse.sh --test-alert` and `--test-heartbeat`; confirm with the owner that the alert arrived and the heartbeat service saw the ping. Read the first pulse and update-watch reports.
5. **Check later.** `host-pulse.sh --status` gives the last state and its age. Read `latest-pulse.md` and `latest-update-watch.md` under `/var/lib/host-observability/reports/`.

## States

`NORMAL`, `REVIEW_CAPACITY`, `UPGRADE_OR_REBALANCE_REQUIRED`, `EMERGENCY_PRESSURE` and `OBSERVABILITY_DEGRADED`, with services reported beside them. A missing or old pulse, a failed collector, or missing alerting or heartbeat is `OBSERVABILITY_DEGRADED`, never healthy. Thresholds are per-host settings. Details: `references/host-states.md`.

## Update Watch

Counts pending OS and security updates, checks the reboot-needed marker, automatic security updates and the Docker engine against the local package index, and runs plug-in rows from platform skills (for example Coolify). A version it cannot check is `UNKNOWN`, never up to date. It reports and suggests; it never installs, upgrades or refreshes anything.

## Files

- `scripts/host-pulse.sh`: the pulse (also `--dry-run`, `--status`, `--test-alert`, `--test-heartbeat`).
- `scripts/update-watch.sh`: the update watch (also `--dry-run`).
- `scripts/install-host-observability-systemd.sh`: plan by default; `--install` or `--remove`.
- `scripts/lib/host-observability-common.sh`: shared redaction and alert delivery.
- `templates/host-pulse.env.example`: every setting, placeholders only.

## Output

Report the host, its state and services, every non-normal row with its evidence, the update-watch result, whether alerting and the heartbeat were proven with a test, and the owner decisions still needed. Say "not checked" for anything not run.

## Safety Boundary

- The pulse and update watch are read-only. Remediation, resizes, package upgrades, reboots and restarts are separate owner-approved actions.
- Installing or removing the timers, editing the env file, and sending test alerts change a live host or send messages: each needs the owner's approval naming the host.
- Secrets stay in the env file on the host (mode 600), never in chat, git, reports or alerts; the scripts redact them.
- Provider metrics (for example Hostinger or Coolify dashboards) are optional extra evidence only.
