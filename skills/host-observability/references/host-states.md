# Host States

The pulse gives the host one state, the worst of its rows, ranked from best to worst:

| State | Meaning | Typical next step |
| --- | --- | --- |
| `NORMAL` | Every signal is under its review threshold, the pulse is fresh, alerting and the heartbeat are set up. | None. |
| `REVIEW_CAPACITY` | A signal crossed its review threshold (load only when sustained), disk grew fast, or there was a first out-of-memory kill or container restart. | Watch the trend; plan clean-up or a capacity review. |
| `UPGRADE_OR_REBALANCE_REQUIRED` | A signal crossed its upgrade threshold, or out-of-memory kills or container restarts repeated. | Plan an owner-approved resize, clean-up or moving workloads. |
| `OBSERVABILITY_DEGRADED` | The pulse cannot vouch for the host: a collector failed, a tool it needs (such as `curl`) is missing, the pulse had a gap, an alert failed to send, alerting or the off-host heartbeat is not set up, or a setting is invalid. | Fix the monitoring first; never read this as healthy. |
| `EMERGENCY_PRESSURE` | Disk, inodes, memory, swap or load crossed its emergency threshold now. | Alert at once; act with the owner's approval. |

Services (failed systemd units, unhealthy or restarting containers, containers that stopped with a non-zero exit code, failing health URLs) are reported beside the state as `Services: OK` or `Services: FAILING (n)`. A failing service always triggers an alert, but it does not change the capacity state.

## Signals

- **CPU load:** the 15-minute load average as a percent of the CPU count. It counts only after `LOAD_SUSTAIN_PULSES` pulses in a row over the review threshold (default 2), so one busy hour is not pressure; emergency load counts at once.
- **Memory:** used memory, counting available memory as free.
- **Swap:** used swap; not applicable when the host has none.
- **Disk and inodes:** each path in `DISK_PATHS` (default `/`). Disk use that grew by `DISK_GROWTH_REVIEW_POINTS` or more since the last pulse (default 5) needs a review even under the review threshold. Memory, swap, disk and inodes are levels, so one reading counts.
- **Out-of-memory kills:** new kills since the last pulse, from the kernel counter, compared within one boot.
- **Uptime and reboots:** a reboot since the last pulse is a notice and sends an alert.
- **Pulse continuity:** a gap of more than `PULSE_STALE_MINUTES` whole minutes (default 60, for the hourly timer) means the host or timer was down. `--status` uses the same limit.
- **systemd and Docker:** reported as not applicable, with the reason, when missing, and every other row is still classified; a command that fails is a degraded row. Containers listed in `DOCKER_EXITED_OK_CONTAINERS` may stay exited. Docker checks follow who the pulse really runs as: root or a member of the docker group (installed with `--with-docker`). Otherwise the Docker rows read "Not checked" and are not degraded: that is the owner's choice. No env setting can change this. The pulse leaves its own test units out of the failed-unit list.
- **Disks under `/home`, `/root` or `/run/user`:** the service sandbox hides them, so they are degraded "Not checked" rows, never a false `NORMAL`; leave them out of `DISK_PATHS`.
- **Health URLs:** plain URLs only; a URL with credentials or token-like values is skipped and reported. Without `curl` they are reported as not checked, never as failing.

Thresholds are per-host settings in the env file. Defaults suit a small single-purpose VPS; tune them to the host and record why.

## Alerts

An alert goes out when the state, the services or the names of the failing services change, at once on `EMERGENCY_PRESSURE` (every run while it lasts), on a notice such as a reboot, and again on the next run after a failed delivery. A failed delivery stays in the report, is never recorded as sent, and makes that pulse `OBSERVABILITY_DEGRADED`, so the failure heartbeat URL and `--status` show it too. With no failure URL set, that pulse skips the heartbeat ping instead, so the off-host monitor raises its missed-ping alarm.
