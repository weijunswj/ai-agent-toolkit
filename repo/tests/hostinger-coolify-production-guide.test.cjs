'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = [
  '_projects/development/hostinger-coolify-production-guide/_main/skill/scripts/daily-security-check.sh',
  'skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/daily-security-check.sh'
];

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
