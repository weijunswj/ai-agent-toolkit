'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { checkReferences, main } = require('../scripts/check-script-references.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

function fixture(t, { registry, files }) {
  const tempRoot = path.join(ROOT, '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'script-refs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('repo/contracts/retired-scripts.json', JSON.stringify(registry));
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  return root;
}
const REGISTRY = { schema: 'toolkit-retired-scripts/v1', scripts: [{ path: 'repo/scripts/old.cjs', reason: 'Retired feature.', allowed_in: ['repo/ARCHITECTURE.md'] }] };

test('permission rows and documents naming a retired or missing script are flagged; allowed files and history are not', t => {
  const root = fixture(t, { registry: REGISTRY, files: {
    'repo/scripts/old.cjs': '', 'repo/scripts/live.cjs': '', 'skills/a/scripts/tool.cjs': '',
    'repo/ARCHITECTURE.md': '| Retired | `repo/scripts/old.cjs` |\n',
    'repo/docs/guide.md': 'Run `repo/scripts/live.cjs`.\nThen `repo/scripts/old.cjs` and `skills/a/scripts/gone.cjs`.\n',
    'repo/docs/CHANGELOG.md': 'Removed `repo/scripts/never.cjs`; retired `repo/scripts/old.cjs`.\n',
    'repo/docs/changelog.d/x.md': '- `repo/scripts/old.cjs`\n',
    'skills/a/SKILL.md': 'Uses `skills/a/scripts/tool.cjs`.\n',
    '.tmp/scratch.md': '`repo/scripts/never.cjs`\n',
  } });
  const rows = [
    { id: 'old-plan', script: 'repo/scripts/old.cjs' },
    { id: 'live', script: 'repo/scripts/live.cjs' },
    { id: 'gone', script: 'repo/scripts/gone.cjs' },
    { id: 'gh-comment', command: 'gh pr comment' },
  ];
  assert.deepEqual(checkReferences(root, { rows }), [
    'RETIRED permission row old-plan runs repo/scripts/old.cjs',
    'MISSING permission row gone runs repo/scripts/gone.cjs',
    'RETIRED repo/docs/guide.md:2 names repo/scripts/old.cjs',
    'MISSING repo/docs/guide.md:2 names skills/a/scripts/gone.cjs',
  ]);
});

test('the CLI prints one clear line, or the findings, with exit codes', t => {
  const clean = fixture(t, { registry: REGISTRY, files: { 'repo/scripts/live.cjs': '', 'README.md': '`repo/scripts/live.cjs`\n' } });
  let text = '';
  assert.equal(main(['--root', clean], { rows: [], stdout: chunk => { text += chunk; } }), 0);
  assert.equal(text, 'SCRIPT REFERENCES: clear\n');
  text = '';
  assert.equal(main(['--root', clean], { rows: [{ id: 'x', script: 'repo/scripts/old.cjs' }], stdout: chunk => { text += chunk; } }), 1);
  assert.equal(text, 'SCRIPT REFERENCES: 1 found\nRETIRED permission row x runs repo/scripts/old.cjs\n');
  const bad = fixture(t, { registry: { schema: 'toolkit-retired-scripts/v1', scripts: [{ path: 'repo/scripts/old.cjs', allowed_in: [] }] }, files: {} });
  let err = '';
  assert.equal(main(['--root', bad], { rows: [], stderr: chunk => { err += chunk; } }), 2);
  assert.match(err, /every entry needs path, reason and allowed_in/);
  assert.equal(main(['--what'], { stderr: () => {} }), 2);
});

test('every registered retired script exists, so the registry names real leftovers', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/retired-scripts.json'), 'utf8'));
  for (const entry of registry.scripts) assert.ok(fs.existsSync(path.join(ROOT, entry.path)), entry.path);
});
