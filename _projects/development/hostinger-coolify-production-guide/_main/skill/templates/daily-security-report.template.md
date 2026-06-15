# Daily Security Report

Date/time UTC: `<YYYY-MM-DD HH:MM>`
Host: `<hostname>`
Overall status: `<PASS|WARN|FAIL>`

## Checks

| Area | Status | Evidence | Follow-up |
| --- | --- | --- | --- |
| Disk usage | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Memory usage | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Updates | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Firewall and ports | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Docker and Coolify | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Auth/system errors | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Intrusion signals | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| SSH access posture | `<PASS|WARN|FAIL>` | `<summary of key access/password-auth status when inspectable; no key material>` | `<action>` |
| Healthchecks/certificates/backups | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |
| Daily notification | `<PASS|WARN|FAIL>` | `<summary>` | `<action>` |

Do not include secrets, tokens, private keys, cookies, database URLs, or env file contents.
Healthcheck URLs must be non-secret. Skip and replace any URL that contains userinfo or token-like query parameters.
Backup freshness paths must be absolute directories. Reject relative paths and leading-dash paths instead of passing them to filesystem tools.
Daily notifications may use Telegram or local email only when the owner configures secrets in `/data/maintenance/daily-security-check.env` outside chat. Notification delivery is reporting only, not remediation.
