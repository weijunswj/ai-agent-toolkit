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

append_block 'Disk Details' 'df -h'
have free && append_block 'Memory Details' 'free -h'
have ufw && append_block 'UFW Numbered Rules' 'ufw status numbered'
have ss && append_block 'Listening Ports' 'ss -tulpn'
have docker && append_block 'Docker Containers' "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
have docker && append_block 'Coolify-like Containers' "docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | grep -Ei 'coolify|coolify-' || true"
have journalctl && append_block 'Recent Auth Failures Summary' "journalctl --since '24 hours ago' | grep -Ei 'Failed password|authentication failure|Invalid user' | tail -n 50 || true"
have journalctl && append_block 'Recent Critical System Errors' "journalctl -p crit..alert --since '24 hours ago' | tail -n 80 || true"

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
