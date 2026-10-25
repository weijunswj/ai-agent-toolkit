#!/usr/bin/env bash
# Shared helpers for host-pulse.sh. Sourced, never run on its own.
# Read-only on the host: nothing here installs, restarts, deletes outside its own state folder, or
# changes packages, Docker, firewall or services. The only outbound traffic is the alert channel and
# heartbeat URL the owner chose at set-up.

have() { command -v "$1" >/dev/null 2>&1; }

redact_text() {
  sed -E \
    -e 's#(postgres(ql)?|mysql|mongodb(\+srv)?|redis)://[^[:space:]]+#<redacted-db-url>#Ig' \
    -e 's#https://api\.telegram\.org/bot[^/[:space:]]+#https://api.telegram.org/bot<redacted>#Ig' \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@#\1<redacted-userinfo>@#g' \
    -e 's#([?&][^=[:space:]&]*(token|secret|password|passwd|api[_-]?key|key|auth|signature|sig|access[_-]?token|refresh[_-]?token)[^=[:space:]&]*=)[^&#[:space:]]+#\1<redacted>#Ig' \
    -e 's#(token|secret|password|passwd|api[_-]?key)=([^[:space:]]+)#\1=<redacted>#Ig' \
    -e 's#(Authorization:[[:space:]]*(Bearer|Basic)[[:space:]]+)[A-Za-z0-9._~+/-]+=*#\1<redacted>#Ig'
}

# Removes every configured secret value from text, then applies the pattern redaction.
redact_secrets() {
  local text
  text="$(cat)"
  local value
  for value in "${TELEGRAM_BOT_TOKEN:-}" "${ALERT_WEBHOOK_URL:-}" "${HEARTBEAT_URL:-}" "${HEARTBEAT_FAIL_URL:-}"; do
    [ -n "$value" ] || continue
    text="${text//"$value"/<redacted>}"
  done
  printf '%s\n' "$text" | redact_text
}

secret_like_url() {
  printf '%s' "$1" | grep -Eiq '://[^/@]+@|[?&][^=]*(token|secret|password|passwd|api[_-]?key|key|auth|signature|sig|access[_-]?token|refresh[_-]?token)='
}

# A URL that is safe to put in a curl config file: http or https, no spaces, quotes or backslashes.
safe_transport_url() {
  case "$1" in
    https://*|http://*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[[:space:]]*|*\"*|*\\*) return 1 ;;
  esac
  return 0
}

# A URL that carries a secret (webhook or heartbeat): https, or plain http only to this host itself.
secret_transport_url() {
  local authority
  safe_transport_url "$1" || return 1
  case "$1" in
    https://*) return 0 ;;
  esac
  # Plain http: the whole host part must be this host, with an optional port and nothing else.
  authority="${1#http://}"
  authority="${authority%%/*}"
  [[ "$authority" =~ ^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$ ]]
}

is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

json_escape() {
  awk 'BEGIN { ORS = "" }
    {
      gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "")
      gsub(/[\001-\037]/, "")
      if (NR > 1) printf "\\n"
      printf "%s", $0
    }'
}

# State files hold key=value lines written by these scripts only.
state_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); v = $0 } END { if (v != "") print v }' "$file"
}

state_write() {
  local file="$1" tmp
  shift
  tmp="$(mktemp "${file}.XXXXXX")" || return 1
  printf '%s\n' "$@" > "$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$file"
}

alert_channels() {
  printf '%s' "${ALERT_CHANNELS:-}" | tr ',' ' ' | tr '[:upper:]' '[:lower:]'
}

# The chosen channels as one comma-separated list.
alert_channel_list() {
  local channel list=''
  for channel in $(alert_channels); do list="${list:+$list,}$channel"; done
  printf '%s' "$list"
}

SENDMAIL="${SENDMAIL:-/usr/sbin/sendmail}"
have_mailer() { have mail || [ -x "$SENDMAIL" ]; }

# Prints a reason and returns 1 when the chosen channels are missing their settings.
alert_config_problem() {
  local channel found=0
  for channel in $(alert_channels); do
    found=1
    case "$channel" in
      telegram)
        [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || { printf 'telegram chosen but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty'; return 1; }
        have curl || { printf 'telegram chosen but curl is not installed'; return 1; } ;;
      email)
        [ -n "${ALERT_EMAIL_TO:-}" ] || { printf 'email chosen but ALERT_EMAIL_TO is empty'; return 1; }
        have_mailer || { printf 'email chosen but neither mail nor sendmail is installed'; return 1; } ;;
      webhook)
        [ -n "${ALERT_WEBHOOK_URL:-}" ] || { printf 'webhook chosen but ALERT_WEBHOOK_URL is empty'; return 1; }
        secret_transport_url "$ALERT_WEBHOOK_URL" || { printf 'ALERT_WEBHOOK_URL must be an https URL (plain http only to this host) with no spaces or quotes'; return 1; }
        case "${ALERT_WEBHOOK_FORMAT:-json}" in
          json|slack|discord|ntfy|text) ;;
          *) printf 'unknown ALERT_WEBHOOK_FORMAT %s (use json, slack, discord, ntfy or text)' "$ALERT_WEBHOOK_FORMAT"; return 1 ;;
        esac
        have curl || { printf 'webhook chosen but curl is not installed'; return 1; } ;;
      none|'') ;;
      *) printf 'unknown alert channel %s' "$channel"; return 1 ;;
    esac
  done
  if [ "$found" -eq 0 ]; then printf 'no alert channel chosen'; return 1; fi
  for channel in $(alert_channels); do
    [ "$channel" = none ] || return 0
  done
  printf 'alert channel set to none'
  return 1
}

# curl with the URL kept in a private config file, so secrets never show in the process list.
curl_private() {
  local url="$1" config result
  shift
  safe_transport_url "$url" || return 2
  have curl || return 3
  config="$(mktemp "${PRIVATE_TMP_DIR:-/tmp}/.curl.XXXXXX")" || return 4
  chmod 600 "$config" 2>/dev/null || true
  printf 'url = "%s"\n' "$url" > "$config"
  curl -fsS --max-time "${CURL_TIMEOUT_SECONDS:-15}" -K "$config" "$@" >/dev/null 2>&1
  result=$?
  rm -f "$config"
  return "$result"
}

send_telegram() {
  local subject="$1" body_file="$2" text
  text="$(printf '%s\n\n%s' "$subject" "$(head -c 3500 "$body_file")")"
  if [ -n "${TELEGRAM_THREAD_ID:-}" ]; then
    curl_private "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "message_thread_id=${TELEGRAM_THREAD_ID}" \
      --data-urlencode "text=$text"
  else
    curl_private "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$text"
  fi
}

send_email() {
  local subject="$1" body_file="$2"
  subject="${ALERT_EMAIL_SUBJECT_PREFIX:-[host-observability]} $subject"
  if have mail; then
    mail -s "$subject" "$ALERT_EMAIL_TO" < "$body_file"
  elif [ -x "$SENDMAIL" ]; then
    {
      printf 'To: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n' "$ALERT_EMAIL_TO" "$subject"
      cat "$body_file"
    } | "$SENDMAIL" -t
  else
    return 3
  fi
}

send_webhook() {
  local subject="$1" body_file="$2" payload text
  payload="$(mktemp "${PRIVATE_TMP_DIR:-/tmp}/.payload.XXXXXX")" || return 4
  text="$(printf '%s\n\n%s' "$subject" "$(head -c 1800 "$body_file")")"
  case "${ALERT_WEBHOOK_FORMAT:-json}" in
    slack) printf '{"text":"%s"}' "$(printf '%s' "$text" | json_escape)" > "$payload" ;;
    discord) printf '{"content":"%s"}' "$(printf '%s' "$text" | json_escape)" > "$payload" ;;
    ntfy|text) printf '%s\n' "$text" > "$payload" ;;
    json)
      printf '{"source":"host-observability","host":"%s","subject":"%s","text":"%s"}' \
        "$(printf '%s' "${HOST_LABEL:-$(hostname 2>/dev/null || printf unknown)}" | json_escape)" \
        "$(printf '%s' "$subject" | json_escape)" \
        "$(printf '%s' "$text" | json_escape)" > "$payload" ;;
    *) rm -f "$payload"; return 5 ;;
  esac
  local result
  case "${ALERT_WEBHOOK_FORMAT:-json}" in
    ntfy) curl_private "$ALERT_WEBHOOK_URL" -H "Title: $(printf '%s' "$subject" | tr -d '\r\n' | head -c 200)" --data-binary "@$payload"; result=$? ;;
    text) curl_private "$ALERT_WEBHOOK_URL" -H 'Content-Type: text/plain; charset=utf-8' --data-binary "@$payload"; result=$? ;;
    *) curl_private "$ALERT_WEBHOOK_URL" -H 'Content-Type: application/json' --data-binary "@$payload"; result=$? ;;
  esac
  rm -f "$payload"
  return "$result"
}

# One word for a channel's delivery result, with the reason when the cause is known.
delivery_result() {
  local channel="$1" rc="$2"
  case "$rc" in
    0) printf 'sent' ;;
    2) printf 'failed (URL rejected)' ;;
    3) if [ "$channel" = email ]; then printf 'failed (neither mail nor sendmail is installed)'; else printf 'failed (curl is not installed)'; fi ;;
    4) printf 'failed (no private temp file)' ;;
    5) printf 'failed (unknown webhook format)' ;;
    *) printf 'failed' ;;
  esac
}

# Sends one alert through every chosen channel. Prints "channel=sent" or "channel=failed (reason)"
# per channel, comma separated. Returns 0 only when every chosen channel accepted the message.
send_alert() {
  local subject="$1" body_file="$2" channel failed=0 rc list=''
  for channel in $(alert_channels); do
    case "$channel" in
      telegram) send_telegram "$subject" "$body_file"; rc=$? ;;
      email) send_email "$subject" "$body_file"; rc=$? ;;
      webhook) send_webhook "$subject" "$body_file"; rc=$? ;;
      *) continue ;;
    esac
    [ "$rc" -eq 0 ] || failed=1
    list="${list:+$list, }$channel=$(delivery_result "$channel" "$rc")"
  done
  printf '%s' "$list"
  return "$failed"
}

# Keeps the newest <keep> reports named <prefix>-*.md in <dir> and removes older ones. Touches only
# files this skill wrote, in its own report folder.
prune_reports() {
  local dir="$1" prefix="$2" keep="$3" name
  [ "$keep" -gt 0 ] || return 0
  find "$dir" -maxdepth 1 -type f -name "$prefix-*.md" -printf '%f\n' 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while IFS= read -r name; do
    case "$name" in "$prefix"-*.md) rm -f -- "${dir:?}/$name" ;; esac
  done
}
