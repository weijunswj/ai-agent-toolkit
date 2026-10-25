#!/usr/bin/env bash
set -u

# Host pulse: a read-only check of one Linux host. It reads CPU load, memory, swap, out-of-memory
# kills, disk and inodes, uptime and reboots, failed systemd units, Docker container state and
# optional health URLs, classifies the host into one of five states, writes one bounded report,
# pings the owner's off-host heartbeat URL and sends an alert through the channel the owner chose.
# It never installs, restarts, deletes, changes packages, Docker, firewall or services, or fixes
# anything. Thresholds and channels come from the env file; see templates/host-pulse.env.example.

umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/host-observability-common.sh
. "$SCRIPT_DIR/lib/host-observability-common.sh"

usage() {
  cat <<'USAGE'
Usage: host-pulse.sh [--dry-run | --status | --test-alert | --test-heartbeat]
  (no option)       collect, classify, write the report, ping the heartbeat, alert when needed
  --dry-run         collect and print the report only; no report file, heartbeat, alert or state change
  --status          print the state and age of the last pulse; a missing or old pulse is degraded
  --test-alert      send one test message through the chosen alert channels
  --test-heartbeat  ping the heartbeat URL once
USAGE
}

MODE=run
case "${1:-}" in
  '') ;;
  --dry-run) MODE=dry-run ;;
  --status) MODE=status ;;
  --test-alert) MODE=test-alert ;;
  --test-heartbeat) MODE=test-heartbeat ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 2; }

HOST_PULSE_ROOT="${HOST_PULSE_ROOT:-/var/lib/host-observability}"
# The pulse creates and tightens folders under HOST_PULSE_ROOT, so it only accepts its own folder.
case "$HOST_PULSE_ROOT" in
  /*/host-observability) ;;
  *) printf 'HOST_PULSE_ROOT must be an absolute path ending in /host-observability (got: %s)\n' "$HOST_PULSE_ROOT" >&2; exit 2 ;;
esac
REPORT_DIR="$HOST_PULSE_ROOT/reports"
STATE_DIR="$HOST_PULSE_ROOT/state"
STATE_FILE="$STATE_DIR/pulse.state"
PROC_ROOT="${PROC_ROOT:-/proc}"
SYSTEMD_RUN_DIR="${SYSTEMD_RUN_DIR:-/run/systemd/system}"
HOST_LABEL="${HOST_LABEL:-$(hostname 2>/dev/null || printf unknown)}"
NOW_EPOCH="$(date +%s)"

state_rank() {
  case "$1" in
    NORMAL) echo 0 ;; REVIEW_CAPACITY) echo 1 ;; UPGRADE_OR_REBALANCE_REQUIRED) echo 2 ;;
    OBSERVABILITY_DEGRADED) echo 3 ;; EMERGENCY_PRESSURE) echo 4 ;; *) echo 3 ;;
  esac
}

ROW_AREA=(); ROW_STATE=(); ROW_EVIDENCE=()
SERVICE_AREA=(); SERVICE_STATUS=(); SERVICE_EVIDENCE=(); FAILING_KEYS=()
NOTICES=(); STATE_EXTRA=()
add_row() { ROW_STATE+=("$1"); ROW_AREA+=("$2"); ROW_EVIDENCE+=("$3"); }
# The optional fourth argument names what is failing, so a different failure re-alerts.
add_service() {
  SERVICE_STATUS+=("$1"); SERVICE_AREA+=("$2"); SERVICE_EVIDENCE+=("$3")
  [ "$1" != FAILING ] || FAILING_KEYS+=("${4:-$2}")
}

# Thresholds: per-host settings with defaults. A value that is not a whole number falls back to the
# default and the config row reports it, so a typo never silently disables a check.
CONFIG_PROBLEMS=''
set_threshold() {
  local name="$1" default="$2" value
  value="${!name:-}"
  if [ -n "$value" ] && ! is_uint "$value"; then
    CONFIG_PROBLEMS="${CONFIG_PROBLEMS:+$CONFIG_PROBLEMS; }$name is not a whole number, default $default used"
    value=''
  fi
  printf -v "$name" '%s' "${value:-$default}"
}
load_thresholds() {
  local pair
  for pair in DISK_REVIEW_PCT:75 DISK_UPGRADE_PCT:85 DISK_EMERGENCY_PCT:95 \
    INODE_REVIEW_PCT:75 INODE_UPGRADE_PCT:85 INODE_EMERGENCY_PCT:95 \
    MEM_REVIEW_PCT:75 MEM_UPGRADE_PCT:85 MEM_EMERGENCY_PCT:95 \
    SWAP_REVIEW_PCT:25 SWAP_UPGRADE_PCT:50 SWAP_EMERGENCY_PCT:90 \
    LOAD_REVIEW_PCT:80 LOAD_UPGRADE_PCT:150 LOAD_EMERGENCY_PCT:300 \
    LOAD_SUSTAIN_PULSES:2 DISK_GROWTH_REVIEW_POINTS:5 \
    OOM_REVIEW_KILLS:1 OOM_UPGRADE_KILLS:2 RESTART_REVIEW_COUNT:1 RESTART_UPGRADE_COUNT:3 \
    PULSE_STALE_MINUTES:60 REPORT_KEEP:72; do
    set_threshold "${pair%%:*}" "${pair##*:}"
  done
  [ "$LOAD_SUSTAIN_PULSES" -ge 1 ] || LOAD_SUSTAIN_PULSES=1
}

classify_pct() {
  local value="$1" review="$2" upgrade="$3" emergency="$4"
  if [ "$value" -ge "$emergency" ]; then echo EMERGENCY_PRESSURE
  elif [ "$value" -ge "$upgrade" ]; then echo UPGRADE_OR_REBALANCE_REQUIRED
  elif [ "$value" -ge "$review" ]; then echo REVIEW_CAPACITY
  else echo NORMAL; fi
}

classify_count() {
  local value="$1" review="$2" upgrade="$3"
  if [ "$value" -ge "$upgrade" ]; then echo UPGRADE_OR_REBALANCE_REQUIRED
  elif [ "$value" -ge "$review" ]; then echo REVIEW_CAPACITY
  else echo NORMAL; fi
}

meminfo_kb() { awk -v k="$1:" '$1 == k { print $2; exit }' "$PROC_ROOT/meminfo" 2>/dev/null; }

collect_disk() {
  local path line pct ipct key prev level evidence
  for path in ${DISK_PATHS:-/}; do
    case "$path" in /*) ;; *) add_row OBSERVABILITY_DEGRADED "Disk $path" 'Rejected: use absolute paths only'; continue ;; esac
    # The service sandbox (ProtectHome=yes) hides these folders, so df there would read an empty
    # stand-in and report a false NORMAL. Say so instead, the same way in a dry run.
    case "$path" in
      /home|/home/*|/root|/root/*|/run/user|/run/user/*)
        add_row OBSERVABILITY_DEGRADED "Disk $path" 'Not checked: the pulse sandbox hides /home, /root and /run/user; remove this path from DISK_PATHS'
        continue ;;
    esac
    if line="$(df -P "$path" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')" && is_uint "$line"; then
      pct="$line"
      key="disk_pct_$(printf '%s' "$path" | tr -c 'A-Za-z0-9' '_')"
      prev="$(state_get "$STATE_FILE" "$key")"
      STATE_EXTRA+=("$key=$pct")
      level="$(classify_pct "$pct" "$DISK_REVIEW_PCT" "$DISK_UPGRADE_PCT" "$DISK_EMERGENCY_PCT")"
      evidence="${pct}% used (review ${DISK_REVIEW_PCT}, upgrade ${DISK_UPGRADE_PCT}, emergency ${DISK_EMERGENCY_PCT})"
      # Growth: a fast rise since the last pulse needs a review even while under the review threshold.
      if is_uint "$prev" && [ "$pct" -gt "$prev" ] && [ "$DISK_GROWTH_REVIEW_POINTS" -gt 0 ] && [ $(( pct - prev )) -ge "$DISK_GROWTH_REVIEW_POINTS" ]; then
        evidence="$evidence; grew $(( pct - prev )) points since the last pulse (review at ${DISK_GROWTH_REVIEW_POINTS})"
        [ "$level" != NORMAL ] || level=REVIEW_CAPACITY
      fi
      add_row "$level" "Disk $path" "$evidence"
    else
      add_row OBSERVABILITY_DEGRADED "Disk $path" 'df could not read this path'
    fi
    ipct="$(df -Pi "$path" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
    if is_uint "$ipct"; then
      add_row "$(classify_pct "$ipct" "$INODE_REVIEW_PCT" "$INODE_UPGRADE_PCT" "$INODE_EMERGENCY_PCT")" "Inodes $path" "${ipct}% used"
    elif [ "$ipct" = '-' ]; then
      add_row NORMAL "Inodes $path" 'Not applicable: this filesystem does not report inodes'
    else
      add_row OBSERVABILITY_DEGRADED "Inodes $path" 'df -i could not read this path'
    fi
  done
}

collect_memory() {
  local total available swap_total swap_free pct
  total="$(meminfo_kb MemTotal)"; available="$(meminfo_kb MemAvailable)"
  if is_uint "$total" && is_uint "$available" && [ "$total" -gt 0 ]; then
    pct=$(( (total - available) * 100 / total ))
    add_row "$(classify_pct "$pct" "$MEM_REVIEW_PCT" "$MEM_UPGRADE_PCT" "$MEM_EMERGENCY_PCT")" Memory "${pct}% used of $(( total / 1024 )) MiB (available memory counted as free)"
  else
    add_row OBSERVABILITY_DEGRADED Memory 'Could not read MemTotal and MemAvailable'
  fi
  swap_total="$(meminfo_kb SwapTotal)"; swap_free="$(meminfo_kb SwapFree)"
  if is_uint "$swap_total" && is_uint "$swap_free"; then
    if [ "$swap_total" -eq 0 ]; then
      add_row NORMAL Swap 'Not applicable: no swap configured'
    else
      pct=$(( (swap_total - swap_free) * 100 / swap_total ))
      add_row "$(classify_pct "$pct" "$SWAP_REVIEW_PCT" "$SWAP_UPGRADE_PCT" "$SWAP_EMERGENCY_PCT")" Swap "${pct}% used of $(( swap_total / 1024 )) MiB"
    fi
  else
    add_row OBSERVABILITY_DEGRADED Swap 'Could not read SwapTotal and SwapFree'
  fi
}

# Load counts only when it stays over the review threshold for LOAD_SUSTAIN_PULSES pulses in a row,
# so one busy hour (a backup, a build) is not capacity pressure. Emergency load counts at once.
collect_load() {
  local load15 cpus pct level streak prev evidence
  load15="$(awk '{ print $3 }' "$PROC_ROOT/loadavg" 2>/dev/null)"
  cpus="$(grep -c '^processor' "$PROC_ROOT/cpuinfo" 2>/dev/null || true)"
  is_uint "$cpus" && [ "$cpus" -gt 0 ] || cpus="$(nproc 2>/dev/null || true)"
  if printf '%s' "$load15" | grep -Eq '^[0-9]+(\.[0-9]+)?$' && is_uint "$cpus" && [ "$cpus" -gt 0 ]; then
    pct="$(awk -v l="$load15" -v c="$cpus" 'BEGIN { printf "%d", (l / c) * 100 }')"
    level="$(classify_pct "$pct" "$LOAD_REVIEW_PCT" "$LOAD_UPGRADE_PCT" "$LOAD_EMERGENCY_PCT")"
    evidence="15-minute load $load15 on $cpus CPUs (${pct}% of capacity)"
    prev="$(state_get "$STATE_FILE" load_over_review)"
    is_uint "$prev" || prev=0
    if [ "$level" = NORMAL ]; then streak=0; else streak=$(( prev + 1 )); fi
    STATE_EXTRA+=("load_over_review=$streak")
    if [ "$level" != NORMAL ] && [ "$level" != EMERGENCY_PRESSURE ]; then
      evidence="$evidence; over the review threshold for $streak of $LOAD_SUSTAIN_PULSES pulses in a row"
      [ "$streak" -ge "$LOAD_SUSTAIN_PULSES" ] || level=NORMAL
    fi
    add_row "$level" 'CPU load' "$evidence"
  else
    add_row OBSERVABILITY_DEGRADED 'CPU load' 'Could not read load average or CPU count'
  fi
}

collect_boot_and_oom() {
  local uptime_s boot_id prev_boot oom prev_oom delta
  uptime_s="$(awk '{ printf "%d", $1 }' "$PROC_ROOT/uptime" 2>/dev/null)"
  boot_id="$(tr -d '[:space:]' < "$PROC_ROOT/sys/kernel/random/boot_id" 2>/dev/null)"
  prev_boot="$(state_get "$STATE_FILE" boot_id)"
  CURRENT_BOOT_ID="$boot_id"
  if is_uint "$uptime_s"; then
    if [ -n "$prev_boot" ] && [ -n "$boot_id" ] && [ "$prev_boot" != "$boot_id" ]; then
      add_row NORMAL 'Uptime and reboots' "Rebooted since the last pulse; up $(( uptime_s / 3600 )) h"
      NOTICES+=("Host rebooted since the last pulse")
    else
      add_row NORMAL 'Uptime and reboots' "Up $(( uptime_s / 3600 )) h"
    fi
  else
    add_row OBSERVABILITY_DEGRADED 'Uptime and reboots' 'Could not read uptime'
  fi

  oom="$(awk '$1 == "oom_kill" { print $2; exit }' "$PROC_ROOT/vmstat" 2>/dev/null)"
  CURRENT_OOM="$oom"
  if ! is_uint "$oom"; then
    add_row NORMAL 'Out-of-memory kills' 'Not applicable: this kernel has no oom_kill counter'
    return
  fi
  prev_oom="$(state_get "$STATE_FILE" oom_kill)"
  # The counter starts again at each boot, so only compare within one boot.
  if [ "$prev_boot" = "$boot_id" ] && is_uint "$prev_oom" && [ "$oom" -ge "$prev_oom" ]; then delta=$(( oom - prev_oom ))
  elif [ -n "$prev_boot" ]; then delta="$oom"
  else delta=0; fi
  add_row "$(classify_count "$delta" "$OOM_REVIEW_KILLS" "$OOM_UPGRADE_KILLS")" 'Out-of-memory kills' "$delta new since the last pulse ($oom this boot)"
}

collect_pulse_gap() {
  local prev gap
  prev="$(state_get "$STATE_FILE" last_pulse_epoch)"
  if ! is_uint "$prev"; then
    add_row NORMAL 'Pulse continuity' 'First pulse recorded on this host'
    return
  fi
  gap=$(( (NOW_EPOCH - prev) / 60 ))
  if [ "$gap" -gt "$PULSE_STALE_MINUTES" ]; then
    add_row OBSERVABILITY_DEGRADED 'Pulse continuity' "Gap of $gap minutes since the last pulse (limit $PULSE_STALE_MINUTES); the host or the timer was down"
  else
    add_row NORMAL 'Pulse continuity' "$gap minutes since the last pulse"
  fi
}

collect_systemd() {
  local failed count names
  if ! have systemctl || [ ! -d "$SYSTEMD_RUN_DIR" ]; then
    add_service N/A 'systemd units' 'Not applicable: systemd is not running on this host'
    return
  fi
  if ! failed="$(systemctl list-units --state=failed --no-legend --plain 2>/dev/null)"; then
    add_row OBSERVABILITY_DEGRADED 'systemd units' 'systemctl list-units failed'
    return
  fi
  # The pulse's own test units are left out: a failed test alert is reported where it was run.
  failed="$(printf '%s\n' "$failed" | awk 'NF && $1 !~ /^host-pulse-test-(alert|heartbeat)\.service$/')"
  count="$(printf '%s\n' "$failed" | awk 'NF { n++ } END { print n + 0 }')"
  names="$(printf '%s\n' "$failed" | awk 'NF { print $1 }' | head -n 10 | paste -sd ',' -)"
  if [ "$count" -gt 0 ]; then add_service FAILING 'systemd units' "$count failed: $names" "systemd:$names"
  else add_service OK 'systemd units' 'No failed units'; fi
}

# Docker access comes from who the pulse really runs as, never from a setting: root, or a member of
# the docker group (the installer adds that only with --with-docker, because it equals root).
has_docker_access() {
  [ "$(id -u 2>/dev/null)" = 0 ] && return 0
  case " $(id -nG 2>/dev/null) " in *' docker '*) return 0 ;; esac
  return 1
}

collect_docker() {
  local listing bad restarts prev delta ids
  if ! have docker; then
    add_service N/A 'Docker containers' 'Not applicable: Docker is not installed'
    add_row NORMAL 'Container restarts' 'Not applicable: Docker is not installed'
    return
  fi
  if ! has_docker_access; then
    add_service N/A 'Docker containers' 'Not checked: Docker access is off (not root and not in the docker group; --with-docker turns it on and equals root on this host)'
    add_row NORMAL 'Container restarts' 'Not checked: Docker access is off (owner choice)'
    return
  fi
  if ! listing="$(docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null)"; then
    add_row OBSERVABILITY_DEGRADED 'Docker containers' 'docker ps failed (daemon down or no access)'
    return
  fi
  # Failing: restarting, unhealthy, or stopped with a non-zero exit code (a crash that stayed down).
  # Containers named in DOCKER_EXITED_OK_CONTAINERS may stay exited, such as one-off jobs.
  bad="$(printf '%s\n' "$listing" | awk -F'|' -v ok=" ${DOCKER_EXITED_OK_CONTAINERS:-} " '
    NF >= 3 {
      if ($2 == "restarting") reason = "restarting"
      else if ($3 ~ /\(unhealthy\)/) reason = "unhealthy"
      else if ($2 == "exited" && $3 ~ /^Exited \([1-9][0-9]*\)/ && index(ok, " " $1 " ") == 0) {
        reason = $3; sub(/^Exited \(/, "exited with code ", reason); sub(/\).*/, "", reason)
      } else next
      print $1 " (" reason ")"
    }' | head -n 10 | paste -sd ',' - | sed 's/,/, /g')"
  if [ -n "$bad" ]; then add_service FAILING 'Docker containers' "Failing: $bad" "docker:$(printf '%s' "$bad" | sed -E 's/ \([^)]*\)//g; s/, /,/g')"
  else add_service OK 'Docker containers' "$(printf '%s\n' "$listing" | awk 'NF { n++ } END { print n + 0 }') containers, none failing"; fi

  ids="$(docker ps -aq 2>/dev/null)"
  if [ -z "$ids" ]; then
    restarts=0
  else
    # shellcheck disable=SC2086
    restarts="$(docker inspect --format '{{.RestartCount}}' $ids 2>/dev/null | awk '{ s += $1 } END { print s + 0 }')"
  fi
  CURRENT_RESTARTS="$restarts"
  prev="$(state_get "$STATE_FILE" docker_restarts)"
  if is_uint "$prev" && [ "$restarts" -ge "$prev" ]; then delta=$(( restarts - prev )); else delta=0; fi
  add_row "$(classify_count "$delta" "$RESTART_REVIEW_COUNT" "$RESTART_UPGRADE_COUNT")" 'Container restarts' "$delta restarts since the last pulse"
}

collect_health_urls() {
  local url label code
  [ -n "${HEALTHCHECK_URLS:-}" ] || return 0
  if ! have curl; then
    add_row OBSERVABILITY_DEGRADED 'Health URLs' 'Not checked: curl is not installed'
    return 0
  fi
  for url in $HEALTHCHECK_URLS; do
    label="$(printf '%s' "$url" | redact_text)"
    if secret_like_url "$url" || ! safe_transport_url "$url"; then
      add_row OBSERVABILITY_DEGRADED "Health $label" 'Skipped: use a plain http or https URL with no credentials or token-like query values'
      continue
    fi
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
    case "$code" in
      2??|3??) add_service OK "Health $label" "HTTP $code" ;;
      *) add_service FAILING "Health $label" "HTTP ${code:-no response}" "health:$label" ;;
    esac
  done
}

collect_alerting_config() {
  local problem
  if problem="$(alert_config_problem)"; then
    add_row NORMAL Alerting "Channels: $(alert_channel_list)"
    ALERTING_READY=1
  else
    add_row OBSERVABILITY_DEGRADED Alerting "Not set up: $problem; reports stay on this host only"
    ALERTING_READY=0
  fi
  [ -z "$CONFIG_PROBLEMS" ] || add_row OBSERVABILITY_DEGRADED Settings "$CONFIG_PROBLEMS"
}

worst_state() {
  local worst=NORMAL s
  for s in "${ROW_STATE[@]}"; do
    [ "$(state_rank "$s")" -gt "$(state_rank "$worst")" ] && worst="$s"
  done
  printf '%s' "$worst"
}

services_summary() {
  local s failing=0
  for s in "${SERVICE_STATUS[@]}"; do [ "$s" = FAILING ] && failing=$((failing + 1)); done
  if [ "$failing" -gt 0 ]; then printf 'FAILING (%s)' "$failing"; else printf 'OK'; fi
}

ping_heartbeat() {
  local url="${HEARTBEAT_URL:-}" pre="$1"
  if [ -z "${HEARTBEAT_URL:-}" ]; then
    add_row OBSERVABILITY_DEGRADED 'Off-host heartbeat' 'Not set up: nothing outside this host notices if it goes quiet'
    return
  fi
  if ! secret_transport_url "$HEARTBEAT_URL" || { [ -n "${HEARTBEAT_FAIL_URL:-}" ] && ! secret_transport_url "$HEARTBEAT_FAIL_URL"; }; then
    add_row OBSERVABILITY_DEGRADED 'Off-host heartbeat' 'Heartbeat URL must be https (plain http only to this host) with no spaces or quotes'
    return
  fi
  if ! have curl; then
    add_row OBSERVABILITY_DEGRADED 'Off-host heartbeat' 'Ping not sent: curl is not installed'
    return
  fi
  if [ "$MODE" = dry-run ]; then
    add_row NORMAL 'Off-host heartbeat' 'Configured; not pinged in a dry run'
    return
  fi
  case "$pre" in
    EMERGENCY_PRESSURE|OBSERVABILITY_DEGRADED) [ -n "${HEARTBEAT_FAIL_URL:-}" ] && url="$HEARTBEAT_FAIL_URL" ;;
  esac
  # A failed alert with no failure URL: skip the ping, so the off-host monitor raises its
  # missed-ping alarm and the owner still hears that something is wrong.
  if [ "${NEW_PENDING:-0}" = 1 ] && [ -z "${HEARTBEAT_FAIL_URL:-}" ]; then
    add_row OBSERVABILITY_DEGRADED 'Off-host heartbeat' 'Not pinged: the alert failed to send and no HEARTBEAT_FAIL_URL is set, so the off-host monitor raises its missed-ping alarm'
    return
  fi
  if curl_private "$url" -o /dev/null; then
    if [ "$url" = "$HEARTBEAT_URL" ]; then add_row NORMAL 'Off-host heartbeat' 'Pinged'
    else add_row NORMAL 'Off-host heartbeat' 'Pinged the failure URL'; fi
  else
    add_row OBSERVABILITY_DEGRADED 'Off-host heartbeat' 'Ping failed; the off-host monitor may raise a missed-pulse alarm'
  fi
}

write_report() {
  local file="$1" overall="$2" services="$3" i
  {
    printf '# Host pulse\n\n'
    printf 'Host: `%s`\n\n' "$HOST_LABEL"
    printf 'Time UTC: `%s`\n\n' "$(date -u -d "@$NOW_EPOCH" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u '+%Y-%m-%d %H:%M:%S')"
    printf 'State: %s\n\n' "$overall"
    printf 'Services: %s\n\n' "$services"
    printf 'Read-only evidence. Nothing was changed on this host.\n\n'
    printf '## Capacity and observability\n\n| Area | State | Evidence |\n| --- | --- | --- |\n'
    for i in "${!ROW_AREA[@]}"; do printf '| %s | %s | %s |\n' "${ROW_AREA[$i]}" "${ROW_STATE[$i]}" "${ROW_EVIDENCE[$i]}"; done
    printf '\n## Services\n\n| Area | Status | Evidence |\n| --- | --- | --- |\n'
    for i in "${!SERVICE_AREA[@]}"; do printf '| %s | %s | %s |\n' "${SERVICE_AREA[$i]}" "${SERVICE_STATUS[$i]}" "${SERVICE_EVIDENCE[$i]}"; done
    if [ "${#NOTICES[@]}" -gt 0 ]; then
      printf '\n## Notices\n\n'
      for i in "${NOTICES[@]}"; do printf -- '- %s\n' "$i"; done
    fi
  } | redact_secrets | head -n 200 > "$file"
}

alert_body() {
  local overall="$1" services="$2" i
  {
    printf 'Host: %s\nState: %s\nServices: %s\n' "$HOST_LABEL" "$overall" "$services"
    for i in "${!ROW_AREA[@]}"; do
      [ "${ROW_STATE[$i]}" = NORMAL ] || printf -- '- %s: %s, %s\n' "${ROW_AREA[$i]}" "${ROW_STATE[$i]}" "${ROW_EVIDENCE[$i]}"
    done
    for i in "${!SERVICE_AREA[@]}"; do
      [ "${SERVICE_STATUS[$i]}" = FAILING ] && printf -- '- %s: failing, %s\n' "${SERVICE_AREA[$i]}" "${SERVICE_EVIDENCE[$i]}"
    done
    for i in "${NOTICES[@]}"; do printf -- '- Notice: %s\n' "$i"; done
    printf 'Report: %s\n' "$REPORT_DIR/latest-pulse.md"
  } | redact_secrets | head -n 40
}

prepare_dirs() {
  # A run by hand as root in the service user's folder would leave root-owned files there that the
  # service can no longer open.
  if [ -e "$HOST_PULSE_ROOT" ] && [ ! -O "$HOST_PULSE_ROOT" ]; then
    printf '%s belongs to another user, and this run would leave files there that its service cannot open.\n' "$HOST_PULSE_ROOT" >&2
    printf 'Run it through systemd (systemctl start host-pulse.service or a test unit); by hand, use only --dry-run or --status.\n' >&2
    exit 1
  fi
  mkdir -p "$REPORT_DIR" "$STATE_DIR" || { printf 'Cannot create %s\n' "$HOST_PULSE_ROOT" >&2; exit 1; }
  chmod 700 "$HOST_PULSE_ROOT" "$REPORT_DIR" "$STATE_DIR" 2>/dev/null || true
  PRIVATE_TMP_DIR="$STATE_DIR"
}

# --status: the last pulse as recorded, judged by its age. Never reports a missing or old pulse as fine.
state_unreadable() {
  [ -e "$HOST_PULSE_ROOT" ] || [ -L "$HOST_PULSE_ROOT" ] || return 1
  [ -r "$HOST_PULSE_ROOT" ] && [ -x "$HOST_PULSE_ROOT" ] || return 0
  [ ! -e "$STATE_DIR" ] || { [ -r "$STATE_DIR" ] && [ -x "$STATE_DIR" ]; } || return 0
  [ ! -e "$STATE_FILE" ] || [ -r "$STATE_FILE" ] || return 0
  return 1
}

if [ "$MODE" = status ]; then
  load_thresholds
  if state_unreadable; then
    printf 'State: UNKNOWN\nReason: this user cannot read %s; run --status as root, for example with sudo\n' "$STATE_DIR"
    exit 1
  fi
  last="$(state_get "$STATE_FILE" last_pulse_epoch)"
  if ! is_uint "$last"; then
    printf 'State: OBSERVABILITY_DEGRADED\nReason: no pulse has been recorded on this host\n'
    exit 0
  fi
  age=$(( (NOW_EPOCH - last) / 60 ))
  if [ "$age" -gt "$PULSE_STALE_MINUTES" ]; then
    printf 'State: OBSERVABILITY_DEGRADED\nReason: the last pulse is %s minutes old (limit %s); the timer may be stopped\n' "$age" "$PULSE_STALE_MINUTES"
  else
    printf 'State: %s\nServices: %s\nLast pulse: %s minutes ago\n' "$(state_get "$STATE_FILE" last_state)" "$(state_get "$STATE_FILE" last_services)" "$age"
  fi
  [ "$(state_get "$STATE_FILE" alert_pending)" != 1 ] || printf 'Alert delivery: the last alert failed to send; the next pulse retries\n'
  exit 0
fi

if [ "$MODE" = test-alert ] || [ "$MODE" = test-heartbeat ]; then
  prepare_dirs
  if [ "$MODE" = test-heartbeat ]; then
    [ -n "${HEARTBEAT_URL:-}" ] || { printf 'No HEARTBEAT_URL set.\n'; exit 1; }
    secret_transport_url "$HEARTBEAT_URL" || { printf 'Heartbeat ping: not sent; HEARTBEAT_URL must be https (plain http only to this host)\n'; exit 1; }
    curl_private "$HEARTBEAT_URL" -o /dev/null; rc=$?
    printf 'Heartbeat ping: %s\n' "$(delivery_result heartbeat "$rc")"
    [ "$rc" -eq 0 ]; exit $?
  fi
  if ! problem="$(alert_config_problem)"; then printf 'Alerting not set up: %s\n' "$problem"; exit 1; fi
  body="$(mktemp "$STATE_DIR/.test-alert.XXXXXX")"
  printf 'Test alert from host-observability on %s. If you can read this, alerts reach you.\n' "$HOST_LABEL" > "$body"
  outcome="$(send_alert "host-observability $HOST_LABEL: test alert" "$body")"; result=$?
  rm -f "$body"
  printf 'Test alert: %s\n' "$outcome"
  exit "$result"
fi

if [ "$MODE" = dry-run ]; then
  PRIVATE_TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$PRIVATE_TMP_DIR"' EXIT
else
  prepare_dirs
  if have flock; then
    exec 9>"$STATE_DIR/.lock"
    flock -n 9 || { printf 'Another host pulse is running.\n' >&2; exit 0; }
  fi
fi

load_thresholds
CURRENT_BOOT_ID=''; CURRENT_OOM=''; CURRENT_RESTARTS=''; ALERTING_READY=0
collect_pulse_gap
collect_load
collect_memory
collect_disk
collect_boot_and_oom
collect_systemd
collect_docker
collect_health_urls
collect_alerting_config

if [ "$MODE" = dry-run ]; then
  ping_heartbeat "$(worst_state)"
  write_report "$PRIVATE_TMP_DIR/report.md" "$(worst_state)" "$(services_summary)"
  cat "$PRIVATE_TMP_DIR/report.md"
  printf '\nDry run: no report file, heartbeat, alert or state change.\n'
  exit 0
fi

# Alert when the state or the failing services change, at once on emergency pressure, on a notice
# such as a reboot, and again after a failed delivery. A failed delivery is never recorded as sent,
# and it makes this pulse degraded, so the failure heartbeat URL tells the off-host monitor too.
PRE_STATE="$(worst_state)"
SERVICES="$(services_summary)"
SIGNATURE="$PRE_STATE|$SERVICES"
if [ "${#FAILING_KEYS[@]}" -gt 0 ]; then
  SIGNATURE="$SIGNATURE|$(printf '%s;' "${FAILING_KEYS[@]}" | sed 's/;$//')"
fi
LAST_SENT="$(state_get "$STATE_FILE" last_sent_signature)"
PENDING="$(state_get "$STATE_FILE" alert_pending)"
DELIVERY='not needed (no change since the last alert)'
NEW_SENT="$LAST_SENT"; NEW_PENDING=0
if [ "$ALERTING_READY" -ne 1 ]; then
  DELIVERY='not attempted: alerting is not ready (see the Alerting row)'
elif [ "$PRE_STATE" = EMERGENCY_PRESSURE ] || [ "$SIGNATURE" != "$LAST_SENT" ] || [ "${PENDING:-0}" = 1 ] || [ "${#NOTICES[@]}" -gt 0 ]; then
  BODY="$(mktemp "$STATE_DIR/.alert.XXXXXX")"
  alert_body "$PRE_STATE" "$SERVICES" > "$BODY"
  SUBJECT="host-observability $HOST_LABEL: $PRE_STATE"
  [ "$SERVICES" = OK ] || SUBJECT="$SUBJECT, services $SERVICES"
  if outcome="$(send_alert "$SUBJECT" "$BODY")"; then
    DELIVERY="sent ($outcome)"; NEW_SENT="$SIGNATURE"
  else
    DELIVERY="FAILED ($outcome); the next pulse retries"; NEW_PENDING=1
    add_row OBSERVABILITY_DEGRADED 'Alert delivery' "Failed ($outcome); the owner is not hearing about this host"
  fi
  rm -f "$BODY"
fi

ping_heartbeat "$(worst_state)"
OVERALL="$(worst_state)"

STAMP="$(date -u -d "@$NOW_EPOCH" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/pulse-$STAMP.md"
TMP_REPORT="$(mktemp "$REPORT_DIR/.pulse.XXXXXX")"
write_report "$TMP_REPORT" "$OVERALL" "$SERVICES"
printf '\n## Alert delivery\n\n%s\n' "$DELIVERY" | redact_secrets >> "$TMP_REPORT"

mv "$TMP_REPORT" "$REPORT"
cp "$REPORT" "$REPORT_DIR/latest-pulse.md"
prune_reports "$REPORT_DIR" pulse "$REPORT_KEEP"

state_write "$STATE_FILE" \
  "last_pulse_epoch=$NOW_EPOCH" \
  "last_state=$OVERALL" \
  "last_services=$SERVICES" \
  "boot_id=$CURRENT_BOOT_ID" \
  "oom_kill=$CURRENT_OOM" \
  "docker_restarts=$CURRENT_RESTARTS" \
  "last_sent_signature=$NEW_SENT" \
  "alert_pending=$NEW_PENDING" \
  ${STATE_EXTRA[@]+"${STATE_EXTRA[@]}"}

printf 'State: %s\nServices: %s\nReport: %s\nAlert: %s\n' "$OVERALL" "$SERVICES" "$REPORT" "$DELIVERY" | redact_secrets
exit 0
