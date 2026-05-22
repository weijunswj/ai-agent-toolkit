const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(
  repoRoot,
  '_projects',
  'n8n',
  'workflow-toolkit',
  '_main',
  'helper-scripts',
  'workflow-maintenance',
  'delete-archived-n8n-workflows.cjs'
);

const {
  run,
  normalizeApiRoot,
  sanitizeFileName,
} = require(scriptPath);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-delete-archived-test-'));
}

function workflow(overrides = {}) {
  return {
    id: overrides.id || 'wf_archived',
    name: overrides.name || 'Archived Workflow',
    active: false,
    published: false,
    isArchived: true,
    ...overrides,
  };
}

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createHarness(responses) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  const queue = [...responses];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
    if (!queue.length) throw new Error(`Unexpected fetch call: ${options.method || 'GET'} ${url}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, options) : next;
  };

  return {
    calls,
    stdout,
    stderr,
    runWith(options = {}) {
      return run({
        argv: options.argv || [],
        env: {
          N8N_BASE_URL: 'https://example.app.n8n.cloud/api/v1',
          N8N_API_KEY: 'test-api-key',
          ...(options.env || {}),
        },
        cwd: options.cwd || tempDir(),
        fetchImpl,
        now: options.now || new Date('2026-05-22T14:05:00.000Z'),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      });
    },
  };
}

test('normalizeApiRoot supports base instance and api root URLs', () => {
  assert.equal(normalizeApiRoot('https://example.app.n8n.cloud'), 'https://example.app.n8n.cloud/api/v1');
  assert.equal(normalizeApiRoot('https://example.app.n8n.cloud/api/v1'), 'https://example.app.n8n.cloud/api/v1');
  assert.equal(normalizeApiRoot('https://example.app.n8n.cloud/api/v1/'), 'https://example.app.n8n.cloud/api/v1');
});

test('sanitizeFileName makes workflow names safe for backup files', () => {
  assert.equal(sanitizeFileName('Unsafe / Workflow: Name?'), 'Unsafe_Workflow_Name');
  assert.equal(sanitizeFileName(''), 'workflow');
});

test('default dry-run lists archived workflows and does not call DELETE', async () => {
  const cwd = tempDir();
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_1', name: 'Old Draft' })] }),
  ]);

  const result = await harness.runWith({ cwd });

  assert.equal(result.exitCode, 0);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].method, 'GET');
  assert.equal(harness.calls.some((call) => call.method === 'DELETE'), false);
  assert.equal(fs.existsSync(path.join(cwd, '.n8n-workflow-backups')), false);
  assert.match(harness.stdout.join('\n'), /Mode\s+: dry-run/);
  assert.match(harness.stdout.join('\n'), /Old Draft/);
  assert.match(harness.stdout.join('\n'), /DRY RUN: no workflows deleted/);
});

test('missing env vars exits safely before fetching', async () => {
  const harness = createHarness([]);

  const result = await harness.runWith({ env: { N8N_BASE_URL: '', N8N_API_KEY: '' } });

  assert.equal(result.exitCode, 1);
  assert.equal(harness.calls.length, 0);
  assert.match(harness.stderr.join('\n'), /N8N_BASE_URL/);
  assert.match(harness.stderr.join('\n'), /N8N_API_KEY/);
});

test('--delete without exact confirm exits safely before fetching', async () => {
  const harness = createHarness([]);

  const result = await harness.runWith({ argv: ['--delete'] });

  assert.equal(result.exitCode, 1);
  assert.equal(harness.calls.length, 0);
  assert.match(harness.stderr.join('\n'), /--confirm "DELETE ARCHIVED WORKFLOWS"/);
});

test('exact confirm without --delete exits safely before fetching', async () => {
  const harness = createHarness([]);

  const result = await harness.runWith({ argv: ['--confirm', 'DELETE ARCHIVED WORKFLOWS'] });

  assert.equal(result.exitCode, 1);
  assert.equal(harness.calls.length, 0);
  assert.match(harness.stderr.join('\n'), /requires --delete/);
});

test('pagination follows nextCursor until all pages are fetched', async () => {
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_1', name: 'First' })], nextCursor: 'abc123' }),
    createJsonResponse({ data: [workflow({ id: 'wf_2', name: 'Second' })] }),
  ]);

  const result = await harness.runWith();

  assert.equal(result.exitCode, 0);
  assert.equal(harness.calls.length, 2);
  assert.match(harness.calls[0].url, /limit=250/);
  assert.doesNotMatch(harness.calls[0].url, /cursor=/);
  assert.match(harness.calls[1].url, /limit=250/);
  assert.match(harness.calls[1].url, /cursor=abc123/);
  assert.match(harness.stdout.join('\n'), /Total workflows fetched\s+: 2/);
});

test('unclear archive field prints sample and stops safely', async () => {
  const harness = createHarness([
    createJsonResponse({ data: [{ id: 'wf_unclear', name: 'Unclear', active: false }] }),
  ]);

  const result = await harness.runWith({ argv: ['--delete', '--confirm', 'DELETE ARCHIVED WORKFLOWS'] });

  assert.equal(result.exitCode, 1);
  assert.equal(harness.calls.some((call) => call.method === 'DELETE'), false);
  assert.match(harness.stdout.join('\n'), /Sample workflow object/);
  assert.match(harness.stderr.join('\n'), /Archive detection is unclear/);
});

test('archived inactive unpublished workflows are selected', async () => {
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_ok', name: 'Archived Safe', active: false, published: false })] }),
  ]);

  const result = await harness.runWith();

  assert.equal(result.exitCode, 0);
  assert.match(harness.stdout.join('\n'), /Archived Safe/);
  assert.match(harness.stdout.join('\n'), /Archived candidates\s+: 1/);
});

test('active workflows are skipped even if archived', async () => {
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_active', name: 'Active Archived', active: true })] }),
  ]);

  const result = await harness.runWith();

  assert.equal(result.exitCode, 0);
  assert.match(harness.stdout.join('\n'), /Archived candidates\s+: 0/);
  assert.doesNotMatch(harness.stdout.join('\n'), /Active Archived\s+\|/);
});

test('published workflows are skipped even if archived', async () => {
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_published', name: 'Published Archived', published: true })] }),
  ]);

  const result = await harness.runWith();

  assert.equal(result.exitCode, 0);
  assert.match(harness.stdout.join('\n'), /Archived candidates\s+: 0/);
  assert.doesNotMatch(harness.stdout.join('\n'), /Published Archived\s+\|/);
});

test('backup happens before delete in destructive mode', async () => {
  const cwd = tempDir();
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_delete', name: 'Delete Me', archived: true })] }),
    createJsonResponse({ id: 'wf_delete', name: 'Delete Me', active: false, published: false, archived: true, nodes: [] }),
    createJsonResponse({ success: true }),
  ]);

  const result = await harness.runWith({
    cwd,
    argv: ['--delete', '--confirm', 'DELETE ARCHIVED WORKFLOWS'],
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(harness.calls.map((call) => call.method), ['GET', 'GET', 'DELETE']);
  const backupFile = path.join(cwd, '.n8n-workflow-backups', '2026-05-22_1405_Delete_Me_before-delete.json');
  assert.equal(fs.existsSync(backupFile), true);
  assert.equal(JSON.parse(fs.readFileSync(backupFile, 'utf8')).id, 'wf_delete');
});

test('individual delete failure is counted and does not stop the whole run', async () => {
  const cwd = tempDir();
  const harness = createHarness([
    createJsonResponse({
      data: [
        workflow({ id: 'wf_fail', name: 'Delete Fails', archive: true }),
        workflow({ id: 'wf_ok', name: 'Delete Succeeds', archive: true }),
      ],
    }),
    createJsonResponse({ id: 'wf_fail', name: 'Delete Fails', active: false, published: false, archive: true }),
    createJsonResponse({ error: 'delete failed' }, 500),
    createJsonResponse({ id: 'wf_ok', name: 'Delete Succeeds', active: false, published: false, archive: true }),
    createJsonResponse({ success: true }),
  ]);

  const result = await harness.runWith({
    cwd,
    argv: ['--delete', '--confirm', 'DELETE ARCHIVED WORKFLOWS'],
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(harness.calls.map((call) => call.method), ['GET', 'GET', 'DELETE', 'GET', 'DELETE']);
  assert.match(harness.stdout.join('\n'), /Found\s+: 2/);
  assert.match(harness.stdout.join('\n'), /Backed up\s+: 2/);
  assert.match(harness.stdout.join('\n'), /Deleted\s+: 1/);
  assert.match(harness.stdout.join('\n'), /Failed\s+: 1/);
  assert.match(harness.stdout.join('\n'), /wf_fail.*Delete Fails/);
});

test('API key is never printed', async () => {
  const harness = createHarness([
    createJsonResponse({ data: [workflow({ id: 'wf_1', name: 'Old Draft' })] }),
  ]);

  await harness.runWith({ env: { N8N_API_KEY: 'super-secret-key' } });

  assert.doesNotMatch(`${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`, /super-secret-key/);
  assert.equal(harness.calls[0].headers['X-N8N-API-KEY'], 'super-secret-key');
});
