#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {
  isActiveThirdPartyAttributionLock,
  isRetiredMigrationLock
} = require('./audit-project-source-locks.cjs');
const {
  advisoryFindings,
  defaultAdvisoryDocPath,
  renderAdvisorySection,
  sanitizeGeneratedMarkdown
} = require('./source-watch-advisory-targets.cjs');
const {
  defaultReviewStatePath,
  findMatchingReviewRecord,
  readReviewState,
  sourceLockIdentity
} = require('./source-watch-review-state.cjs');

const defaultReportPath = 'repo/source-watch/reviews/active-third-party-updates.md';
const githubApiBaseUrl = 'https://api.github.com';

const MAX_OWNED_REPORT_BYTES = 65536;
const MAX_OWNED_REPORT_FRAME_BYTES = MAX_OWNED_REPORT_BYTES * 6 + 1024;
const OWNED_REPORT_CONTROL_MAX_BYTES = 1024;
const OWNED_REPORT_ACK_MAX_PAYLOAD_BYTES = 1024;
const OWNED_REPORT_MODE = 'source-update-v1';
const OWNED_REPORT_TOKEN_PATTERN = /^[a-f0-9]{48}$/;
function reportFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeOwnedFrame(frame, maxFrameBytes, maxPayloadBytes, label) {
  if (!Buffer.isBuffer(frame) || frame.length < 5 || frame.length > maxFrameBytes) {
    throw new Error((label || 'Owned IPC message') + ' is missing or oversized.');
  }
  const payloadLength = frame.readUInt32BE(0);
  if (payloadLength < 1 || payloadLength > maxPayloadBytes || payloadLength !== frame.length - 4) {
    throw new Error((label || 'Owned IPC message') + ' must contain exactly one complete frame.');
  }
  const payload = frame.subarray(4);
  const json = payload.toString('utf8');
  if (!Buffer.from(json, 'utf8').equals(payload)) throw new Error((label || 'Owned IPC message') + ' is not valid UTF-8.');
  let message;
  try { message = JSON.parse(json); }
  catch (_) { throw new Error((label || 'Owned IPC message') + ' is malformed JSON.'); }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error((label || 'Owned IPC message') + ' must be an object.');
  }
  return message;
}

function assertOwnedEnvelope(message, expectedToken, expectedKeys, label) {
  if (typeof expectedToken !== 'string' || !OWNED_REPORT_TOKEN_PATTERN.test(expectedToken)) {
    throw new Error('Owned report token is invalid.');
  }
  const keys = Object.keys(message).sort().join(',');
  if (keys !== expectedKeys || message.version !== 1 || message.token !== expectedToken) {
    throw new Error((label || 'Owned IPC message') + ' has an unsupported shape, version, or token.');
  }
}

function parseAdmissionControlFrame(frame, expectedToken) {
  const message = decodeOwnedFrame(frame, OWNED_REPORT_CONTROL_MAX_BYTES,
    OWNED_REPORT_CONTROL_MAX_BYTES - 4, 'Owned report admission message');
  assertOwnedEnvelope(message, expectedToken, 'token,type,version', 'Owned report admission message');
  if (!['BROKER_HELLO', 'BROKER_READY', 'BROKER_READY_ACK'].includes(message.type)) {
    throw new Error('Owned report admission message has an unexpected phase.');
  }
  return message;
}

function parseOwnedReportAckFrame(frame, expectedToken) {
  const message = decodeOwnedFrame(frame, OWNED_REPORT_ACK_MAX_PAYLOAD_BYTES + 4,
    OWNED_REPORT_ACK_MAX_PAYLOAD_BYTES, 'Owned report acknowledgement');
  assertOwnedEnvelope(message, expectedToken, 'acknowledged,token,version', 'Owned report acknowledgement');
  if (typeof message.acknowledged !== 'boolean') throw new Error('Owned report acknowledgement is malformed.');
  return message;
}

function parseOwnedReportFrame(frame, expectedToken) {
  const request = decodeOwnedFrame(frame, MAX_OWNED_REPORT_FRAME_BYTES,
    MAX_OWNED_REPORT_FRAME_BYTES - 4, 'Owned report request');
  const keys = Object.keys(request).sort().join(',');
  if ((keys !== 'token,type,version' && keys !== 'content,token,type,version')
      || request.version !== 1 || request.token !== expectedToken
      || typeof expectedToken !== 'string' || !OWNED_REPORT_TOKEN_PATTERN.test(expectedToken)
      || !['PUT_REPORT', 'REMOVE_REPORT'].includes(request.type)) {
    throw new Error('Owned report request has an unsupported shape or destination.');
  }
  if (request.type === 'PUT_REPORT') {
    if (typeof request.content !== 'string'
        || Buffer.byteLength(request.content, 'utf8') > MAX_OWNED_REPORT_BYTES) {
      throw new Error('Owned report exceeds the reserved 65,536-byte payload.');
    }
    return { type: 'PUT_REPORT', content: request.content };
  }
  if (Object.hasOwn(request, 'content')) throw new Error('REMOVE_REPORT cannot carry content.');
  return { type: 'REMOVE_REPORT' };
}

async function mediateOwnedReportFrame(frame, token, commit) {
  if (typeof commit !== 'function') throw new Error('Owned report commit authority is missing.');
  const request = parseOwnedReportFrame(frame, token);
  await commit(request);
  return request.type;
}

function ownedReportRequestFrame(request, token) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Owned report request is invalid.');
  const normalized = request.type === 'PUT_REPORT'
    ? { version: 1, token, type: request.type, content: request.content }
    : request.type === 'REMOVE_REPORT'
      ? { version: 1, token, type: request.type }
      : null;
  if (!normalized) throw new Error('Owned report request type is invalid.');
  const frame = reportFrame(normalized);
  parseOwnedReportFrame(frame, token);
  return frame;
}

function hasOwnedReportIpc(ipc = process, env = process.env) {
  return Boolean(env && env.TOOLKIT_OWNED_TEMP_MODE === OWNED_REPORT_MODE
    && typeof env.TOOLKIT_OWNED_TEMP_REPORT_TOKEN === 'string'
    && OWNED_REPORT_TOKEN_PATTERN.test(env.TOOLKIT_OWNED_TEMP_REPORT_TOKEN)
    && ipc && ipc.channel && ipc.connected === true && typeof ipc.send === 'function');
}

function ownedIpcError(message, cause, code = 'TEMP_CHILD_PROTOCOL') {
  const failure = new Error(message);
  failure.code = code;
  if (cause !== undefined) failure.cause = cause;
  return failure;
}

function sendMessageFrame(frame, ipc, label) {
  if (!Buffer.isBuffer(frame)) throw ownedIpcError((label || 'Owned report IPC message') + ' is invalid.');
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (caught) => {
      if (settled) return;
      settled = true;
      if (caught) reject(ownedIpcError((label || 'Owned report IPC send') + ' failed.', caught));
      else resolve();
    };
    try { ipc.send(frame, done); }
    catch (caught) { done(caught); }
  });
}

function createOwnedReportIpcClient(ipc = process, env = process.env) {
  if (!env || env.TOOLKIT_OWNED_TEMP_MODE !== OWNED_REPORT_MODE) throw ownedIpcError('Owned report mode is missing or unsupported.');
  const token = env.TOOLKIT_OWNED_TEMP_REPORT_TOKEN;
  if (typeof token !== 'string' || !OWNED_REPORT_TOKEN_PATTERN.test(token)) throw ownedIpcError('Owned report token is invalid.');
  if (!ipc || !ipc.channel || ipc.connected !== true || typeof ipc.send !== 'function'
      || typeof ipc.on !== 'function' || typeof ipc.removeListener !== 'function') {
    throw ownedIpcError('Owned report broker IPC channel is missing or unusable.');
  }

  let phase = 'ADMITTING';
  let failure = null;
  let disposed = false;
  let terminalSent = false;
  let helloSent = false;
  let readyAckSent = false;
  let resolveAdmission;
  let rejectAdmission;
  let resolveRequest;
  let rejectRequest;
  let watchdog;
  const admission = new Promise((resolve, reject) => { resolveAdmission = resolve; rejectAdmission = reject; });
  const latch = (caught) => {
    if (failure) return failure;
    failure = caught instanceof Error ? caught : ownedIpcError('Owned report IPC transport failed.', caught);
    if (phase !== 'ADMITTED' && phase !== 'REQUEST_SENT' && phase !== 'ACK_RECEIVED') rejectAdmission(failure);
    if (rejectRequest) rejectRequest(failure);
    return failure;
  };
  const sendControl = (value, label) => {
    const frame = reportFrame(value);
    if (frame.length > OWNED_REPORT_CONTROL_MAX_BYTES) return Promise.reject(ownedIpcError('Owned report admission message is oversized.'));
    return sendMessageFrame(frame, ipc, label);
  };
  const maybeAdmit = () => {
    if (failure || !helloSent || !readyAckSent) return;
    phase = 'ADMITTED';
    if (watchdog) clearTimeout(watchdog);
    resolveAdmission();
  };
  const onMessage = (message, handle) => {
    if (failure || disposed) return;
    if (handle !== undefined && handle !== null) {
      latch(ownedIpcError('Owned report IPC message transferred an unexpected handle.'));
      return;
    }
    if (phase === 'ADMITTING') {
      let control;
      try { control = parseAdmissionControlFrame(message, token); }
      catch (caught) { latch(ownedIpcError('Owned report broker admission failed.', caught)); return; }
      if (control.type !== 'BROKER_READY') {
        latch(ownedIpcError('Owned report broker sent an unexpected admission phase.'));
        return;
      }
      phase = 'READY_RECEIVED';
      void sendControl({ version: 1, token, type: 'BROKER_READY_ACK' }, 'Owned report READY_ACK').then(() => {
        if (failure || disposed) return;
        readyAckSent = true;
        maybeAdmit();
      }, (caught) => { latch(caught); });
      return;
    }
    if (phase === 'REQUEST_SENT' && rejectRequest) {
      let acknowledgement;
      try { acknowledgement = parseOwnedReportAckFrame(message, token); }
      catch (caught) { latch(ownedIpcError('Owned report acknowledgement is invalid.', caught)); return; }
      if (acknowledgement.acknowledged !== true) {
        latch(ownedIpcError('Owned report request was rejected by the parent.'));
        return;
      }
      phase = 'ACK_RECEIVED';
      const resolve = resolveRequest;
      resolveRequest = null;
      rejectRequest = null;
      resolve(true);
      return;
    }
    latch(ownedIpcError('Owned report IPC message arrived in an unexpected phase.'));
  };
  const onError = (caught) => { latch(ownedIpcError('Owned report IPC channel failed.', caught)); };
  const onDisconnect = () => { latch(ownedIpcError('Owned report IPC channel disconnected.')); };

  ipc.on('message', onMessage);
  ipc.on('error', onError);
  ipc.on('disconnect', onDisconnect);
  watchdog = setTimeout(() => latch(ownedIpcError('Owned report broker admission timed out.', undefined, 'TEMP_CHILD_ADMISSION_TIMEOUT')), 5000);
  void sendControl({ version: 1, token, type: 'BROKER_HELLO' }, 'Owned report BROKER_HELLO').then(() => {
    helloSent = true;
    maybeAdmit();
  }, (caught) => { latch(caught); });

  return {
    token,
    admit() { return admission; },
    async send(request) {
      if (failure) throw failure;
      if (phase !== 'ADMITTED' || terminalSent) throw ownedIpcError('Owned report terminal request is unavailable or already consumed.');
      const frame = ownedReportRequestFrame(request, token);
      terminalSent = true;
      phase = 'REQUEST_SENT';
      const acknowledgement = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
      const sent = sendMessageFrame(frame, ipc, 'Owned report request');
      try {
        await Promise.all([sent, acknowledgement]);
        return request.type;
      } catch (caught) {
        throw latch(caught);
      }
    },
    get phase() { return phase; },
    get failure() { return failure; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (watchdog) clearTimeout(watchdog);
      ipc.removeListener('message', onMessage);
      ipc.removeListener('error', onError);
      ipc.removeListener('disconnect', onDisconnect);
    }
  };
}
function slash(value) {
  return value.split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    report: defaultReportPath,
    advisoryDoc: defaultAdvisoryDocPath,
    reviewState: defaultReviewStatePath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') args.workspace = argv[++index] || args.workspace;
    else if (arg === '--report') args.report = argv[++index] || args.report;
    else if (arg === '--advisory-doc') args.advisoryDoc = argv[++index] || args.advisoryDoc;
    else if (arg === '--review-state') args.reviewState = argv[++index] || args.reviewState;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.workspace = path.resolve(args.workspace);
  return args;
}

function usage() {
  return [
    'Usage: node repo/scripts/check-project-source-updates.cjs [--workspace <dir>] [--report <path>] [--advisory-doc <path>] [--review-state <path>]',
    '',
    'Checks active third-party SOURCE-LOCK.json entries and actionable advisory targets against GitHub.',
    'When review is needed, writes a review-notification report only. It never copies upstream files, updates SOURCE-LOCK.json or advisory target documents, or changes toolkit components.'
  ].join('\n');
}

function walk(dir, entries = []) {
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === '__pycache__' || item.name === 'node_modules') continue;
    const fullPath = path.join(dir, item.name);
    entries.push({ fullPath, dirent: item });
    if (item.isDirectory()) walk(fullPath, entries);
  }
  return entries;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function discoverSourceLocks(workspace) {
  const provenanceDir = path.join(workspace, 'repo', 'source-watch', 'provenance');
  return walk(provenanceDir)
    .filter((entry) => entry.dirent.isFile() && entry.fullPath.endsWith(`${path.sep}SOURCE-LOCK.json`))
    .map((entry) => ({
      relPath: slash(path.relative(workspace, entry.fullPath)),
      fullPath: entry.fullPath,
      lock: readJson(entry.fullPath)
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function isActiveThirdPartyLock(lock) {
  return isActiveThirdPartyAttributionLock(lock);
}

function activeThirdPartyLocks(lockFiles) {
  return lockFiles.filter((lockFile) => {
    if (isActiveThirdPartyAttributionLock(lockFile.lock)) return true;
    if (isRetiredMigrationLock(lockFile.lock)) return false;
    throw new Error(`Unsupported SOURCE-LOCK lifecycle metadata: ${lockFile.relPath}`);
  });
}

function parseGitHubRepo(sourceRepo) {
  if (typeof sourceRepo !== 'string' || !sourceRepo.trim()) {
    throw new Error('source_repo must be a non-empty GitHub owner/repo value');
  }
  let value = sourceRepo.trim();
  value = value.replace(/^https:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '');
  value = value.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Unsupported GitHub source_repo: ${sourceRepo}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function requestJson(url, headers = {}) {
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-agent-toolkit-source-watch',
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub API request failed (${response.statusCode}): ${body.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`GitHub API returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function latestCommitForLock(lock, env = process.env) {
  const { owner, repo } = parseGitHubRepo(lock.source_repo);
  const apiBase = (env.SOURCE_WATCH_GITHUB_API_BASE_URL || env.GITHUB_API_URL || githubApiBaseUrl).replace(/\/+$/, '');
  const url = new URL(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(lock.source_ref)}`);
  const headers = {};
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await requestJson(url, headers);
  if (!response || typeof response.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(response.sha)) {
    throw new Error(`GitHub API response for ${lock.source_repo}@${lock.source_ref} did not include a full commit SHA`);
  }
  return response.sha;
}

function sourceLockPathFromLock(lockFile) {
  return lockFile.relPath.replace(/\/SOURCE-LOCK\.json$/, '');
}

function trackedFileLine(file) {
  const target = file.project_path || file.root_surface_path || '(excluded)';
  const blob = file.source_blob_sha ? ` @ ${file.source_blob_sha}` : '';
  const notes = file.notes ? ` - ${file.notes}` : '';
  return `- \`${file.mode || 'exact'}\` \`${file.source_path || '(missing source_path)'}\` -> \`${target}\`${blob}${notes}`;
}

function renderSourceUpdatesSection(updates) {
  if (updates.length === 0) {
    return [
      '## Active Third-Party Updates',
      '',
      'No active third-party source updates were detected.',
      ''
    ];
  }
  return [
    '## Active Third-Party Updates',
    '',
    ...updates.flatMap((update) => [
       `### ${update.source_lock_path}`,
      '',
      `- Source repo: \`${update.source_repo}\``,
      `- Source ref: \`${update.source_ref}\``,
      `- Adopted commit: \`${update.adopted_commit}\``,
      `- Reviewed-through commit: \`${update.reviewed_through_commit || '(none; adopted commit used)'}\``,
      `- Latest observed commit: \`${update.latest_commit}\``,
      `- Why a new review is required: ${update.review_reason}`,
      ...(update.review_disposition ? [`- Prior disposition: \`${update.review_disposition}\``] : []),
      ...(update.review_tracker ? [`- Owning tracker: \`${update.review_tracker}\``] : []),
      `- Update policy: \`${update.update_policy}\``,
      `- Public attribution required: \`${update.public_attribution_required}\``,
      '',
      'Tracked files:',
      ...update.tracked_files.map(trackedFileLine),
      ''
    ])
  ];
}

function renderReviewReport({ updates, advisoryUpdates, advisoryDocPath }) {
  const notificationText = [
    'This PR is a review notification only.',
    'No source files or advisory tracking documents were updated.',
    'No review-state cursors were changed.',
    'No SOURCE-LOCK pins or advisory baselines were changed.',
    'No SOURCE-LOCK pins were changed.',
    'No toolkit rules, skills, hooks, repo-map guidance, or cleanup guidance were modified or deleted.',
    'No upstream code was executed.',
    'No auto-merge is allowed.',
    'A human must review upstream changes, attribution/licence impact, allowlist scope, advisory recommendations, and host-harness drift evidence, then ask an AI agent to inspect before any real edits happen.'
  ];
  const checklist = [
    '- [ ] Review upstream diff manually.',
    '- [ ] Confirm changed files are within allowlist.',
    '- [ ] Confirm attribution/licence notes still apply.',
    '- [ ] Confirm no upstream code was executed.',
    '- [ ] Decide whether a separate update PR should copy/adapt files.',
    '- [ ] For Host Harness Capability Drift Review, classify affected toolkit components using the linked template before proposing changes.',
    '- [ ] Confirm any shrink, move, host-native, or delete recommendation is implemented only in a separate evidence-backed PR.',
    '- [ ] If advisory action is taken, update the advisory document in a separate human-reviewed PR.',
    '- [ ] Run npm run validate:all before any real source update merge.'
  ];

  return sanitizeGeneratedMarkdown([
    '# Active Source Watch Review',
    '',
    'PR needed: yes',
    '',
    ...notificationText,
    '',
    `Advisory actions, when present, are read from \`${advisoryDocPath}\`.`,
    'No advisory tracking document was changed by this workflow.',
    'If advisory action is taken, update the advisory document in a separate human-reviewed PR.',
    'If meaningful host-harness drift is found, open a separate PR with evidence, rationale, exact proposed modifications, and validation.',
    '',
    '## Manual Review Checklist',
    '',
    ...checklist,
    '',
    ...renderSourceUpdatesSection(updates),
    ...renderAdvisorySection(advisoryUpdates, advisoryDocPath)
  ].join('\n'));
}

function resolveReportPath(workspace, reportPath) {
  return path.isAbsolute(reportPath) ? reportPath : path.resolve(workspace, reportPath);
}

function writeReport(workspace, reportPath, markdown) {
  const outPath = resolveReportPath(workspace, reportPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return outPath;
}

function removeReportIfPresent(workspace, reportPath) {
  const outPath = resolveReportPath(workspace, reportPath);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
}

async function checkProjectSourceUpdates({
  workspace,
  report,
  advisoryDoc = defaultAdvisoryDocPath,
  reviewState = defaultReviewStatePath
}, env = process.env, reportTransport = null) {
  if (env.TOOLKIT_OWNED_TEMP_MODE !== undefined
      && (env.TOOLKIT_OWNED_TEMP_MODE !== OWNED_REPORT_MODE || !reportTransport)) {
    throw new Error('Owned report mode requires its parent broker transport.');
  }
  const locks = discoverSourceLocks(workspace);
  const activeLocks = activeThirdPartyLocks(locks);
  const reviewStateDocument = readReviewState(workspace, reviewState);

  const updates = [];
  for (const lockFile of activeLocks) {
    const lock = lockFile.lock;
    const latestCommit = await latestCommitForLock(lock, env);
    const reviewRecord = findMatchingReviewRecord(reviewStateDocument, sourceLockIdentity(lockFile));
    const comparisonCommit = reviewRecord ? reviewRecord.reviewed_through_sha : lock.source_commit;
    if (latestCommit.toLowerCase() === String(comparisonCommit || '').toLowerCase()) continue;
    updates.push({
       source_lock_path: sourceLockPathFromLock(lockFile),
      source_repo: lock.source_repo,
      source_ref: lock.source_ref,
      adopted_commit: lock.source_commit,
      locked_commit: lock.source_commit,
      reviewed_through_commit: reviewRecord ? reviewRecord.reviewed_through_sha : null,
      latest_commit: latestCommit,
      review_disposition: reviewRecord ? reviewRecord.disposition : null,
      review_tracker: reviewRecord ? reviewRecord.owning_tracker : null,
      review_reason: reviewRecord
        ? 'The latest observed upstream commit differs from the human-reviewed-through commit.'
        : 'The latest observed upstream commit differs from the adopted SOURCE-LOCK commit; no reviewed-through cursor exists.',
      update_policy: lock.source_update_policy,
      public_attribution_required: lock.public_attribution_required,
      tracked_files: Array.isArray(lock.files) ? lock.files : []
    });
  }
  const advisoryResult = await advisoryFindings({
    workspace,
    advisoryDocPath: advisoryDoc,
    reviewStatePath: reviewState
  }, env);
  const advisoryUpdates = advisoryResult.findings;

  if (updates.length === 0 && advisoryUpdates.length === 0) {
    if (reportTransport) await reportTransport({ type: 'REMOVE_REPORT' });
    else removeReportIfPresent(workspace, report);
    if (activeLocks.length === 0 && advisoryResult.target_count === 0) {
      return {
        report_written: false,
        updates: [],
        advisory_updates: [],
        summary: 'No active third-party source update candidates found.'
      };
    }
    return {
      report_written: false,
      updates,
      advisory_updates: advisoryUpdates,
      summary: advisoryResult.target_count > 0
        ? `Checked ${activeLocks.length} active third-party source lock(s) and ${advisoryResult.target_count} advisory target(s); no actionable updates found.`
        : `Checked ${activeLocks.length} active third-party source lock(s); no actionable updates found.`
    };
  }

  const markdown = renderReviewReport({
    updates,
    advisoryUpdates,
    advisoryDocPath: advisoryDoc
  });
  if (reportTransport) {
    const payload = markdown.endsWith('\n') ? markdown : markdown + '\n';
    if (Buffer.byteLength(payload, 'utf8') > MAX_OWNED_REPORT_BYTES) {
      throw new Error('Owned report exceeds the reserved 65,536-byte payload.');
    }
    await reportTransport({ type: 'PUT_REPORT', content: payload });
    return {
      report_written: true,
      updates,
      advisory_updates: advisoryUpdates,
      summary: advisoryUpdates.length > 0
        ? 'PR needed: yes (' + updates.length + ' source update' + (updates.length === 1 ? '' : 's') + ', ' + advisoryUpdates.length + ' advisory action' + (advisoryUpdates.length === 1 ? '' : 's') + ').'
        : 'PR needed: yes (' + updates.length + ' active third-party source update' + (updates.length === 1 ? '' : 's') + ' detected).'
    };
  }
  const reportPath = writeReport(workspace, report, markdown);
  return {
    report_written: true,
    report_path: reportPath,
    updates,
    advisory_updates: advisoryUpdates,
    summary: advisoryUpdates.length > 0
      ? `PR needed: yes (${updates.length} source update${updates.length === 1 ? '' : 's'}, ${advisoryUpdates.length} advisory action${advisoryUpdates.length === 1 ? '' : 's'}).`
      : `PR needed: yes (${updates.length} active third-party source update${updates.length === 1 ? '' : 's'} detected).`
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const mode = process.env.TOOLKIT_OWNED_TEMP_MODE;
  if (mode !== undefined && mode !== OWNED_REPORT_MODE) throw new Error('Unsupported owned report mode.');
  let result;
  if (mode === OWNED_REPORT_MODE) {
    const reportClient = createOwnedReportIpcClient(process, process.env);
    try {
      await reportClient.admit();
      result = await checkProjectSourceUpdates(args, process.env, (request) => reportClient.send(request));
    } finally {
      reportClient.dispose();
    }
  } else {
    result = await checkProjectSourceUpdates(args, process.env);
  }
  console.log(result.summary);
  if (result.report_written && mode !== OWNED_REPORT_MODE) console.log('Wrote ' + slash(path.relative(args.workspace, result.report_path)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  activeThirdPartyLocks,
  checkProjectSourceUpdates,
  discoverSourceLocks,
  isActiveThirdPartyLock,
  latestCommitForLock,
  parseArgs,
  parseOwnedReportFrame,
  mediateOwnedReportFrame,
  ownedReportRequestFrame,
  hasOwnedReportIpc,
  parseAdmissionControlFrame,
  parseOwnedReportAckFrame,
  createOwnedReportIpcClient,
  parseGitHubRepo,
  renderReviewReport,
  renderSourceUpdatesSection
};
