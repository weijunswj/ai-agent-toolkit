#!/usr/bin/env bash
set -u

# Update watch: a read-only report of what is behind on updates on one Linux host. It counts pending
# OS package and security updates, checks the reboot-needed marker, the automatic security update
# service and the Docker engine, and runs owner-reviewed plug-in checks for platform parts (for
# example a Coolify check from the Coolify skill). It reports and suggests; it never installs,
# upgrades, refreshes package lists, restarts or reboots anything. A version it cannot check is
# reported as UNKNOWN, never as up to date.

umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/host-observability-common.sh
. "$SCRIPT_DIR/lib/host-observability-common.sh"

MODE=run
case "${1:-}" in
  '') ;;
  --dry-run) MODE=dry-run ;;
  -h|--help) printf 'Usage: update-watch.sh [--dry-run]\n'; exit 0 ;;
  *) printf 'Usage: update-watch.sh [--dry-run]\n' >&2; exit 2 ;;
esac

HOST_PULSE_ROOT="${HOST_PULSE_ROOT:-/var/lib/host-observability}"
REPORT_DIR="$HOST_PULSE_ROOT/reports"
STATE_DIR="$HOST_PULSE_ROOT/state"
STATE_FILE="$STATE_DIR/update-watch.state"
PLUGIN_DIR="${UPDATE_WATCH_PLUGIN_DIR:-/etc/host-observability/update-watch.d}"
APT_STATE_DIR="${APT_STATE_DIR:-/var/lib/apt}"
REBOOT_MARKER="${REBOOT_MARKER:-/var/run/reboot-required}"
SYSTEMD_RUN_DIR="${SYSTEMD_RUN_DIR:-/run/systemd/system}"
HOST_LABEL="${HOST_LABEL:-$(hostname 2>/dev/null || printf unknown)}"
NOW_EPOCH="$(date +%s)"
INDEX_MAX_AGE_DAYS="${PACKAGE_INDEX_MAX_AGE_DAYS:-3}"; is_uint "$INDEX_MAX_AGE_DAYS" || INDEX_MAX_AGE_DAYS=3
REPORT_KEEP="${UPDATE_REPORT_KEEP:-30}"; is_uint "$REPORT_KEEP" || REPORT_KEEP=30

AREA=(); STATUS=(); INSTALLED=(); LATEST=(); EVIDENCE=()
add() { STATUS+=("$1"); AREA+=("$2"); INSTALLED+=("$3"); LATEST+=("$4"); EVIDENCE+=("$5"); }

check_os_packages() {
  local sim total security stamp age
  if ! have apt-get; then
    add UNKNOWN 'OS packages' - - 'No apt-get on this host; check updates with its own package manager'
    return
  fi
  if [ -f "$APT_STATE_DIR/periodic/update-success-stamp" ]; then stamp="$APT_STATE_DIR/periodic/update-success-stamp"
  elif [ -d "$APT_STATE_DIR/lists" ]; then stamp="$APT_STATE_DIR/lists"
  else stamp=''; fi
  if [ -n "$stamp" ] && age=$(( (NOW_EPOCH - $(stat -c %Y "$stamp" 2>/dev/null || echo "$NOW_EPOCH")) / 86400 )); then
    if [ "$age" -gt "$INDEX_MAX_AGE_DAYS" ]; then
      add WARN 'Package index age' - - "Last refreshed $age days ago, so the counts below may be low; refreshing it is the owner's call"
    else
      add OK 'Package index age' - - "Last refreshed $age days ago"
    fi
  else
    add UNKNOWN 'Package index age' - - 'Could not find when the package index was last refreshed'
  fi
  # A simulation only: -s never installs, and NoLocking keeps it from taking the apt lock.
  if ! sim="$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null)"; then
    add UNKNOWN 'OS packages' - - 'apt-get simulation failed'
    return
  fi
  total="$(printf '%s\n' "$sim" | awk '/^Inst / { n++ } END { print n + 0 }')"
  security="$(printf '%s\n' "$sim" | awk '/^Inst / && /-security/ { n++ } END { print n + 0 }')"
  if [ "$security" -gt 0 ]; then
    add WARN 'Security updates' - "$security pending" "$security of $total pending package updates come from a security source"
  else
    add OK 'Security updates' - '0 pending' 'No pending updates from a security source'
  fi
  if [ "$total" -gt 0 ]; then add OK 'OS packages' - "$total pending" 'Routine updates pending; apply in an owner-approved window'
  else add OK 'OS packages' - '0 pending' 'Up to date with the local package index'; fi
}

check_reboot() {
  local pkgs
  if [ -f "$REBOOT_MARKER" ]; then
    pkgs="$(head -n 10 "$REBOOT_MARKER.pkgs" 2>/dev/null | paste -sd ',' -)"
    add WARN 'Reboot needed' - - "The reboot-needed marker is set${pkgs:+ by $pkgs}; reboot in an owner-approved window"
  else
    add OK 'Reboot needed' - - 'No reboot-needed marker'
  fi
}

check_unattended() {
  local enabled active
  if ! have apt-get; then add N/A 'Automatic security updates' - - 'Not an apt host'; return; fi
  if ! have systemctl || [ ! -d "$SYSTEMD_RUN_DIR" ]; then
    add UNKNOWN 'Automatic security updates' - - 'systemd is not running, so the service state cannot be read'
    return
  fi
  enabled="$(systemctl is-enabled unattended-upgrades.service 2>/dev/null || true)"
  active="$(systemctl is-active unattended-upgrades.service 2>/dev/null || true)"
  if [ "$enabled" = enabled ] && [ "$active" = active ]; then
    add OK 'Automatic security updates' - - 'unattended-upgrades enabled and active'
  else
    add WARN 'Automatic security updates' - - "unattended-upgrades ${enabled:-missing}/${active:-missing}; the owner decides the update policy"
  fi
}

apt_policy_field() {
  printf '%s\n' "$1" | awk -v f="$2:" '$1 == f { print $2; exit }'
}

check_docker() {
  local server pkg policy installed candidate
  if ! have docker; then add N/A 'Docker engine' - - 'Docker is not installed'; return; fi
  server="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  [ -n "$server" ] || server='unreadable'
  if ! have apt-cache; then
    add UNKNOWN 'Docker engine' "$server" unknown 'No apt-cache, so the latest available version is unknown'
    return
  fi
  for pkg in docker-ce docker.io moby-engine; do
    policy="$(apt-cache policy "$pkg" 2>/dev/null || true)"
    installed="$(apt_policy_field "$policy" Installed)"
    [ -n "$installed" ] && [ "$installed" != '(none)' ] && break
    installed=''
  done
  if [ -z "$installed" ]; then
    add UNKNOWN 'Docker engine' "$server" unknown 'Not installed from a known apt package, so the latest version is unknown'
    return
  fi
  candidate="$(apt_policy_field "$policy" Candidate)"
  if [ -z "$candidate" ] || [ "$candidate" = '(none)' ]; then
    add UNKNOWN 'Docker engine' "$server" unknown "No candidate version for $pkg in the local package index"
  elif [ "$candidate" != "$installed" ]; then
    add WARN 'Docker engine' "$server ($installed)" "$candidate" "$pkg is behind the local package index; Docker restarts containers on upgrade, so plan a window"
  else
    add OK 'Docker engine' "$server ($installed)" "$candidate" "$pkg matches the local package index"
  fi
}

# Plug-ins: executable *.sh files in the plug-in folder. Each prints up to 20 lines of
#   area|installed|latest|status|evidence     (status OK, WARN, UNKNOWN or N/A)
# A plug-in runs only when it and its folder belong to root (or to the user running the watch) and
# nobody else can write them. Plug-ins must be read-only checks, like this script.
owner_ok() {
  local meta uid mode
  meta="$(stat -c '%u %a' "$1" 2>/dev/null)" || return 1
  uid="${meta%% *}"; mode="${meta##* }"
  [ "$uid" = 0 ] || [ "$uid" = "$(id -u)" ] || return 1
  case "$mode" in *[2367]?|*[2367]) return 1 ;; esac
  return 0
}

run_plugins() {
  local plugin name out line area installed latest status evidence count
  [ -d "$PLUGIN_DIR" ] || return 0
  if ! owner_ok "$PLUGIN_DIR"; then
    add UNKNOWN 'Plug-ins' - - 'Plug-in folder skipped: others can write it, or it has an unexpected owner'
    return
  fi
  for plugin in "$PLUGIN_DIR"/*.sh; do
    [ -e "$plugin" ] || continue
    name="$(basename "$plugin" .sh)"
    if [ ! -x "$plugin" ] || ! owner_ok "$plugin"; then
      add UNKNOWN "Plug-in $name" - - 'Skipped: not executable, others can write it, or it has an unexpected owner'
      continue
    fi
    if have timeout; then out="$(timeout 60 "$plugin" 2>/dev/null)"; else out="$("$plugin" 2>/dev/null)"; fi
    if [ "$?" -ne 0 ]; then
      add UNKNOWN "Plug-in $name" - - 'The plug-in failed or timed out'
      continue
    fi
    count=0
    while IFS='|' read -r area installed latest status evidence; do
      [ -n "$area" ] || continue
      count=$((count + 1)); [ "$count" -le 20 ] || break
      case "$status" in
        OK|WARN|UNKNOWN|N/A) add "$status" "$area" "${installed:--}" "${latest:--}" "${evidence:-}" ;;
        *) add UNKNOWN "Plug-in $name" - - 'A line did not match area|installed|latest|status|evidence' ;;
      esac
    done <<< "$out"
    [ "$count" -gt 0 ] || add UNKNOWN "Plug-in $name" - - 'The plug-in printed no rows'
  done
}

overall_status() {
  local s warn=0 unknown=0
  for s in "${STATUS[@]}"; do
    case "$s" in WARN) warn=1 ;; UNKNOWN) unknown=1 ;; esac
  done
  if [ "$warn" = 1 ]; then echo WARN; elif [ "$unknown" = 1 ]; then echo UNKNOWN; else echo OK; fi
}

write_report() {
  local file="$1" overall="$2" i
  {
    printf '# Update watch\n\nHost: `%s`\n\nTime UTC: `%s`\n\nOverall: %s\n\n' "$HOST_LABEL" "$(date -u '+%Y-%m-%d %H:%M:%S')" "$overall"
    printf 'Read-only. Nothing was installed, upgraded, refreshed or restarted.\n\n'
    printf '| Area | Status | Installed | Latest | Evidence |\n| --- | --- | --- | --- | --- |\n'
    for i in "${!AREA[@]}"; do
      printf '| %s | %s | %s | %s | %s |\n' "${AREA[$i]}" "${STATUS[$i]}" "${INSTALLED[$i]}" "${LATEST[$i]}" "${EVIDENCE[$i]}" | tr -d '\r'
    done
  } | redact_secrets | head -n 120 > "$file"
}

check_os_packages
check_reboot
check_unattended
check_docker
run_plugins
OVERALL="$(overall_status)"

if [ "$MODE" = dry-run ]; then
  tmp="$(mktemp)"; write_report "$tmp" "$OVERALL"; cat "$tmp"; rm -f "$tmp"
  printf '\nDry run: no report file, alert or state change.\n'
  exit 0
fi

mkdir -p "$REPORT_DIR" "$STATE_DIR" || { printf 'Cannot create %s\n' "$HOST_PULSE_ROOT" >&2; exit 1; }
chmod 700 "$HOST_PULSE_ROOT" "$REPORT_DIR" "$STATE_DIR" 2>/dev/null || true
PRIVATE_TMP_DIR="$STATE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/update-watch-$STAMP.md"
TMP_REPORT="$(mktemp "$REPORT_DIR/.update-watch.XXXXXX")"
write_report "$TMP_REPORT" "$OVERALL"

# Alert on a change in what is behind (default), on every run (always) or never. Failed deliveries retry.
SIGNATURE="$(for i in "${!AREA[@]}"; do [ "${STATUS[$i]}" = OK ] || [ "${STATUS[$i]}" = N/A ] || printf '%s|%s|%s;' "${AREA[$i]}" "${STATUS[$i]}" "${LATEST[$i]}"; done)"
SIGNATURE="${OVERALL}:$(printf '%s' "$SIGNATURE" | cksum | awk '{ print $1 }')"
LAST_SENT="$(state_get "$STATE_FILE" last_sent_signature)"
PENDING="$(state_get "$STATE_FILE" alert_pending)"
NEW_SENT="$LAST_SENT"; NEW_PENDING=0
DELIVERY='not needed (nothing new is behind)'
WANT=0
case "${UPDATE_WATCH_ALERT:-change}" in
  always) WANT=1 ;;
  never) DELIVERY='not sent: UPDATE_WATCH_ALERT is never' ;;
  *) { [ "$SIGNATURE" != "$LAST_SENT" ] && [ "$OVERALL" != OK ] ; } || [ "${PENDING:-0}" = 1 ] && WANT=1 ;;
esac
if [ "$WANT" = 1 ]; then
  if problem="$(alert_config_problem)"; then
    BODY="$(mktemp "$STATE_DIR/.alert.XXXXXX")"
    {
      printf 'Host: %s\nUpdate watch: %s\n' "$HOST_LABEL" "$OVERALL"
      for i in "${!AREA[@]}"; do
        case "${STATUS[$i]}" in WARN|UNKNOWN) printf -- '- %s: %s, %s\n' "${AREA[$i]}" "${STATUS[$i]}" "${EVIDENCE[$i]}" ;; esac
      done
      printf 'Report: %s\n' "$REPORT_DIR/latest-update-watch.md"
    } | redact_secrets | head -n 40 > "$BODY"
    if outcome="$(send_alert "host-observability $HOST_LABEL: updates $OVERALL" "$BODY")"; then
      DELIVERY="sent (${outcome% })"; NEW_SENT="$SIGNATURE"
    else
      DELIVERY="FAILED (${outcome% }); the next run retries"; NEW_PENDING=1
    fi
    rm -f "$BODY"
  else
    DELIVERY="not attempted: $problem"
  fi
fi
printf '\n## Alert delivery\n\n%s\n' "$DELIVERY" | redact_secrets >> "$TMP_REPORT"
mv "$TMP_REPORT" "$REPORT"
cp "$REPORT" "$REPORT_DIR/latest-update-watch.md"
prune_reports "$REPORT_DIR" update-watch "$REPORT_KEEP"
state_write "$STATE_FILE" "last_run_epoch=$NOW_EPOCH" "last_overall=$OVERALL" "last_sent_signature=$NEW_SENT" "alert_pending=$NEW_PENDING"
printf 'Update watch: %s\nReport: %s\nAlert: %s\n' "$OVERALL" "$REPORT" "$DELIVERY" | redact_secrets
exit 0
