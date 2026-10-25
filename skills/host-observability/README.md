# Host Observability

Hourly read-only health pulse, off-host heartbeat and owner-chosen alerts for one Linux host.

## Use This Skill For

- Setting up, checking or repairing monitoring on a Linux server or VPS.
- Reading pulse reports and deciding on capacity.
- Choosing how alerts and the heartbeat reach the owner.

## Not For

- App-level performance, tracing or log analysis.
- n8n work (apply `n8n-safety-router` first) or broader exposure review (`self-hosted-service-safety`).
- Tracking OS, Docker or platform updates.

## What It Ships

- `scripts/host-pulse.sh`: classifies the host into `NORMAL`, `REVIEW_CAPACITY`, `UPGRADE_OR_REBALANCE_REQUIRED`, `EMERGENCY_PRESSURE` or `OBSERVABILITY_DEGRADED`, pings the heartbeat and sends alerts.
- `scripts/install-host-observability-systemd.sh`: prints its plan unless run with `--install` or `--remove`.
- `templates/host-pulse.env.example` and `references/` for alert options and state details.

## Expected Output

Host state and services, non-normal rows with evidence, whether alerting and the heartbeat were proven, and the owner decisions still needed.
