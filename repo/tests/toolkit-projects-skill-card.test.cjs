'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const card = require('../scripts/toolkit-projects-skill-card.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
// As checked out (CRLF on a Windows runner), and as LF text the fixtures below are built from.
const MAIN_RAW = fs.readFileSync(path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/SKILL.md'), 'utf8');
const MAIN = MAIN_RAW.replace(/\r\n/g, '\n');
const VERSION = /^Version: (\S+)$/m.exec(MAIN)[1];
// The synced copy as Claude Code keeps it: an older Version line, frontmatter kept, final newline dropped.
const restamped = MAIN.replace(/^Version: .*$/m, 'Version: 2026-01-01.1').replace(/\s+$/, '');

test('only the text decides: the Version line, line endings, trailing whitespace and a BOM are not text', () => {
  for (const [label, saved] of [
    ['identical', MAIN],
    ['older Version, no final newline', restamped],
    ['CRLF', restamped.replace(/\n/g, '\r\n')],
    ['old Mac line ends', restamped.replace(/\n/g, '\r')],
    ['trailing spaces and tabs', restamped.split('\n').map(line => `${line} \t`).join('\n')],
    ['a byte order mark', `﻿${restamped}`],
    ['body only (the claude.ai record)', restamped.replace(/^---\n[\s\S]*?\n---\n/, '')],
    ['unquoted description', restamped.replace(/^description: "(.*)"$/m, 'description: $1')],
  ]) {
    assert.equal(card.compareSkill(saved, MAIN).state, 'current', label);
    assert.equal(card.compareSkill(saved, MAIN_RAW).state, 'current', `${label}, main as checked out`);
  }
  const result = card.compareSkill(restamped, MAIN);
  assert.deepEqual(result, { state: 'current', saved: '2026-01-01.1', main: VERSION, fingerprint: card.fingerprint(card.skillText(MAIN)) });
  assert.equal(card.cardLine(result), `SKILL CARD CURRENT ${VERSION} (saved 2026-01-01.1, Version line only)`);
  assert.equal(card.cardLine(card.compareSkill(MAIN, MAIN)), `SKILL CARD CURRENT ${VERSION}`);
});

test('any real text change is outdated, and the fingerprint follows main\'s text, not its Version', () => {
  for (const [label, saved] of [
    ['a changed word', restamped.replace('Run Toolkit repos', 'Run Toolkit repositories')],
    ['a removed line', restamped.split('\n').filter((line, index) => index !== 12).join('\n')],
    ['an added blank line', restamped.replace('\n\n', '\n\n\n')],
    ['leading indent', restamped.replace('\n- ', '\n  - ')],
    ['a changed description', restamped.replace(/^description: ".*"$/m, 'description: "Other."')],
    ['a second Version line kept as text', restamped.replace('Version: 2026-01-01.1', 'Version: 2026-01-01.1\nVersion: 2026-01-01.1')],
  ]) {
    const result = card.compareSkill(saved, MAIN);
    assert.equal(result.state, 'outdated', label);
    assert.equal(card.cardLine(result), `SKILL CARD OUTDATED: saved 2026-01-01.1, main ${VERSION}, text ${result.fingerprint}`, label);
  }
  const fp = card.compareSkill(restamped, MAIN).fingerprint;
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.equal(card.compareSkill(restamped, MAIN_RAW).fingerprint, fp, 'line endings of main do not move it');
  assert.equal(card.compareSkill(restamped, MAIN.replace(/^Version: .*$/m, 'Version: 2099-12-31.9')).fingerprint, fp, 'a Version-only release keeps the fingerprint');
  assert.notEqual(card.compareSkill(restamped, MAIN.replace('Run Toolkit repos', 'Run repos')).fingerprint, fp, 'a text change moves it');
});

test('a copy or main without a Version line is not seen, with the reason', () => {
  assert.deepEqual(card.compareSkill('# no version\n', MAIN), { state: 'not-seen', reason: 'saved copy has no Version line', main: VERSION });
  assert.deepEqual(card.compareSkill(MAIN, '# no version\n'), { state: 'not-seen', reason: 'main has no Version line' });
  assert.equal(card.cardLine({ state: 'not-seen', reason: null }), 'SKILL CARD NOT SEEN');
  assert.equal(card.cardLine({ state: 'not-seen', reason: 'synced folder unreadable' }), 'SKILL CARD NOT SEEN (synced folder unreadable)');
});

test('the newest saved Version wins, compared date first then the day counter as a number', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-card-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (account, text) => {
    fs.mkdirSync(path.join(dir, account, 'web-controller-projects'), { recursive: true });
    fs.writeFileSync(path.join(dir, account, 'web-controller-projects', 'SKILL.md'), text);
  };
  put('a_old', restamped.replace('2026-01-01.1', '2026-01-01.9').replace('Run Toolkit', 'Ran Toolkit'));
  put('b_new', restamped.replace('2026-01-01.1', '2026-01-01.10'));
  put('c_none', '# no version\n');
  fs.writeFileSync(path.join(dir, 'a-file'), 'not a folder');
  const result = card.skillCard(dir, MAIN);
  assert.equal(result.state, 'current');
  assert.equal(result.saved, '2026-01-01.10');
  assert.deepEqual(result.copies.map(file => path.basename(path.dirname(path.dirname(file)))), ['b_new', 'a_old', 'c_none']);
  assert.equal(card.compareSkillVersions('2026-01-01.10', '2026-01-01.9'), 1);
  assert.equal(card.compareSkillVersions('2026-01-02.1', '2026-01-01.10'), 1);
  assert.equal(card.compareSkillVersions('2026-01-01.01', '2026-01-01.1'), 0);
  assert.deepEqual(card.skillCard(path.join(dir, 'missing'), MAIN), { state: 'not-seen', reason: null });
  assert.equal(card.defaultSyncedDir({ CLAUDE_CONFIG_DIR: path.join(dir, 'cfg') }, dir), path.join(dir, 'cfg', 'skills', 'synced'));
  assert.equal(card.defaultSyncedDir({}, dir), path.join(dir, '.claude', 'skills', 'synced'));
});

// Default deny: text slipped into a saved copy that main does not hold must never read as current
// (no card would be offered), whatever line-break, invisible or quoting shape it takes.
test('hostile text added to a saved copy always reads as outdated', () => {
  const list = hostile.cases(['line-breaks', 'continued-lines', 'quoting', 'invisible', 'free-text', 'large-input']);
  const accepts = text => card.compareSkill(restamped.replace('\n\n', `\n\n${text}\n`), MAIN).state === 'current';
  hostile.expectDefaultDeny(assert, accepts, list);
});
