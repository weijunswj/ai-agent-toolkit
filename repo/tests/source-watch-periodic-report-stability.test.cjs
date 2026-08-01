'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  advisoryFindings,
  renderAdvisorySection
} = require('../scripts/source-watch-advisory-targets.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function workspaceWithOverdueTarget() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'source-watch-stability-'));
  writeJson(path.join(workspace, 'repo/source-watch/advisory-targets.json'), {
    schema_version: 1,
    policy: {},
    targets: [
      {
        id: 'periodic-review',
        name: 'Periodic Review',
        kind: 'manual',
        enabled: true,
        state: 'watching',
        review_cadence_days: 90,
        last_reviewed_at: '2026-01-01',
        review_template: 'repo/source-watch/templates/review.md',
        evidence_sources: ['Example source'],
        toolkit_scope: ['skills/**'],
        classification_options: ['Keep'],
        recommendation: 'Review on cadence.',
        action_taken: 'None.',
        remaining_work: 'Review.',
        removal_condition: 'Remove when obsolete.'
      }
    ]
  });
  return workspace;
}

test('overdue periodic review output is stable across consecutive UTC days', async () => {
  const workspace = workspaceWithOverdueTarget();
  const first = await advisoryFindings(
    { workspace },
    { SOURCE_WATCH_TODAY: '2026-07-05' }
  );
  const second = await advisoryFindings(
    { workspace },
    { SOURCE_WATCH_TODAY: '2026-07-06' }
  );

  assert.equal(first.findings.length, 1);
  assert.equal(second.findings.length, 1);
  assert.notEqual(first.findings[0].elapsed_days, second.findings[0].elapsed_days);

  const firstRendered = renderAdvisorySection(first.findings);
  const secondRendered = renderAdvisorySection(second.findings);
  assert.deepEqual(firstRendered, secondRendered);

  const markdown = firstRendered.join('\n');
  assert.doesNotMatch(markdown, /- Today:/);
  assert.doesNotMatch(markdown, /\d+ day\(s\) since last_reviewed_at/);
  assert.match(markdown, /Review cadence has elapsed since last_reviewed_at\./);
});
