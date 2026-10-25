'use strict';

// Standing permission asks: the always-loaded rule, both safety-gates playbooks and the Projects skill
// agree, and the sample ledger uses the documented fields with fake data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PLAYBOOKS = ['repo/docs/agent-playbooks/safety-gates.md', 'skills/repository-agent-rules/repo-local/docs/agent-playbooks/safety-gates.md'];
const FIELDS = ['id', 'granted_at', 'decision', 'answer_ref', 'machine', 'scope', 'project', 'target', 'action',
  'checks_first', 'told_after', 'not_covered', 'native_rule', 'review_by', 'status'];
const DAY_MS = 24 * 60 * 60 * 1000;

function section(text) {
  const start = text.indexOf('## Standing Permission Asks\n');
  assert.ok(start >= 0, 'section present');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end);
}

test('the global rule names the three options, the ledger, the hard-stop limit and the playbook', () => {
  const rules = read('repo/contracts/agent-rules/global-rules.md');
  assert.match(rules, /\*\*Standing permission asks:\*\* when a step stops on the owner, check the standing-permission ledger/);
  assert.match(rules, /just this once, from now on for this exact scope, or no/);
  assert.match(rules, /Never offer a hard stop or the safety floor; explain it\./);
  assert.match(rules, /`repo\/docs\/agent-playbooks\/safety-gates\.md`/);
});

test('both safety-gates playbooks carry the same procedure', () => {
  const [toolkit, portable] = PLAYBOOKS.map(rel => section(read(rel)));
  assert.equal(portable, toolkit);
  for (const text of [
    '`standing-permissions/ledger.json`', 'review_by` (90 days after `granted_at`)', '`all-projects`',
    'never as the default', 'Agents never write their own permission settings.',
    'never makes a hard stop clearable', 'not tool output', 'Never retry another way',
    'each merge stays its own OK', 'A recorded "no" also counts',
    'works the same in every harness', '**Codex:** `prefix_rule()`', '**Any other harness:**',
  ]) assert.ok(toolkit.includes(text), text);
  for (const field of FIELDS) assert.ok(toolkit.includes(`\`${field}\``), field);
});

test('the Projects skill uses a decision card and the same ledger', () => {
  // The project instructions block has no room left; threads get the rule from the global rules.
  const skill = read('repo/contracts/claude-projects/web-controller-projects/SKILL.md');
  assert.ok(skill.includes('`standing-permissions/ledger.json` in the transport store'));
  assert.ok(skill.includes('just this once, from now on for this exact scope, or no'));
  assert.match(skill, /posts one decision card/);
  assert.match(skill, /90-day review date/);
  assert.match(skill, /never retry another way/);
});

test('the sample ledger uses exactly the documented fields, fake data and a 90-day review', () => {
  const ledger = JSON.parse(read('repo/tests/fixtures/standing-permissions/ledger.json'));
  assert.ok(ledger.entries.length >= 2);
  for (const entry of ledger.entries) {
    assert.deepEqual(Object.keys(entry), FIELDS);
    assert.ok(['standing', 'once', 'no'].includes(entry.decision));
    assert.ok(['project', 'all-projects'].includes(entry.scope));
    assert.ok(['active', 'revoked', 'expired'].includes(entry.status));
    assert.equal((Date.parse(entry.review_by) - Date.parse(entry.granted_at)) / DAY_MS, 90);
    assert.equal(entry.scope === 'all-projects', entry.project === '');
    assert.match(`${entry.machine} ${entry.project} ${entry.target}`, /example/);
  }
});
