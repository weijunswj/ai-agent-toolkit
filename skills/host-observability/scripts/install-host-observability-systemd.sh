#!/usr/bin/env bash
set -Eeuo pipefail

# Installs the host pulse as an hourly systemd timer.
# Without an option it only prints what it would change. --install makes the changes and --remove
# takes the timer and installed scripts away again (the env file and reports stay). Run it on the
# target host as root, and only with the owner's approval for that host. It never enables an alert
# channel or heartbeat by itself: the owner chooses those in the env file.

usage() {
  cat <<'USAGE'
Usage: install-host-observability-systemd.sh [--install | --remove] [--with-docker]
  (no option)    print the plan; change nothing
  --install      copy the scripts, create the private env file if missing, write and start the timer;
                 on any failure or interruption, put back what was there before
  --remove       stop and remove the timer, units and installed scripts; keep the env file and reports
  --with-docker  let the pulse read Docker by joining the docker group. Docker socket access is full
                 control of Docker, which equals full root on this host. Off unless given.
Settings (environment): INSTALL_PREFIX and CONFIG_DIR (absolute, ending in /host-observability),
SYSTEMD_UNIT_DIR.
USAGE
}

ACTION=plan
WITH_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --install) [ "$ACTION" = plan ] || { usage >&2; exit 2; }; ACTION=install ;;
    --remove) [ "$ACTION" = plan ] || { usage >&2; exit 2; }; ACTION=remove ;;
    --with-docker) WITH_DOCKER=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SOURCE_DIR/../templates"
INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local/lib/host-observability}"
CONFIG_DIR="${CONFIG_DIR:-/etc/host-observability}"
ENV_FILE="$CONFIG_DIR/host-pulse.env"
BACKUP_DIR="$CONFIG_DIR/backup"
# systemd creates this folder for the service user (StateDirectory=host-observability).
STATE_PATH=/var/lib/host-observability
# A dedicated system user, not DynamicUser=: on Ubuntu a dynamic user cannot reach the system bus
# through dbus-daemon, and systemctl needs it to list failed units.
SERVICE_USER=host-pulse
USER_MARKER="$CONFIG_DIR/.created-service-user"
SYSTEMD_UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SYSTEMD_RUN_DIR="${SYSTEMD_RUN_DIR:-/run/systemd/system}"
UNITS=(host-pulse.service host-pulse.timer host-pulse-test-alert.service host-pulse-test-heartbeat.service)
FILES=(host-pulse.sh lib/host-observability-common.sh)

have() { command -v "$1" >/dev/null 2>&1; }

# The installer only ever creates, changes or deletes paths it owns, so the two folder settings
# must be absolute and end in /host-observability. A typo such as CONFIG_DIR=/etc is refused.
check_paths() {
  local name value
  for name in INSTALL_PREFIX CONFIG_DIR; do
    value="${!name}"
    case "$value" in
      /*/host-observability) ;;
      *) echo "$name must be an absolute path ending in /host-observability (got: $value); nothing was changed." >&2; exit 2 ;;
    esac
    case "$value" in
      *//*|*/./*|*/../*) echo "$name must not contain //, /./ or /../ (got: $value); nothing was changed." >&2; exit 2 ;;
    esac
  done
  case "$SYSTEMD_UNIT_DIR" in
    /*) ;;
    *) echo "SYSTEMD_UNIT_DIR must be an absolute path; nothing was changed." >&2; exit 2 ;;
  esac
}

# The pulse needs Linux with systemd running. Checked before the plan and before any write.
require_systemd() {
  if [ "$(uname -s 2>/dev/null)" != Linux ] || [ ! -d "$SYSTEMD_RUN_DIR" ] || ! have systemctl; then
    echo 'systemd is not running on this host; nothing was changed.' >&2
    echo 'The pulse needs Linux with systemd. On another init system, run host-pulse.sh from its own scheduler.' >&2
    exit 1
  fi
}

require_useradd() {
  getent passwd "$SERVICE_USER" >/dev/null 2>&1 && return 0
  if ! have useradd; then
    echo "useradd is not available to create the $SERVICE_USER system user; nothing was changed." >&2
    exit 1
  fi
}

require_docker_group() {
  [ "$WITH_DOCKER" -eq 1 ] || return 0
  if ! getent group docker >/dev/null 2>&1; then
    echo '--with-docker needs a docker group on this host, and there is none; nothing was changed.' >&2
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
  if getent passwd "$SERVICE_USER" >/dev/null 2>&1; then echo "- Use the existing system user $SERVICE_USER for the service"
  else echo "- Create the system user $SERVICE_USER (no login, no home folder) for the service; --remove deletes it"; fi
  echo "- Write ${UNITS[*]} to $SYSTEMD_UNIT_DIR, keeping one backup of any existing copy in $BACKUP_DIR"
  echo "- Start host-pulse.timer (hourly). The service runs as the unprivileged user $SERVICE_USER, with no"
  echo "  capabilities, a read-only view of the system and write access only to $STATE_PATH."
  echo '  systemd reads the env file for it, so the service cannot read other secrets.'
  if [ "$WITH_DOCKER" -eq 1 ]; then
    echo '- Docker checks ON: the service joins the docker group. Docker socket access is full control of'
    echo '  Docker, which equals full root on this host: the sandbox does not limit what Docker can be'
    echo '  asked to do. The pulse itself only lists and inspects containers.'
  else
    echo '- Docker checks OFF: the service cannot reach the Docker socket. Add --with-docker to turn them'
    echo '  on; that gives the service the equivalent of root on this host.'
  fi
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

# The sandbox shared by the pulse and its test runs: the unprivileged host-pulse user with no
# capabilities, a read-only view of the system and one writable state folder. systemd reads the env
# file as root and passes the values in. With --with-docker the service also joins the docker
# group, and Docker socket access equals root on this host.
service_body() {
  cat <<UNIT
Type=oneshot
# The unprivileged system user $SERVICE_USER, with no capabilities.
User=$SERVICE_USER
Group=$SERVICE_USER
StateDirectory=host-observability
StateDirectoryMode=0700
Environment=HOST_PULSE_ROOT=%S/host-observability
UNIT
  if [ "$WITH_DOCKER" -eq 1 ]; then
    cat <<'UNIT'
# Docker checks on (installed with --with-docker): Docker socket access equals root on this host.
SupplementaryGroups=docker
Environment=DOCKER_ACCESS=yes
UNIT
  else
    cat <<'UNIT'
# Docker checks off: no Docker socket access. Reinstall with --with-docker to turn them on.
Environment=DOCKER_ACCESS=no
UNIT
  fi
  cat <<UNIT
EnvironmentFile=-$ENV_FILE
ExecStart=$1
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
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

# Rollback for a failed or interrupted --install: put back every file this run replaced, remove
# every file and folder it created, undo the timer enablement if this run made it, and reload
# systemd. Files the run never touched stay as they were.
CREATED=(); CREATED_DIRS=(); REPLACED=(); TIMER_WAS_ENABLED=1; USER_CREATED=0
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

make_dir() {
  [ -d "$1" ] && return 0
  mkdir -m "$2" "$1"
  CREATED_DIRS=("$1" ${CREATED_DIRS[@]+"${CREATED_DIRS[@]}"})
}

rollback() {
  local entry
  trap - ERR HUP INT TERM
  set +e
  echo 'Install failed or was interrupted; putting back what was there before.' >&2
  if [ "$TIMER_WAS_ENABLED" -eq 0 ]; then systemctl disable --now host-pulse.timer >/dev/null 2>&1; fi
  for entry in ${REPLACED[@]+"${REPLACED[@]}"}; do cp -a "$BACKUP_DIR/rollback/${entry#*|}" "${entry%%|*}"; done
  for entry in ${CREATED[@]+"${CREATED[@]}"}; do rm -f -- "$entry"; done
  rm -rf -- "${BACKUP_DIR:?}/rollback"
  if [ "$USER_CREATED" -eq 1 ]; then userdel "$SERVICE_USER" 2>/dev/null; rm -f -- "$USER_MARKER"; fi
  for entry in ${CREATED_DIRS[@]+"${CREATED_DIRS[@]}"}; do rmdir -- "$entry" 2>/dev/null; done
  systemctl daemon-reload 2>/dev/null
  echo 'Rolled back. Check systemctl status host-pulse.timer before trying again.' >&2
  exit 1
}

do_install() {
  require_root
  require_systemd
  require_useradd
  require_docker_group
  local file dir
  for file in "${FILES[@]}"; do
    [ -f "$SOURCE_DIR/$file" ] || { echo "Missing $SOURCE_DIR/$file; nothing was changed." >&2; exit 1; }
  done
  [ -f "$TEMPLATE_DIR/host-pulse.env.example" ] || { echo "Missing $TEMPLATE_DIR/host-pulse.env.example; nothing was changed." >&2; exit 1; }
  for dir in "$SYSTEMD_UNIT_DIR" "$(dirname "$INSTALL_PREFIX")" "$(dirname "$CONFIG_DIR")"; do
    [ -d "$dir" ] || { echo "Missing $dir; nothing was changed." >&2; exit 1; }
  done
  if [ -e "$BACKUP_DIR/rollback" ]; then
    echo "An earlier install was interrupted: the files it replaced are saved in $BACKUP_DIR/rollback." >&2
    echo 'Copy them back (or delete that folder once you have checked them), then run --install again; nothing was changed.' >&2
    exit 1
  fi
  if ! systemctl is-enabled --quiet host-pulse.timer 2>/dev/null; then TIMER_WAS_ENABLED=0; fi

  trap rollback ERR HUP INT TERM
  make_dir "$INSTALL_PREFIX" 0755
  make_dir "$INSTALL_PREFIX/lib" 0755
  make_dir "$CONFIG_DIR" 0700
  if ! getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
    USER_CREATED=1
    useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
      --comment 'host-observability pulse' "$SERVICE_USER"
    touch "$USER_MARKER"
    echo "Created the system user $SERVICE_USER."
  fi
  remember "$INSTALL_PREFIX/host-pulse.sh" host-pulse.sh
  remember "$INSTALL_PREFIX/lib/host-observability-common.sh" host-observability-common.sh
  for file in "${UNITS[@]}"; do remember "$SYSTEMD_UNIT_DIR/$file" "$file"; done
  [ ! -d "$BACKUP_DIR/rollback" ] || CREATED_DIRS=("$BACKUP_DIR" ${CREATED_DIRS[@]+"${CREATED_DIRS[@]}"})
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
  trap - ERR HUP INT TERM

  # Keep exactly one backup of the units and scripts this install replaced.
  if [ -d "$BACKUP_DIR/rollback" ]; then
    rm -rf -- "${BACKUP_DIR:?}/previous"
    mv "$BACKUP_DIR/rollback" "$BACKUP_DIR/previous"
    echo "Kept the replaced files in $BACKUP_DIR/previous (one copy, replaced on the next install)."
  fi
  if [ "$WITH_DOCKER" -eq 1 ]; then
    echo 'Docker checks are on. Docker socket access equals root on this host.'
  else
    echo 'Docker checks are off; reinstall with --with-docker to turn them on (that equals root on this host).'
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
  if have systemctl; then
    systemctl daemon-reload 2>/dev/null || true
    systemctl reset-failed host-pulse.service host-pulse-test-alert.service host-pulse-test-heartbeat.service 2>/dev/null || true
  fi
  for file in "${FILES[@]}"; do rm -f -- "${INSTALL_PREFIX:?}/$file"; done
  rmdir "$INSTALL_PREFIX/lib" "$INSTALL_PREFIX" 2>/dev/null || true
  rm -rf -- "${BACKUP_DIR:?}"
  if [ -e "$USER_MARKER" ]; then
    if ! getent passwd "$SERVICE_USER" >/dev/null 2>&1; then
      rm -f -- "$USER_MARKER"
    elif have userdel && userdel "$SERVICE_USER"; then
      rm -f -- "$USER_MARKER"
      echo "Deleted the system user $SERVICE_USER."
    else
      echo "Could not delete the system user $SERVICE_USER; run userdel $SERVICE_USER once nothing runs as it." >&2
    fi
  fi
  echo "Removed the timer, units, scripts and unit backups. Kept $ENV_FILE and the reports in $STATE_PATH."
  echo "For a full removal, also delete $ENV_FILE (it holds the alert secrets) and $STATE_PATH."
  echo 'If an off-host heartbeat is set up, pause or delete that check too, or it will raise a missed-pulse alarm.'
}

check_paths
case "$ACTION" in
  plan) require_systemd; require_useradd; require_docker_group; print_plan ;;
  install) do_install ;;
  remove) do_remove ;;
esac
