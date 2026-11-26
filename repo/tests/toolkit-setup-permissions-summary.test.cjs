'use strict';

// setup toolkit says the governance bank's permissions row the same way, with no new question:
// Toolkit's lines, the other lines to review, and the owner's one command when Toolkit's lines are
// out of date.
const assert = require('node:assert/strict');
const test = require('node:test');
const { permissionsSummaryLines } = require('../scripts/setup-toolkit-core.cjs');

const UPDATE = 'node "/opt/toolkit/repo/scripts/toolkit-permissions.cjs" --apply --host claude';

test('setup shows Toolkit lines, other lines and the one command, and asks nothing', () => {
  const seen = [];
  const check = found => app => { seen.push(app); return { checked: true, update: UPDATE, ...found }; };
  assert.deepEqual(permissionsSummaryLines('claude-code', check({ missing: 2, stale: 1, other: 45 })), ['## Toolkit permissions',
    'Toolkit permissions (Claude Code): Toolkit lines: 2 missing, 1 old. Other lines: 45 to review.',
    `To bring Toolkit's lines up to date, run this once in your own PowerShell or terminal (it shows the changes, backs up and waits for your Enter): ${UPDATE}`,
    'Say review permissions to see the other lines; nothing changes unless you pick lines.', '']);
  assert.deepEqual(permissionsSummaryLines('claude-code', check({ missing: 0, stale: 0, other: 0 })), ['## Toolkit permissions', 'Toolkit permissions (Claude Code): Toolkit lines: up to date.', '']);
  assert.deepEqual(permissionsSummaryLines('codex', check({ missing: 0, stale: 2 })).slice(1, 2), ['Toolkit permissions (Codex): Toolkit lines: 2 old.']);
  assert.deepEqual(seen, ['claude', 'claude', 'codex']);
  assert.deepEqual(permissionsSummaryLines('claude-code', () => { throw new Error('unreadable'); }), ['## Toolkit permissions', 'Toolkit permissions (Claude Code): not checked; say toolkit permissions to see them.', '']);
});
