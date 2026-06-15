#!/usr/bin/env bash
set -u

# Read-only evidence collection only. Do not change packages, restart services, mutate Docker, change firewall rules, or remediate.

umask 077

MAINTENANCE_ROOT="${MAINTENANCE_ROOT:-/data/maintenance}"
REPORT_DIR="${REPORT_DIR:-$MAINTENANCE_ROOT/reports}"
TODAY="$(date -u +%F)"
REPORT="$REPORT_DIR/$TODAY-security-check.md"
LATEST="$REPORT_DIR/latest-security-check.md"
WARN_COUNT=0
FAIL_COUNT=0

mkdir -p "$REPORT_DIR"
chmod 700 "$MAINTENANCE_ROOT" "$REPORT_DIR" 2>/dev/null || true
TMP_REPORT="$(mktemp "${REPORT_DIR}/.security-check.XXXXXX")"
trap 'rm -f "$TMP_REPORT"' EXIT

have() { command -v "$1" >/dev/null 2>&1; }
redact_text() {
  sed -E \
    -e 's#(postgres(ql)?|mysql|redis)://[^[:space:]]+#<redacted-db-url>#Ig' \
    -e 's#https://api\.telegram\.org/bot[^/[:space:]]+#https://api.telegram.org/bot<redacted>#Ig' \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@#\1<redacted-userinfo>@#g' \
    -e 's#([?&][^=[:space:]&]*(token|secret|password|passwd|api[_-]?key|key|auth|signature|sig|access[_-]?token|refresh[_-]?token)[^=[:space:]&]*=)[^&#[:space:]]+#\1<redacted>#Ig' \
    -e 's#(token|secret|password|passwd|api[_-]?key)=([^[:space:]]+)#\1=<redacted>#Ig' \
    -e 's#(Authorization:[[:space:]]*(Bearer|Basic)[[:space:]]+)[A-Za-z0-9._~+/-]+=*#\1<redacted>#Ig'
}
secret_like_url() {
  printf '%s' "$1" | grep -Eiq '://[^/@]+@|[?&][^=]*(token|secret|password|passwd|api[_-]?key|key|auth|signature|sig|access[_-]?token|refresh[_-]?token)='
}
safe_backup_find_root() {
  local path="$1" real_path
  case "$path" in
    /*) ;;
    *) return 2 ;;
  esac
  [ -d "$path" ] || return 3
  real_path="$(cd -- "$path" 2>/dev/null && pwd -P)" || return 3
  case "$real_path" in
    /*) printf '%s/.' "$real_path" ;;
    *) return 2 ;;
  esac
}
status_line() {
  local status="$1" area="$2" evidence="$3" followup="$4"
  case "$status" in
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
  esac
  area="$(printf '%s' "$area" | redact_text)"
  evidence="$(printf '%s' "$evidence" | redact_text)"
  followup="$(printf '%s' "$followup" | redact_text)"
  printf '| %s | %s | %s | %s |\n' "$area" "$status" "$evidence" "$followup" >> "$TMP_REPORT"
}
append_block() {
  local title="$1" cmd="$2"
  {
    printf '\n### %s\n\n```text\n' "$title"
    bash -c "$cmd" 2>&1 | redact_text | head -n 120
    printf '```\n'
  } >> "$TMP_REPORT"
}
notification_targets() {
  local targets=''
  if [ -n "${NOTIFY_TELEGRAM_BOT_TOKEN:-}" ] || [ -n "${NOTIFY_TELEGRAM_CHAT_ID:-}" ]; then
    targets="${targets:+$targets, }telegram"
  fi
  if [ -n "${NOTIFY_EMAIL_TO:-}" ]; then
    targets="${targets:+$targets, }local-email"
  fi
  printf '%s' "$targets"
}
report_notification_summary() {
  {
    printf 'Daily security check: %s\n' "$overall"
    printf 'Host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
    printf 'Report: %s\n\n' "$REPORT"
    awk '
      /^## Summary Checks/ {in_summary=1; next}
      /^### / {in_summary=0}
      /^## Overall status:/ {in_summary=0}
      in_summary && NF {print}
      /^WARN count:/ || /^FAIL count:/ || /^## Overall status:/ {print}
    ' "$REPORT" | head -n 45
  } | redact_text | head -c 3500
}
send_telegram_notification() {
  if [ -z "${NOTIFY_TELEGRAM_BOT_TOKEN:-}" ] && [ -z "${NOTIFY_TELEGRAM_CHAT_ID:-}" ]; then return 0; fi
  if [ -z "${NOTIFY_TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${NOTIFY_TELEGRAM_CHAT_ID:-}" ]; then
    printf 'Telegram notification skipped: NOTIFY_TELEGRAM_BOT_TOKEN and NOTIFY_TELEGRAM_CHAT_ID are both required.\n' >&2
    return 1
  fi
  if ! have curl; then
    printf 'Telegram notification skipped: curl unavailable.\n' >&2
    return 1
  fi

  local curl_config text
  curl_config="$(mktemp "${REPORT_DIR}/.telegram-curl.XXXXXX")" || return 1
  chmod 600 "$curl_config" 2>/dev/null || true
  printf 'url = "%s"\n' "https://api.telegram.org/bot${NOTIFY_TELEGRAM_BOT_TOKEN}/sendMessage" > "$curl_config"
  text="$(report_notification_summary)"
  if [ -n "${NOTIFY_TELEGRAM_THREAD_ID:-}" ]; then
    curl -fsS --max-time 15 -K "$curl_config" \
      --data-urlencode "chat_id=${NOTIFY_TELEGRAM_CHAT_ID}" \
      --data-urlencode "message_thread_id=${NOTIFY_TELEGRAM_THREAD_ID}" \
      --data-urlencode "text=$text" >/dev/null
  else
    curl -fsS --max-time 15 -K "$curl_config" \
      --data-urlencode "chat_id=${NOTIFY_TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$text" >/dev/null
  fi
  local result=$?
  rm -f "$curl_config"
  return "$result"
}
send_email_notification() {
  if [ -z "${NOTIFY_EMAIL_TO:-}" ]; then return 0; fi
  local subject
  subject="${NOTIFY_EMAIL_SUBJECT_PREFIX:-[Hostinger Coolify]} Daily security check: $overall"
  if have mail; then
    mail -s "$subject" "$NOTIFY_EMAIL_TO" < "$REPORT"
  elif [ -x /usr/sbin/sendmail ]; then
    {
      printf 'To: %s\n' "$NOTIFY_EMAIL_TO"
      printf 'Subject: %s\n' "$subject"
      printf 'Content-Type: text/plain; charset=UTF-8\n\n'
      cat "$REPORT"
    } | /usr/sbin/sendmail -t
  else
    printf 'Email notification skipped: mail and sendmail are unavailable.\n' >&2
    return 1
  fi
}
send_notifications() {
  send_telegram_notification && printf 'Telegram notification sent or not configured.\n' || printf 'Telegram notification failed; check systemd journal.\n' >&2
  send_email_notification && printf 'Email notification sent or not configured.\n' || printf 'Email notification failed; check systemd journal.\n' >&2
}

{
  printf '# Daily Security Check\n\n'
  printf 'Date/time UTC: `%s`\n\n' "$(date -u '+%Y-%m-%d %H:%M:%S')"
  printf 'Host: `%s`\n\n' "$(hostname 2>/dev/null || printf unknown)"
  printf 'Kernel: `%s`\n\n' "$(uname -sr 2>/dev/null || printf unknown)"
  printf 'Uptime: `%s`\n\n' "$(uptime -p 2>/dev/null || uptime 2>/dev/null || printf unknown)"
  printf 'This is an evidence-based pass/fail maintenance report. It states only evidence-based PASS/WARN/FAIL results. No auto-remediation was performed.\n\n'
  printf '## Summary Checks\n\n'
  printf '| Area | Status | Evidence | Follow-up |\n| --- | --- | --- | --- |\n'
} > "$TMP_REPORT"

# Disk
if df_out="$(df -P -h / 2>/dev/null)"; then
  use_pct="$(printf '%s\n' "$df_out" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  if [ "${use_pct:-0}" -ge 90 ] 2>/dev/null; then status_line FAIL 'Disk usage' "Root filesystem ${use_pct}% used" 'Free space with owner-approved cleanup or resize.'
  elif [ "${use_pct:-0}" -ge 80 ] 2>/dev/null; then status_line WARN 'Disk usage' "Root filesystem ${use_pct}% used" 'Plan cleanup or resize.'
  else status_line PASS 'Disk usage' "Root filesystem ${use_pct:-unknown}% used" 'None.'; fi
else status_line WARN 'Disk usage' 'df unavailable' 'Install/repair coreutils if unexpected.'; fi

# Memory
if have free; then
  mem_pct="$(free | awk '/Mem:/ {if ($2>0) printf "%.0f", ($3/$2)*100}')"
  if [ "${mem_pct:-0}" -ge 95 ] 2>/dev/null; then status_line FAIL 'Memory usage' "Memory ${mem_pct}% used" 'Investigate processes before restarting.'
  elif [ "${mem_pct:-0}" -ge 85 ] 2>/dev/null; then status_line WARN 'Memory usage' "Memory ${mem_pct}% used" 'Monitor workload.'
  else status_line PASS 'Memory usage' "Memory ${mem_pct:-unknown}% used" 'None.'; fi
else status_line WARN 'Memory usage' 'free unavailable' 'Install procps if unexpected.'; fi

[ -f /var/run/reboot-required ] && status_line WARN 'Reboot marker' 'Reboot required marker exists' 'Schedule owner-approved maintenance window.' || status_line PASS 'Reboot marker' 'No reboot-required marker found' 'None.'

if have apt-get; then
  updates="$(apt-get -s upgrade 2>/dev/null | awk '/^[0-9]+ upgraded/ {print; exit}')"
  security="$(apt-get -s upgrade 2>/dev/null | grep -Eic 'security|ubuntu[.-]sec' || true)"
  [ -n "$updates" ] || updates='No apt simulation summary available'
  if [ "${security:-0}" -gt 0 ] 2>/dev/null; then status_line WARN 'APT updates' "$updates; security-related lines: $security" 'Review and apply updates in approved maintenance window.'
  else status_line PASS 'APT updates' "$updates; security-related lines: ${security:-0}" 'None or routine patching.'; fi
else status_line WARN 'APT updates' 'apt-get unavailable' 'Check OS package manager manually.'; fi

if systemctl list-unit-files unattended-upgrades.service >/dev/null 2>&1; then
  ua="$(systemctl is-enabled unattended-upgrades.service 2>/dev/null || true)/$(systemctl is-active unattended-upgrades.service 2>/dev/null || true)"
  case "$ua" in *enabled/active*) status_line PASS 'Unattended upgrades' "$ua" 'None.' ;; *) status_line WARN 'Unattended upgrades' "$ua" 'Owner should decide update policy.' ;; esac
else status_line WARN 'Unattended upgrades' 'Service not detected' 'Owner should decide update policy.'; fi

if have ufw; then status_line PASS 'UFW status captured' 'See details section for numbered rules' 'Review public exposure.'; else status_line WARN 'UFW status captured' 'ufw unavailable' 'Verify firewall through provider or host firewall.'; fi
if have ss; then status_line PASS 'Listening ports captured' 'See details section' 'Confirm only intended public ports are exposed.'; else status_line WARN 'Listening ports captured' 'ss unavailable' 'Install iproute2 if unexpected.'; fi

SSHD_BIN="$(command -v sshd 2>/dev/null || true)"
[ -n "$SSHD_BIN" ] || SSHD_BIN="/usr/sbin/sshd"
if [ -x "$SSHD_BIN" ]; then
  sshd_effective="$("$SSHD_BIN" -T 2>/dev/null || true)"
  password_auth="$(printf '%s\n' "$sshd_effective" | awk 'tolower($1) == "passwordauthentication" {print tolower($2); exit}')"
  pubkey_auth="$(printf '%s\n' "$sshd_effective" | awk 'tolower($1) == "pubkeyauthentication" {print tolower($2); exit}')"
  if [ "$password_auth" = "yes" ]; then
    status_line WARN 'SSH access posture' "passwordauthentication=$password_auth; pubkeyauthentication=${pubkey_auth:-unknown}" 'Prefer key-only SSH after recovery access and a second session are verified.'
  elif [ -n "$password_auth" ]; then
    status_line PASS 'SSH access posture' "passwordauthentication=$password_auth; pubkeyauthentication=${pubkey_auth:-unknown}" 'None.'
  else
    status_line WARN 'SSH access posture' 'Could not read passwordauthentication from sshd -T' 'Inspect sshd configuration manually.'
  fi
else status_line WARN 'SSH access posture' 'sshd unavailable' 'Inspect SSH configuration manually.'; fi

if have docker; then
  unhealthy="$(docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -Eic 'unhealthy|Restarting' || true)"
  coolify="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Eic 'coolify|coolify-' || true)"
  if [ "${unhealthy:-0}" -gt 0 ] 2>/dev/null; then status_line FAIL 'Docker containers' "$unhealthy unhealthy/restarting containers; Coolify-like containers: ${coolify:-0}" 'Inspect logs; restart only with approval if production-impacting.'
  else status_line PASS 'Docker containers' "No unhealthy/restarting containers detected; Coolify-like containers: ${coolify:-0}" 'None.'; fi
else status_line WARN 'Docker containers' 'docker unavailable' 'Expected only before Docker/Coolify install.'; fi

if have journalctl; then
  auth_failures="$(journalctl --since '24 hours ago' 2>/dev/null | grep -Eic 'Failed password|authentication failure|Invalid user' || true)"
  critical="$(journalctl -p crit..alert --since '24 hours ago' 2>/dev/null | wc -l | tr -d ' ')"
  [ "${auth_failures:-0}" -gt 20 ] && status_line WARN 'SSH/auth failures' "$auth_failures recent auth failures" 'Review source patterns and access controls.' || status_line PASS 'SSH/auth failures' "${auth_failures:-0} recent auth failures" 'None.'
  [ "${critical:-0}" -gt 0 ] && status_line WARN 'Critical system errors' "$critical recent critical log lines" 'Review journal details.' || status_line PASS 'Critical system errors' 'No recent critical journal lines' 'None.'
else status_line WARN 'System logs' 'journalctl unavailable' 'Check /var/log/auth.log or provider logs manually.'; fi

# Intrusion signals are read-only indicators, not proof that no intrusion occurred.
if have getent; then
  uid0_accounts="$(getent passwd | awk -F: '$3 == 0 {print $1}' | paste -sd ',' -)"
  extra_uid0="$(printf '%s' "$uid0_accounts" | tr ',' '\n' | grep -vx root | paste -sd ',' - || true)"
  [ -n "$extra_uid0" ] && status_line FAIL 'Intrusion signal: UID 0 accounts' "Extra UID 0 accounts: $extra_uid0" 'Investigate account ownership before changes.' || status_line PASS 'Intrusion signal: UID 0 accounts' "UID 0 accounts: ${uid0_accounts:-unknown}" 'Review if unexpected.'
  sudo_users="$(getent group sudo wheel 2>/dev/null | awk -F: '$4 != "" {print $1 ":" $4}' | paste -sd ';' -)"
  [ -n "$sudo_users" ] && status_line PASS 'Intrusion signal: sudo-capable users captured' 'sudo/wheel membership captured in details' 'Owner should review expected admins.' || status_line WARN 'Intrusion signal: sudo-capable users captured' 'No sudo/wheel membership found or group unavailable' 'Verify expected admin access.'
else status_line WARN 'Intrusion signal: account inventory' 'getent unavailable' 'Review users and sudoers manually.'; fi

if have find; then
  auth_key_count="$(find /root /home -path '*/.ssh/authorized_keys' -type f 2>/dev/null | wc -l | tr -d ' ')"
  writable_auth_keys="$(find /root /home -path '*/.ssh/authorized_keys' -type f -perm /022 2>/dev/null | wc -l | tr -d ' ')"
  [ "${writable_auth_keys:-0}" -gt 0 ] && status_line WARN 'Intrusion signal: SSH key files' "$auth_key_count authorized_keys files; $writable_auth_keys group/world-writable" 'Review key files and permissions.' || status_line PASS 'Intrusion signal: SSH key files' "${auth_key_count:-0} authorized_keys files; none group/world-writable" 'Review key owners if unexpected.'
  cron_count="$(find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly /var/spool/cron /var/spool/cron/crontabs -type f 2>/dev/null | wc -l | tr -d ' ')"
  status_line PASS 'Intrusion signal: cron inventory captured' "${cron_count:-0} cron files detected" 'Review details for unexpected persistence.'
else status_line WARN 'Intrusion signal: filesystem inventory' 'find unavailable' 'Review SSH keys and cron manually.'; fi

if [ -n "${HEALTHCHECK_URLS:-}" ]; then
  for url in $HEALTHCHECK_URLS; do
    label="$(printf '%s' "$url" | redact_text)"
    if secret_like_url "$url"; then
      status_line WARN "Healthcheck $label" 'Skipped secret-looking healthcheck URL' 'Use a non-secret health endpoint without userinfo or token-like query parameters.'
      continue
    fi
    code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
    [ "$code" = 200 ] && status_line PASS "Healthcheck $label" 'HTTP 200' 'None.' || status_line FAIL "Healthcheck $label" "HTTP ${code:-failed}" 'Investigate app/proxy before changes.'
  done
else status_line WARN 'Healthcheck URLs' 'HEALTHCHECK_URLS not configured' 'Configure non-secret URLs if desired.'; fi

if [ -n "${HEALTHCHECK_HOSTS:-}" ] && have openssl; then
  for host in $HEALTHCHECK_HOSTS; do
    expiry="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')"
    if [ -n "$expiry" ]; then status_line PASS "Certificate $host" "Expires $expiry" 'Review if near expiry.'; else status_line WARN "Certificate $host" 'Could not read certificate expiry' 'Verify DNS/HTTPS manually.'; fi
  done
else status_line WARN 'Certificate expiry' 'HEALTHCHECK_HOSTS not configured or openssl unavailable' 'Configure hosts if desired.'; fi

if [ -n "${BACKUP_PATHS:-}" ]; then
  for path in $BACKUP_PATHS; do
    case "$path" in
      -*) status_line WARN "Backup freshness $path" 'Rejected unsafe backup path' 'Use absolute directory paths that do not begin with a dash.'; continue ;;
      /*) ;;
      *) status_line WARN "Backup freshness $path" 'Rejected non-absolute backup path' 'Use absolute directory paths only.'; continue ;;
    esac
    if backup_root="$(safe_backup_find_root "$path")"; then
      newest="$(find "$backup_root" -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
      [ -n "$newest" ] && status_line PASS "Backup freshness $path" "Newest file: $(basename "$newest")" 'Verify restore separately.' || status_line WARN "Backup freshness $path" 'No files found' 'Verify backup job.'
    else status_line WARN "Backup freshness $path" 'Path not found or unsafe after canonicalization' 'Use an existing absolute backup directory.'; fi
  done
else status_line WARN 'Backup freshness' 'BACKUP_PATHS not configured' 'Configure paths and verify restores manually.'; fi

notify_targets="$(notification_targets)"
if [ -n "$notify_targets" ]; then
  status_line PASS 'Daily notification configured' "$notify_targets configured" 'Verify delivery after timer installation.'
else
  status_line WARN 'Daily notification configured' 'No Telegram or local email notifier configured' 'Configure owner-controlled notification env if daily alerts are desired.'
fi

append_block 'Disk Details' 'df -h'
have free && append_block 'Memory Details' 'free -h'
have ufw && append_block 'UFW Numbered Rules' 'ufw status numbered'
have ss && append_block 'Listening Ports' 'ss -tulpn'
have docker && append_block 'Docker Containers' "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
have docker && append_block 'Coolify-like Containers' "docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | grep -Ei 'coolify|coolify-' || true"
have journalctl && append_block 'Recent Auth Failures Summary' "journalctl --since '24 hours ago' | grep -Ei 'Failed password|authentication failure|Invalid user' | tail -n 50 || true"
have journalctl && append_block 'Recent Critical System Errors' "journalctl -p crit..alert --since '24 hours ago' | tail -n 80 || true"
have last && append_block 'Recent Successful Logins' "last -n 20 -F || true"
if [ -x "$SSHD_BIN" ]; then append_block 'SSH Effective Security Settings' "\"$SSHD_BIN\" -T 2>/dev/null | grep -Ei '^(passwordauthentication|pubkeyauthentication|permitrootlogin|authenticationmethods|maxauthtries) ' || true"; fi
append_block 'Account Privilege Inventory' "getent passwd | awk -F: '\$3 == 0 {print \"uid0:\" \$1}' ; getent group sudo wheel 2>/dev/null | awk -F: '\$4 != \"\" {print \$1 \":\" \$4}'"
have find && append_block 'SSH Authorized Keys Inventory' "find /root /home -path '*/.ssh/authorized_keys' -type f -printf '%m %u:%g %TY-%Tm-%Td %TH:%TM %p lines=' -exec sh -c 'wc -l < \"\$1\"' sh {} \\; 2>/dev/null | head -n 80"
have find && append_block 'Cron Persistence Inventory' "find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly /var/spool/cron /var/spool/cron/crontabs -type f -printf '%m %u:%g %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | head -n 120"
have systemctl && append_block 'Systemd Timer Inventory' "systemctl list-timers --all --no-pager 2>/dev/null | head -n 120"

if [ "$FAIL_COUNT" -gt 0 ]; then overall=FAIL; elif [ "$WARN_COUNT" -gt 0 ]; then overall=WARN; else overall=PASS; fi
sed -i "0,/Overall status:/s//Overall status: $overall/" "$TMP_REPORT" 2>/dev/null || true
{
  printf '\n## Overall status: %s\n\n' "$overall"
  printf 'WARN count: %s\n\nFAIL count: %s\n' "$WARN_COUNT" "$FAIL_COUNT"
} >> "$TMP_REPORT"

mv "$TMP_REPORT" "$REPORT"
cp "$REPORT" "$LATEST"
printf 'Wrote %s and %s\n' "$REPORT" "$LATEST"
printf 'Overall status: %s\n' "$overall"
send_notifications
