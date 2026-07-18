'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = [
  '_projects/development/hostinger-coolify-production-guide/_main/skill/scripts/daily-security-check.sh',
  'skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/daily-security-check.sh'
];
const authoritativeDailyCheck = scripts[0];
const generatedDailyCheck = scripts[1];
const hostingerDocsPath = 'docs/hostinger-coolify/';

function findBash() {
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
        'bash.exe'
      ]
    : ['bash'];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function toBashPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const normalized = path.resolve(filePath);
  const drive = normalized.slice(0, 1).toLowerCase();
  const rest = normalized.slice(2).replace(/\\/g, '/');
  return `/${drive}${rest}`;
}

function runDailyCheckScenario(scriptRelPath, scenario) {
  const bash = findBash();
  assert.ok(bash, 'bash is required to validate daily-security-check.sh');

  const command = String.raw`
set -euo pipefail
script="$1"
scenario="$2"
tmp="$(mktemp -d)"
report=''
cleanup() {
  cd /tmp >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
dump_debug() {
  status=$?
  printf '%s\n' '--- daily-security-check stdout ---'
  [ -f "$tmp/stdout.txt" ] && cat "$tmp/stdout.txt" || true
  printf '%s\n' '--- daily-security-check stderr ---' >&2
  [ -f "$tmp/stderr.txt" ] && cat "$tmp/stderr.txt" >&2 || true
  if [ -n "\${report:-}" ] && [ -f "$report" ]; then
    printf '%s\n' '--- daily-security-check report ---'
    cat "$report"
  fi
  exit "$status"
}
trap dump_debug ERR
cd "$tmp"
mkdir -- -delete
printf keep > sentinel.txt
mkdir -p "$tmp/bin"
cat > "$tmp/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
chmod +x "$tmp/bin/systemctl"
PATH="$tmp/bin:/usr/bin:/bin"
export PATH
unset HEALTHCHECK_URLS HEALTHCHECK_HOSTS BACKUP_PATHS NOTIFY_TELEGRAM_BOT_TOKEN NOTIFY_TELEGRAM_CHAT_ID NOTIFY_TELEGRAM_THREAD_ID NOTIFY_EMAIL_TO NOTIFY_EMAIL_SUBJECT_PREFIX

if [[ "$scenario" == journal-* ]]; then
  cat > "$tmp/bin/find" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$tmp/bin/find"
  cat > "$tmp/bin/journalctl" <<'STUB'
#!/usr/bin/env bash
set -u

scenario="$JOURNAL_SCENARIO"
args=" $* "

record() {
  id="$1"
  printf '__CURSOR=s=test;i=%s;b=0123456789abcdef0123456789abcdef;m=%s;t=%s;x=test\n' "$id" "$id" "$id"
  printf '__REALTIME_TIMESTAMP=%s\n' "$id"
  printf '__MONOTONIC_TIMESTAMP=%s\n' "$id"
  printf '_BOOT_ID=0123456789abcdef0123456789abcdef\n\n'
}

if [[ "$scenario" == journal-auth-case-insensitive ]]; then
  [[ "$args" == *" --grep=Failed password|authentication failure|Invalid user "* ]] || exit 9
  if [[ "$args" == *" --case-sensitive=false "* ]]; then
    if [[ "$args" == *" --output=cat "* ]]; then
      printf '%s\n' 'Failed password canonical' 'failed password lowercase' 'FAILED PASSWORD uppercase' 'Invalid user canonical' 'invalid user lowercase'
    else
      record 1; record 2; record 3; record 4; record 5
    fi
  elif [[ "$args" == *" --output=cat "* ]]; then
    printf '%s\n' 'Failed password canonical' 'Invalid user canonical'
  else
    record 1; record 2
  fi
  exit 0
fi

if [[ "$args" == *" --output=cat "* ]]; then
  [[ "$args" == *" --lines=80 "* ]] || exit 8
  case "$scenario" in
    journal-hostile)
      printf 'authentication failure token=journal-secret /home/private-user/config 2001:db8::1 private@example.test \x60\x60\x60 | %012000d\n' 0
      ;;
    journal-one) printf 'one bounded journal detail\n' ;;
    journal-multiple) printf 'journal detail one\njournal detail two\njournal detail three\n' ;;
    journal-stderr) printf 'journal diagnostic only\n' >&2 ;;
    journal-failure) printf 'journal service unavailable\n' >&2; exit 5 ;;
    journal-permission) printf 'permission denied: /home/private-user/config token=journal-secret\n' >&2; exit 1 ;;
    journal-malformed) printf 'malformed detail\n' ;;
  esac
  exit 0
fi

case "$scenario" in
  journal-placeholder)
    if [[ "$args" != *" --output=export "* ]]; then printf '%s\n' '-- No entries --'; fi
    ;;
  journal-empty) ;;
  journal-one) record 1 ;;
  journal-multiple) record 1; record 2; record 3 ;;
  journal-stderr) printf 'journal diagnostic only\n' >&2 ;;
  journal-failure) printf 'journal service unavailable\n' >&2; exit 5 ;;
  journal-permission) printf 'permission denied: /home/private-user/config token=journal-secret\n' >&2; exit 1 ;;
  journal-malformed) printf '{"truncated":true\n' ;;
  journal-hostile) record 1 ;;
  *) printf 'unknown journal scenario\n' >&2; exit 9 ;;
esac
STUB
  chmod +x "$tmp/bin/journalctl"
  PATH="$tmp/bin:$PATH" JOURNAL_SCENARIO="$scenario" MAINTENANCE_ROOT="$tmp/maintenance" bash "$script" >"$tmp/stdout.txt" 2>"$tmp/stderr.txt"
  test -f sentinel.txt
  report="$tmp/maintenance/reports/latest-security-check.md"

  case "$scenario" in
    journal-placeholder|journal-empty)
      grep -Fq '| SSH/auth failures | PASS | 0 recent auth failure records | None. |' "$report"
      grep -Fq '| Critical system errors | PASS | 0 recent critical journal records | None. |' "$report"
      ;;
    journal-one)
      grep -Fq '| SSH/auth failures | PASS | 1 recent auth failure record | None. |' "$report"
      grep -Fq '| Critical system errors | WARN | 1 recent critical journal record | Review journal details. |' "$report"
      ;;
    journal-multiple)
      grep -Fq '| SSH/auth failures | PASS | 3 recent auth failure records | None. |' "$report"
      grep -Fq '| Critical system errors | WARN | 3 recent critical journal records | Review journal details. |' "$report"
      ;;
    journal-stderr)
      grep -Fq '| SSH/auth failures | WARN | Journal evidence unavailable: journal diagnostic only | Review journal access and diagnostics. |' "$report"
      grep -Fq '| Critical system errors | WARN | Journal evidence unavailable: journal diagnostic only | Review journal access and diagnostics. |' "$report"
      ;;
    journal-failure)
      grep -Fq '| SSH/auth failures | WARN | Journal query failed (exit 5): journal service unavailable | Review journal access and diagnostics. |' "$report"
      grep -Fq '| Critical system errors | WARN | Journal query failed (exit 5): journal service unavailable | Review journal access and diagnostics. |' "$report"
      ;;
    journal-permission)
      grep -Fq '| SSH/auth failures | WARN | Journal query failed (exit 1): permission denied: <private-path> token=<redacted> | Review journal access and diagnostics. |' "$report"
      grep -Fq '| Critical system errors | WARN | Journal query failed (exit 1): permission denied: <private-path> token=<redacted> | Review journal access and diagnostics. |' "$report"
      ! grep -Fq '/home/private-user' "$report"
      ! grep -Fq 'journal-secret' "$report"
      ;;
    journal-malformed)
      grep -Fq '| SSH/auth failures | WARN | Malformed journal record output; evidence unavailable | Review journal access and output format. |' "$report"
      grep -Fq '| Critical system errors | WARN | Malformed journal record output; evidence unavailable | Review journal access and output format. |' "$report"
      ;;
    journal-hostile)
      grep -Fq '| Critical system errors | WARN | 1 recent critical journal record | Review journal details. |' "$report"
      ! grep -Fq '/home/private-user' "$report"
      ! grep -Fq 'journal-secret' "$report"
      ! grep -Fq '2001:db8::1' "$report"
      ! grep -Fq 'private@example.test' "$report"
      ! grep -Fq $'\x60\x60\x60 |' "$report"
      test "$(wc -c < "$report")" -lt 15000
      ;;
    journal-auth-case-insensitive)
      grep -Fq '| SSH/auth failures | PASS | 5 recent auth failure records | None. |' "$report"
      grep -Fq 'Failed password canonical' "$report"
      grep -Fq 'failed password lowercase' "$report"
      grep -Fq 'FAILED PASSWORD uppercase' "$report"
      grep -Fq 'Invalid user canonical' "$report"
      grep -Fq 'invalid user lowercase' "$report"
      ! grep -Fq 'Accepted publickey unrelated' "$report"
      ;;
  esac
  exit 0
fi

case "$scenario" in
  unsafe)
    MAINTENANCE_ROOT="$tmp/maintenance" BACKUP_PATHS="-delete" bash "$script" >"$tmp/stdout.txt" 2>"$tmp/stderr.txt"
    test -f sentinel.txt
    report="$tmp/maintenance/reports/latest-security-check.md"
    grep -q 'Backup freshness -delete' "$report"
    grep -q 'Rejected unsafe backup path' "$report"
    ! grep -q 'No files found' "$report"
    grep -q 'Intrusion signal:' "$report"
    grep -q 'Daily notification configured' "$report"
    ;;
  absolute)
    mkdir -p "$tmp/backups"
    printf backup > "$tmp/backups/backup.txt"
    MAINTENANCE_ROOT="$tmp/maintenance" BACKUP_PATHS="$tmp/backups" bash "$script" >"$tmp/stdout.txt" 2>"$tmp/stderr.txt"
    test -f sentinel.txt
    report="$tmp/maintenance/reports/latest-security-check.md"
    grep -q 'Backup freshness ' "$report"
    grep -q 'PASS' "$report"
    grep -q 'Newest file: backup.txt' "$report"
    ! grep -q 'Rejected unsafe backup path' "$report"
    ! grep -q 'Rejected non-absolute backup path' "$report"
    ;;
  telegram)
    export CURL_ARGS_FILE="$tmp/curl-args.txt"
    cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CURL_ARGS_FILE"
for arg in "$@"; do
  case "$arg" in
    *super-secret-token*) exit 9 ;;
  esac
done
exit 0
STUB
    chmod +x "$tmp/bin/curl"
    PATH="$tmp/bin:$PATH" MAINTENANCE_ROOT="$tmp/maintenance" NOTIFY_TELEGRAM_BOT_TOKEN="super-secret-token" NOTIFY_TELEGRAM_CHAT_ID="12345" bash "$script" >"$tmp/stdout.txt" 2>"$tmp/stderr.txt"
    test -f sentinel.txt
    report="$tmp/maintenance/reports/latest-security-check.md"
    grep -q 'Daily notification configured' "$report"
    grep -q 'telegram configured' "$report"
    grep -q 'Telegram notification sent or not configured' "$tmp/stdout.txt"
    ! grep -R -q 'super-secret-token' "$report" "$tmp/stdout.txt" "$tmp/stderr.txt" "$tmp/curl-args.txt"
    ;;
  *)
    echo "unknown scenario: $scenario" >&2
    exit 2
    ;;
esac

cat "$tmp/stdout.txt"
cat "$tmp/stderr.txt" >&2
`;

  const result = spawnSync(bash, ['-l', '-s', '--', toBashPath(path.join(repoRoot, scriptRelPath)), scenario], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: command
  });

  assert.equal(result.status, 0, `${scriptRelPath} ${scenario}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

test('daily security check rejects leading-dash BACKUP_PATHS entries without mutation', () => {
  for (const scriptRelPath of scripts) {
    runDailyCheckScenario(scriptRelPath, 'unsafe');
  }
});

test('daily security check accepts absolute backup directories after canonicalization', () => {
  for (const scriptRelPath of scripts) {
    runDailyCheckScenario(scriptRelPath, 'absolute');
  }
});

test('daily security check can send Telegram notification without leaking token', () => {
  for (const scriptRelPath of scripts) {
    runDailyCheckScenario(scriptRelPath, 'telegram');
  }
});

for (const [scenario, title] of [
  ['journal-placeholder', 'literal journal placeholder is not counted as a record'],
  ['journal-empty', 'successful empty journal output counts zero records'],
  ['journal-one', 'one structured journal record counts exactly once'],
  ['journal-multiple', 'multiple structured journal records count exactly'],
  ['journal-stderr', 'stderr-only journal diagnostics are visible but never counted'],
  ['journal-failure', 'non-zero journal query exit is visible and never treated as zero'],
  ['journal-permission', 'permission-denied journal query is redacted and never treated as zero'],
  ['journal-malformed', 'malformed structured journal output is unavailable rather than counted'],
  ['journal-hostile', 'hostile journal detail is sanitised and deterministically bounded'],
  ['journal-auth-case-insensitive', 'auth summary and detail preserve case-insensitive matching']
]) {
  test(title, () => {
    runDailyCheckScenario(authoritativeDailyCheck, scenario);
  });
}

test('daily security check remains operationally read-only', () => {
  const content = fs.readFileSync(path.join(repoRoot, authoritativeDailyCheck), 'utf8');
  assert.doesNotMatch(content, /^\s*(?:sudo\s+)?(?:apt(?:-get)?\s+(?:install|upgrade)|systemctl\s+(?:restart|stop|enable|disable)|docker\s+(?:rm|stop|restart|compose\s+(?:up|down))|ufw\s+(?:allow|deny|delete|enable|disable)|reboot|shutdown)\b/m);
});

test('raw journal temporary files are registered for EXIT cleanup', () => {
  const content = fs.readFileSync(path.join(repoRoot, authoritativeDailyCheck), 'utf8');
  assert.match(content, /JOURNAL_TEMP_FILES=\(\)/);
  assert.match(content, /trap cleanup_temp_files EXIT/);
  assert.match(content, /trap 'exit 143' TERM/);
  assert.equal((content.match(/JOURNAL_TEMP_FILES\+=\("\$[^\"]+"\)/g) || []).length, 4);
  assert.ok(content.indexOf('trap cleanup_temp_files EXIT') < content.indexOf('query_journal_records()'));
});

test('journal detail queries retain the newest bounded record set', () => {
  const content = fs.readFileSync(path.join(repoRoot, authoritativeDailyCheck), 'utf8');
  assert.match(content, /journalctl --quiet --no-pager --lines=80 --output=cat --output-fields=MESSAGE/);
});

test('authoritative and generated daily security checks are byte-aligned', () => {
  assert.deepEqual(
    fs.readFileSync(path.join(repoRoot, generatedDailyCheck)),
    fs.readFileSync(path.join(repoRoot, authoritativeDailyCheck))
  );
});

test('Hostinger/Coolify repo-side evidence artifacts have a docs home', () => {
  const requiredFiles = [
    '_projects/development/hostinger-coolify-production-guide/_main/hostinger-coolify-production-guide.md',
    '_projects/development/hostinger-coolify-production-guide/_main/skill/checklists/bootstrap-checklist.md',
    '_projects/development/hostinger-coolify-production-guide/_main/skill/checklists/deploy-checklist.md',
    '_projects/development/hostinger-coolify-production-guide/_main/skill/checklists/maintenance-checklist.md',
    '_projects/development/hostinger-coolify-production-guide/curated_output_for_ai/skills/codex-ssh-hostinger-coolify-setup-maintainer/SKILL.md',
    'skills/codex-ssh-hostinger-coolify-setup-maintainer/SKILL.md',
    'skills/codex-ssh-hostinger-coolify-setup-maintainer/references/hostinger-coolify-production-guide.md',
    'repo/docs/SKILL-SAFETY-MATRIX.md'
  ];

  for (const relPath of requiredFiles) {
    const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.ok(content.includes(hostingerDocsPath), relPath);
  }
});
