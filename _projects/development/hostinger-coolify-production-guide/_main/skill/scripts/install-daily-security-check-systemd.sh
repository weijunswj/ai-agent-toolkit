#!/usr/bin/env bash
set -euo pipefail

MAINTENANCE_ROOT="${MAINTENANCE_ROOT:-/data/maintenance}"
INSTALL_DIR="$MAINTENANCE_ROOT/bin"
REPORT_DIR="$MAINTENANCE_ROOT/reports"
UNIT_DIR="/etc/systemd/system"
SERVICE_NAME="daily-security-check.service"
TIMER_NAME="daily-security-check.timer"
SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/daily-security-check.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_TARGET="$INSTALL_DIR/daily-security-check.sh"
ENV_FILE="$MAINTENANCE_ROOT/daily-security-check.env"
ENV_EXAMPLE_SOURCE="$SCRIPT_DIR/../templates/daily-security-check.env.example"
ENV_EXAMPLE_TARGET="$MAINTENANCE_ROOT/daily-security-check.env.example"

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root with owner approval to install systemd units.' >&2
  exit 1
fi

if [ ! -f "$SCRIPT_SOURCE" ]; then
  echo "Missing script source: $SCRIPT_SOURCE" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$REPORT_DIR"
chmod 700 "$MAINTENANCE_ROOT" "$REPORT_DIR" 2>/dev/null || true
install -m 0755 "$SCRIPT_SOURCE" "$SCRIPT_TARGET"
if [ -f "$ENV_EXAMPLE_SOURCE" ]; then
  install -m 0600 "$ENV_EXAMPLE_SOURCE" "$ENV_EXAMPLE_TARGET"
fi
if [ ! -e "$ENV_FILE" ]; then
  install -m 0600 /dev/null "$ENV_FILE"
  echo "Created empty private env file at $ENV_FILE"
  echo "Edit it outside chat to enable Telegram/email notifications, healthchecks, certificates, and backup freshness checks."
fi

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
EnvironmentFile=-$ENV_FILE
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
echo "Optional notification config: $ENV_FILE"
echo "Placeholder config copied to: $ENV_EXAMPLE_TARGET"
systemctl list-timers --all "$TIMER_NAME" --no-pager || true
systemctl status "$TIMER_NAME" --no-pager || true
