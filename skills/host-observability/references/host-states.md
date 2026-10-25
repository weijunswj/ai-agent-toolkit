# Host States

The pulse gives the host one state, the worst of its rows, ranked from best to worst:

| State | Meaning | Typical next step |
| --- | --- | --- |
| `NORMAL` | Every signal is under its review threshold, the pulse is fresh, alerting and the heartbeat are set up. | None. |
| `REVIEW_CAPACITY` | A signal crossed its review threshold, or there was a first out-of-memory kill or container restart. | Watch the trend; plan clean-up or a capacity review. |
| `UPGRADE_OR_REBALANCE_REQUIRED` | A signal crossed its upgrade threshold, or out-of-memory kills or container restarts repeated. | Plan an owner-approved resize, clean-up or moving workloads. |
| `OBSERVABILITY_DEGRADED` | The pulse cannot vouch for the host: a collector failed, the pulse had a gap, alerting or the off-host heartbeat is not set up, or a setting is invalid. | Fix the monitoring first; never read this as healthy. |
| `EMERGENCY_PRESSURE` | Disk, inodes, memory, swap or load crossed its emergency threshold now. | Alert at once; act with the owner's approval. |

Services (failed systemd units, unhealthy or restarting containers, failing health URLs) are reported beside the state as `Services: OK` or `Services: FAILING (n)`. A failing service always triggers an alert, but it does not change the capacity state.

## Signals

- **CPU load:** the 15-minute load average as a percent of the CPU count.
- **Memory:** used memory, counting available memory as free.
- **Swap:** used swap; not applicable when the host has none.
- **Disk and inodes:** each path in `DISK_PATHS` (default `/`).
- **Out-of-memory kills:** new kills since the last pulse, from the kernel counter, compared within one boot.
- **Uptime and reboots:** a reboot since the last pulse is a notice and sends an alert.
- **Pulse continuity:** a gap longer than `PULSE_STALE_MINUTES` (default 70, for an hourly timer) means the host or timer was down.
- **systemd and Docker:** reported as not applicable, with the reason, when missing; a command that fails is a degraded row.
- **Health URLs:** plain URLs only; a URL with credentials or token-like values is skipped and reported.

Thresholds are per-host settings in the env file. Defaults suit a small single-purpose VPS; tune them to the host and record why.

## Alerts

An alert goes out when the state or the services change, at once on `EMERGENCY_PRESSURE` (every run while it lasts), on a notice such as a reboot, and again on the next run after a failed delivery. A failed delivery stays in the report and is never recorded as sent.

## Update Watch

The update watch has its own report and statuses: `OK`, `WARN` (security updates pending, a reboot needed, automatic security updates off, the package index old, or a component behind the latest available version), `UNKNOWN` (the latest version cannot be checked, which is never reported as up to date) and `N/A`. Its overall result is `WARN` if any row warns, else `UNKNOWN` if any row is unknown, else `OK`.

Platform skills add rows through plug-ins: executable `*.sh` files in `/etc/host-observability/update-watch.d/`, owned by root, writable by nobody else, each printing lines of `area|installed|latest|status|evidence`. A plug-in must be a read-only check.
