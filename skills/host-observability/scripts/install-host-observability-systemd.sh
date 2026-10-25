#!/usr/bin/env bash
set -euo pipefail

# Installs the host pulse as an hourly systemd timer.
# Without an option it only prints what it would change. --install makes the changes and --remove
# takes the timer and installed scripts away again (the env file and reports stay). Run it on the
# target host as root, and only with the owner's approval for that host. It never enables an alert
# channel or heartbeat by itself: the owner chooses those in the env file.

usage() {
  cat <<'USAGE'
Usage: install-host-observability-systemd.sh [--install | --remove]
  (no option)  print the plan; change nothing
  --install    copy the scripts, create the private env file if missing, write and start the timer
  --remove     stop and remove the timer and installed scripts; keep the env file and reports
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
HOST_PULSE_ROOT="${HOST_PULSE_ROOT:-/var/lib/host-observability}"
SYSTEMD_UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
UNITS=(host-pulse.service host-pulse.timer)
FILES=(host-pulse.sh lib/host-observability-common.sh)

print_plan() {
  echo 'Plan (nothing has been changed):'
  echo "- Copy ${FILES[*]} to $INSTALL_PREFIX"
  if [ -e "$ENV_FILE" ]; then echo "- Keep the existing env file $ENV_FILE as it is"
  else echo "- Create $ENV_FILE (mode 600) from templates/host-pulse.env.example, with every value commented out"; fi
  echo "- Write ${UNITS[*]} to $SYSTEMD_UNIT_DIR, backing up any existing copy"
  echo "- Start host-pulse.timer (hourly)"
  echo "- Reports and state go to $HOST_PULSE_ROOT"
  echo 'Then: choose an alert channel and heartbeat in the env file (see references/alert-options.md),'
  echo 'run host-pulse.sh --test-alert and --test-heartbeat, and read the first report.'
  echo 'Run again with --install to make these changes.'
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo 'Run as root on the target host, with the owner approval for this host.' >&2
    exit 1
  fi
}

backup_existing() {
  local target="$1"
  if [ -e "$target" ]; then
    cp -a "$target" "$target.bak.$(date -u +%Y%m%d%H%M%S)"
    echo "Backed up $target"
  fi
}

write_units() {
  cat > "$SYSTEMD_UNIT_DIR/host-pulse.service" <<UNIT
[Unit]
Description=Host pulse: read-only capacity and health check
Documentation=file:$INSTALL_PREFIX/host-pulse.sh

[Service]
Type=oneshot
Environment=HOST_PULSE_ROOT=$HOST_PULSE_ROOT
EnvironmentFile=-$ENV_FILE
ExecStart=$INSTALL_PREFIX/host-pulse.sh
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only
UNIT

  cat > "$SYSTEMD_UNIT_DIR/host-pulse.timer" <<'UNIT'
[Unit]
Description=Run the host pulse every hour

[Timer]
OnCalendar=hourly
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
}

do_install() {
  require_root
  local file
  for file in "${FILES[@]}"; do
    [ -f "$SOURCE_DIR/$file" ] || { echo "Missing $SOURCE_DIR/$file" >&2; exit 1; }
  done
  mkdir -p "$INSTALL_PREFIX/lib" "$CONFIG_DIR" "$HOST_PULSE_ROOT"
  chmod 700 "$CONFIG_DIR" "$HOST_PULSE_ROOT"
  install -m 0755 "$SOURCE_DIR/host-pulse.sh" "$INSTALL_PREFIX/host-pulse.sh"
  install -m 0644 "$SOURCE_DIR/lib/host-observability-common.sh" "$INSTALL_PREFIX/lib/host-observability-common.sh"
  if [ ! -e "$ENV_FILE" ]; then
    install -m 0600 "$TEMPLATE_DIR/host-pulse.env.example" "$ENV_FILE"
    echo "Created $ENV_FILE with every value commented out. Edit it on the host, never in chat."
  else
    echo "Kept the existing $ENV_FILE"
  fi
  for file in "${UNITS[@]}"; do backup_existing "$SYSTEMD_UNIT_DIR/$file"; done
  write_units
  systemctl daemon-reload
  systemctl enable --now host-pulse.timer
  echo 'Installed. Nothing fixes anything automatically; the timer only reads and reports.'
  systemctl list-timers --all host-pulse.timer --no-pager || true
}

do_remove() {
  require_root
  local file
  systemctl disable --now host-pulse.timer 2>/dev/null || true
  for file in "${UNITS[@]}"; do rm -f -- "${SYSTEMD_UNIT_DIR:?}/$file"; done
  systemctl daemon-reload
  for file in "${FILES[@]}"; do rm -f -- "${INSTALL_PREFIX:?}/$file"; done
  rmdir "$INSTALL_PREFIX/lib" "$INSTALL_PREFIX" 2>/dev/null || true
  echo "Removed the timer and scripts. Kept $ENV_FILE and the reports in $HOST_PULSE_ROOT."
  echo 'If an off-host heartbeat is set up, pause or delete that check too, or it will raise a missed-pulse alarm.'
}

case "$ACTION" in
  plan) print_plan ;;
  install) do_install ;;
  remove) do_remove ;;
esac
