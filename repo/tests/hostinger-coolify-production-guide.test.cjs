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
    mkdir -p "$tmp/bin"
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

  const result = spawnSync(bash, ['-lc', command, 'daily-security-check-test', toBashPath(path.join(repoRoot, scriptRelPath)), scenario], {
    cwd: repoRoot,
    encoding: 'utf8'
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
