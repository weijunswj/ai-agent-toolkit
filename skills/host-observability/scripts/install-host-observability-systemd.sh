#!/usr/bin/env bash
set -Eeuo pipefail

# Installs the host pulse as an hourly systemd timer.
# Without an option it only prints what it would change. --install makes the changes and --remove
# takes the timer and installed scripts away again (the env file and reports stay). Run it on the
# target host as root, and only with the owner's approval for that host. It never enables an alert
# channel or heartbeat by itself: the owner chooses those in the env file.

usage() {
  cat <<'USAGE'
Usage: install-host-observability-systemd.sh [--install | --remove]
  (no option)  print the plan; change nothing
  --install    copy the scripts, create the private env file if missing, write and start the timer;
               on any failure, put back what was there before
  --remove     stop and remove the timer, units and installed scripts; keep the env file and reports
Settings (environment): INSTALL_PREFIX, CONFIG_DIR, HOST_PULSE_ROOT, SYSTEMD_UNIT_DIR.
USAGE
}

ACTION=plan
case "${1:-}" in
  '') ;;
  --install) ACTION=install ;;
  --remove) ACTION=remove ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SOURCE_DIR/../templates"
INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local/lib/host-observability}"
CONFIG_DIR="${CONFIG_DIR:-/etc/host-observability}"
ENV_FILE="$CONFIG_DIR/host-pulse.env"
BACKUP_DIR="$CONFIG_DIR/backup"
HOST_PULSE_ROOT="${HOST_PULSE_ROOT:-/var/lib/host-observability}"
SYSTEMD_UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SYSTEMD_RUN_DIR="${SYSTEMD_RUN_DIR:-/run/systemd/system}"
UNITS=(host-pulse.service host-pulse.timer host-pulse-test-alert.service host-pulse-test-heartbeat.service)
FILES=(host-pulse.sh lib/host-observability-common.sh)

have() { command -v "$1" >/dev/null 2>&1; }

# The pulse needs Linux with systemd running. Checked before the plan and before any write.
require_systemd() {
  if [ "$(uname -s 2>/dev/null)" != Linux ] || [ ! -d "$SYSTEMD_RUN_DIR" ] || ! have systemctl; then
    echo 'systemd is not running on this host; nothing was changed.' >&2
    echo 'The pulse needs Linux with systemd. On another init system, run host-pulse.sh from its own scheduler.' >&2
    exit 1
  fi
}

env_file_too_open() {
  [ -n "$(find "$ENV_FILE" -maxdepth 0 -perm /077 2>/dev/null)" ]
}

print_plan() {
  echo 'Plan (nothing has been changed):'
  echo "- Copy ${FILES[*]} to $INSTALL_PREFIX"
  if [ ! -e "$ENV_FILE" ]; then echo "- Create $ENV_FILE (mode 600) from templates/host-pulse.env.example, with every value commented out"
  elif env_file_too_open; then echo "- Keep the existing env file $ENV_FILE and tighten it to mode 600 (others can read it now)"
  else echo "- Keep the existing env file $ENV_FILE as it is"; fi
  echo "- Write ${UNITS[*]} to $SYSTEMD_UNIT_DIR, keeping one backup of any existing copy in $BACKUP_DIR"
  echo "- Start host-pulse.timer (hourly). The service runs as root with no capabilities, writes only to $HOST_PULSE_ROOT"
  echo "- Reports and state go to $HOST_PULSE_ROOT"
  echo 'Then: choose an alert channel and heartbeat in the env file (see references/alert-options.md),'
  echo 'run systemctl start host-pulse-test-alert.service and host-pulse-test-heartbeat.service,'
  echo 'and read the first report.'
  echo 'Run again with --install to make these changes.'
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo 'Run as root on the target host, with the owner approval for this host.' >&2
    exit 1
  fi
}

# The sandbox shared by the pulse and its test runs. It runs as root only to read the Docker
# socket, failed systemd units and its own root-only state folder; it holds no capabilities, sees
# the system read-only and can write only to the state folder.
service_body() {
  cat <<UNIT
Type=oneshot
# Root for the Docker socket, systemd and the root-only state folder; no capabilities are kept.
Environment=HOST_PULSE_ROOT=$HOST_PULSE_ROOT
EnvironmentFile=-$ENV_FILE
ExecStart=$1
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ReadWritePaths=$HOST_PULSE_ROOT
ProtectHome=read-only
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UNIT
}

write_units() {
  {
    printf '[Unit]\nDescription=Host pulse: read-only capacity and health check\nDocumentation=file:%s/host-pulse.sh\n\n[Service]\n' "$INSTALL_PREFIX"
    service_body "$INSTALL_PREFIX/host-pulse.sh"
  } > "$SYSTEMD_UNIT_DIR/host-pulse.service"

  # Test runs with the same env file and sandbox as the timer. Never enabled; started by hand.
  local test
  for test in alert heartbeat; do
    {
      printf '[Unit]\nDescription=Host pulse: send one test %s\nDocumentation=file:%s/host-pulse.sh\n\n[Service]\n' "$test" "$INSTALL_PREFIX"
      service_body "$INSTALL_PREFIX/host-pulse.sh --test-$test"
    } > "$SYSTEMD_UNIT_DIR/host-pulse-test-$test.service"
  done

  cat > "$SYSTEMD_UNIT_DIR/host-pulse.timer" <<'UNIT'
[Unit]
Description=Run the host pulse every hour

[Timer]
OnCalendar=hourly
AccuracySec=1s
Persistent=true

[Install]
WantedBy=timers.target
UNIT
}

# Rollback for a failed --install: put back every file this run replaced, remove every file it
# created, and reload systemd. Files the run never touched stay as they were.
CREATED=(); REPLACED=()
remember() {
  local target="$1" name="$2"
  if [ -e "$target" ]; then
    mkdir -p "$BACKUP_DIR/rollback"
    cp -a "$target" "$BACKUP_DIR/rollback/$name"
    REPLACED+=("$target|$name")
  else
    CREATED+=("$target")
  fi
}

rollback() {
  local entry
  trap - ERR
  set +e
  echo 'Install failed; putting back what was there before.' >&2
  for entry in ${REPLACED[@]+"${REPLACED[@]}"}; do cp -a "$BACKUP_DIR/rollback/${entry#*|}" "${entry%%|*}"; done
  for entry in ${CREATED[@]+"${CREATED[@]}"}; do rm -f -- "$entry"; done
  rm -rf -- "${BACKUP_DIR:?}/rollback"
  rmdir "$INSTALL_PREFIX/lib" "$INSTALL_PREFIX" 2>/dev/null
  systemctl daemon-reload 2>/dev/null
  echo 'Rolled back. Check systemctl status host-pulse.timer before trying again.' >&2
  exit 1
}

do_install() {
  require_root
  require_systemd
  local file
  for file in "${FILES[@]}"; do
    [ -f "$SOURCE_DIR/$file" ] || { echo "Missing $SOURCE_DIR/$file; nothing was changed." >&2; exit 1; }
  done
  [ -f "$TEMPLATE_DIR/host-pulse.env.example" ] || { echo "Missing $TEMPLATE_DIR/host-pulse.env.example; nothing was changed." >&2; exit 1; }
  [ -d "$SYSTEMD_UNIT_DIR" ] || { echo "Missing $SYSTEMD_UNIT_DIR; nothing was changed." >&2; exit 1; }

  trap rollback ERR
  mkdir -p "$INSTALL_PREFIX/lib" "$CONFIG_DIR" "$HOST_PULSE_ROOT"
  chmod 700 "$CONFIG_DIR" "$HOST_PULSE_ROOT"
  rm -rf -- "${BACKUP_DIR:?}/rollback"
  remember "$INSTALL_PREFIX/host-pulse.sh" host-pulse.sh
  remember "$INSTALL_PREFIX/lib/host-observability-common.sh" host-observability-common.sh
  for file in "${UNITS[@]}"; do remember "$SYSTEMD_UNIT_DIR/$file" "$file"; done
  install -m 0755 "$SOURCE_DIR/host-pulse.sh" "$INSTALL_PREFIX/host-pulse.sh"
  install -m 0644 "$SOURCE_DIR/lib/host-observability-common.sh" "$INSTALL_PREFIX/lib/host-observability-common.sh"
  if [ ! -e "$ENV_FILE" ]; then
    CREATED+=("$ENV_FILE")
    install -m 0600 "$TEMPLATE_DIR/host-pulse.env.example" "$ENV_FILE"
    echo "Created $ENV_FILE with every value commented out. Edit it on the host, never in chat."
  elif env_file_too_open; then
    chmod 600 "$ENV_FILE"
    echo "Kept the existing $ENV_FILE and tightened it to mode 600."
  else
    echo "Kept the existing $ENV_FILE"
  fi
  write_units
  systemctl daemon-reload
  systemctl enable --now host-pulse.timer
  trap - ERR

  # Keep exactly one backup of the units and scripts this install replaced.
  if [ -d "$BACKUP_DIR/rollback" ]; then
    rm -rf -- "${BACKUP_DIR:?}/previous"
    mv "$BACKUP_DIR/rollback" "$BACKUP_DIR/previous"
    echo "Kept the replaced files in $BACKUP_DIR/previous (one copy, replaced on the next install)."
  fi
  echo 'Installed. Nothing fixes anything automatically; the timer only reads and reports.'
  systemctl list-timers --all host-pulse.timer --no-pager || true
}

do_remove() {
  require_root
  local file
  if have systemctl; then
    systemctl disable --now host-pulse.timer 2>/dev/null || true
  else
    echo 'systemctl not found; removing the files only.'
  fi
  for file in "${UNITS[@]}"; do rm -f -- "${SYSTEMD_UNIT_DIR:?}/$file"; done
  if have systemctl; then systemctl daemon-reload 2>/dev/null || true; fi
  for file in "${FILES[@]}"; do rm -f -- "${INSTALL_PREFIX:?}/$file"; done
  rmdir "$INSTALL_PREFIX/lib" "$INSTALL_PREFIX" 2>/dev/null || true
  rm -rf -- "${BACKUP_DIR:?}"
  echo "Removed the timer, units, scripts and unit backups. Kept $ENV_FILE and the reports in $HOST_PULSE_ROOT."
  echo "For a full removal, also delete $ENV_FILE (it holds the alert secrets) and $HOST_PULSE_ROOT."
  echo 'If an off-host heartbeat is set up, pause or delete that check too, or it will raise a missed-pulse alarm.'
}

case "$ACTION" in
  plan) require_systemd; print_plan ;;
  install) do_install ;;
  remove) do_remove ;;
esac
