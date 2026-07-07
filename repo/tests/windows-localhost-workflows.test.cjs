'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

const skillPaths = [
  '_projects/development/windows-localhost-workflows/_main/skill/SKILL.md',
  'skills/windows-localhost-workflows/SKILL.md'
];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

test('Windows localhost skill prevents indefinite foreground server waits', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /Do not run persistent server commands[\s\S]*in the foreground/i, relPath);
    assert.match(text, /detached\/background process/i, relPath);
    assert.match(text, /bounded readiness/i, relPath);
    assert.match(text, /60-120 seconds/i, relPath);
    assert.match(text, /poll every 1-3 seconds/i, relPath);
    assert.match(text, /never wait indefinitely/i, relPath);
    assert.match(text, /timeout wrapper|explicit user-approved foreground run/i, relPath);
  }
});

test('Windows localhost skill requires observable readiness and timeout reports', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /HTTP 200\/expected status/i, relPath);
    assert.match(text, /TCP port listening/i, relPath);
    assert.match(text, /known health endpoint/i, relPath);
    assert.match(text, /command attempted/i, relPath);
    assert.match(text, /safe log tail/i, relPath);
    assert.match(text, /port status/i, relPath);
    assert.match(text, /process status/i, relPath);
    assert.match(text, /next manual action/i, relPath);
    assert.match(text, /Never rely only on `?Start-Process`? exit state/i, relPath);
  }
});

test('Windows localhost skill documents safe PowerShell launcher patterns', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /Avoid deeply nested one-line PowerShell strings/i, relPath);
    assert.match(text, /quotes, `#`, `=`, `\$`, JSON/i, relPath);
    assert.match(text, /temporary `\.ps1` launcher script/i, relPath);
    assert.match(text, /Start-Process powershell\.exe -ArgumentList @\("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "<launcher\.ps1>"\)/i, relPath);
    assert.match(text, /Start-Job[\s\S]*short background setup only/i, relPath);
    assert.match(text, /simple `cmd \/c` or PowerShell command only when no nested quoting is needed/i, relPath);
    assert.match(text, /avoid committing it unless intentionally added as repo tooling/i, relPath);
  }
});

test('Windows localhost skill requires safe startup logs without secret disclosure', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /Redirect stdout\/stderr to local logs/i, relPath);
    assert.match(text, /last 30-80 lines/i, relPath);
    assert.match(text, /Do not print secrets/i, relPath);
    assert.match(text, /DATABASE_URL/i, relPath);
    assert.match(text, /OAuth secrets/i, relPath);
    assert.match(text, /tokens/i, relPath);
    assert.match(text, /cookies/i, relPath);
    assert.match(text, /callback URLs with query params/i, relPath);
    assert.match(text, /private customer\/profile\/pricing data/i, relPath);
    assert.match(text, /generated quote contents/i, relPath);
  }
});

test('Windows localhost skill handles stale processes and two-server UAT explicitly', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /Before launching, check whether the intended port is already listening/i, relPath);
    assert.match(text, /If the port is already listening, health-check it first/i, relPath);
    assert.match(text, /ask before killing/i, relPath);
    assert.match(text, /process IDs/i, relPath);
    assert.match(text, /Start dependency services first/i, relPath);
    assert.match(text, /Run DB preflight before migrations/i, relPath);
    assert.match(text, /Run migrations before app start/i, relPath);
    assert.match(text, /Start app servers separately/i, relPath);
    assert.match(text, /Health-check each URL independently/i, relPath);
    assert.match(text, /Use `127\.0\.0\.1` consistently/i, relPath);
  }
});

test('Windows localhost skill includes safe and unsafe concrete examples', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /Preferred Windows-safe launcher example/i, relPath);
    assert.match(text, /New-Item -ItemType Directory/i, relPath);
    assert.match(text, /Set-Content -LiteralPath \$launcher/i, relPath);
    assert.match(text, /-File", \$launcher/i, relPath);
    assert.match(text, /Invoke-WebRequest -Uri \$url/i, relPath);
    assert.match(text, /Get-NetTCPConnection -LocalPort \$port/i, relPath);
    assert.match(text, /Anti-patterns/i, relPath);
    assert.match(text, /large quoted script with `\$line\.IndexOf\("="\)` and `\$line\.StartsWith\("#"\)`/i, relPath);
    assert.match(text, /assuming successful process launch means server is ready/i, relPath);
    assert.match(text, /printing full env or DB URLs/i, relPath);
  }
});
