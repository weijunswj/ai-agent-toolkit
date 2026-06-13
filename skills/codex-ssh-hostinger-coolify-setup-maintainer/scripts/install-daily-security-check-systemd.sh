#!/usr/bin/env bash
set -euo pipefail

MAINTENANCE_ROOT="${MAINTENANCE_ROOT:-/data/maintenance}"
INSTALL_DIR="$MAINTENANCE_ROOT/bin"
REPORT_DIR="$MAINTENANCE_ROOT/reports"
UNIT_DIR="/etc/systemd/system"
SERVICE_NAME="daily-security-check.service"
TIMER_NAME="daily-security-check.timer"
SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/daily-security-check.sh"
SCRIPT_TARGET="$INSTALL_DIR/daily-security-check.sh"

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root with owner approval to install systemd units.' >&2
  exit 1
fi

if [ ! -f "$SCRIPT_SOURCE" ]; then
  echo "Missing script source: $SCRIPT_SOURCE" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$REPORT_DIR"
install -m 0755 "$SCRIPT_SOURCE" "$SCRIPT_TARGET"

backup_existing() {
  local target="$1"
  if [ -e "$target" ]; then
    local backup="$target.bak.$(date -u +%Y%m%d%H%M%S)"
    cp -a "$target" "$backup"
    echo "Backed up existing unit to $backup"
  fi
}

backup_existing "$UNIT_DIR/$SERVICE_NAME"
backup_existing "$UNIT_DIR/$TIMER_NAME"

cat > "$UNIT_DIR/$SERVICE_NAME" <<EOF
[Unit]
Description=Daily evidence-based security check for Hostinger Coolify host
Documentation=file:$SCRIPT_TARGET

[Service]
Type=oneshot
Environment=MAINTENANCE_ROOT=$MAINTENANCE_ROOT
ExecStart=$SCRIPT_TARGET
EOF

cat > "$UNIT_DIR/$TIMER_NAME" <<'EOF'
[Unit]
Description=Run daily security check once per day

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "$TIMER_NAME"

echo 'Daily security check systemd timer installed. No auto-remediation is enabled.'
systemctl list-timers --all "$TIMER_NAME" --no-pager || true
systemctl status "$TIMER_NAME" --no-pager || true
