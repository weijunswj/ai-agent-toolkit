'use strict';

// The handover file: one generated file per task in the private evidence store, so a fresh controller,
// executor or computer can resume a task from its issue number alone. It is rewritten from the
// programme state by this script at each gate end, with the gate's own plan and evidence links; it
// holds no secret and no device path. handoverUrl gives the link a page's AGENT CONTEXT line carries.
//
//   programme.cjs handover --issue <n> [--gate G0|G1|G2|controller] [--plan <https url>]
//                          [--evidence <https url>]... [--note <text>] [--apply] [--json] [--repo-root <dir>]
//
// Without --apply it prints the file. Any session may write it: it is evidence, not programme state.

const { ProgrammeError } = require('./resolve-executable.cjs');

const USAGE = 'Usage: programme.cjs handover --issue <n> [--gate G0|G1|G2|controller] [--plan <https url>] [--evidence <https url>]... [--note <text>] [--apply] [--json] [--repo-root <dir>]';
const GATES = ['G0', 'G1', 'G2', 'controller'];
const NOTE_LIMIT = 200;
const EVIDENCE_LIMIT = 20;
const DECISIONS = 5;
const FINDINGS = 10;
const PATH_DEPTH = 8;
// A path on someone's computer: a drive letter, a home folder or a user profile.
const DEVICE_PATH = /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?:home|Users|root)\/|%USERPROFILE%|\$env:USERPROFILE)/i;
const URL = /^https:\/\/[^\s<>()]+$/;
const LAST_UPDATED = /^- Last updated: .*$/m;

const usage = message => new ProgrammeError('USAGE', `${message} ${USAGE}`);
const refuse = message => new ProgrammeError('HANDOVER_REFUSED', message);
const unsafe = (state, text) => {
  const errors = [];
  state.screenSecrets(errors, String(text || ''), 'summary');
  return errors.length > 0 || DEVICE_PATH.test(String(text || ''));
};
const short = sha => (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : '-');
const encodePath = file => file.split('/').map(encodeURIComponent).join('/');

function handoverPath(store, issue) { return `${store.path}handover/issue-${issue}.md`; }
function handoverUrl(store, issue) { return `https://github.com/${store.repository}/blob/${encodeURIComponent(store.branch)}/${encodePath(handoverPath(store, issue))}`; }

function parse(argv) {
  const args = { evidence: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (['--apply', '--json'].includes(flag)) { args[flag.slice(2)] = true; continue; }
    if (!['--issue', '--gate', '--plan', '--evidence', '--note', '--repo-root'].includes(flag)) throw usage(`Unknown option: ${flag}.`);
    const value = argv[index + 1];
    if (value === undefined || !value.trim() || value.startsWith('--')) throw usage(`${flag} needs a value.`);
    index += 1;
    if (flag === '--evidence') args.evidence.push(value); else args[flag.slice(2)] = value;
  }
  if (!/^[1-9]\d*$/.test(String(args.issue || ''))) throw usage('--issue must be an issue number.');
  args.issue = Number(args.issue);
  if (args.gate !== undefined && !GATES.includes(args.gate)) throw usage('--gate must be G0, G1, G2 or controller.');
  for (const url of [args.plan, ...args.evidence].filter(value => value !== undefined)) if (!URL.test(url)) throw usage(`${url} is not an https link.`);
  if (args.note !== undefined && args.note.length > NOTE_LIMIT) throw usage(`--note is at most ${NOTE_LIMIT} characters.`);
  if (args.note !== undefined && /[\r\n]/.test(args.note)) throw usage('--note is one line: it may not hold a line break.');
  return args;
}

// The issue chain from the parent down to the task, read from the native parents.
function pathOf(reader, issue, parentIssue) {
  const chain = [issue.number];
  let at = issue;
  for (let depth = 0; depth < PATH_DEPTH && typeof at?.parent === 'number' && at.number !== parentIssue; depth += 1) {
    chain.unshift(at.parent);
    if (at.parent === parentIssue) break;
    at = reader.issue(at.parent);
  }
  return chain;
}

function comments(transport, repository, issue) {
  const all = [];
  for (let page = 1; page < 100; page += 1) {
    const response = transport.request('GET', `repos/${repository}/issues/${issue}/comments?per_page=100&page=${page}`);
    if (response.status !== 200 || !Array.isArray(response.json)) throw new ProgrammeError('GH_FAILED', `Reading the comments of #${issue} failed (${response.status}).`);
    all.push(...response.json);
    if (response.json.length < 100) break;
  }
  return all;
}

// The lines of one section of an earlier file, so links an earlier gate recorded are kept.
function sectionLines(text, heading) {
  const start = String(text || '').indexOf(`\n## ${heading}\n`);
  if (start === -1) return [];
  const rest = text.slice(start + heading.length + 5);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).split('\n').filter(line => line.startsWith('- '));
}

function renderHandover(facts) {
  const { issue, title, open, chain, child, findings, decisions, plan, evidence, note, gate, at } = facts;
  const gateText = [child.gate?.role, child.gate?.state].filter(Boolean).join(' ') || '-';
  const prs = [child.pr, ...(child.prs || [])].filter(pr => pr?.number && ['OPEN', 'DRAFT'].includes(pr.state));
  const unique = [...new Map(prs.map(pr => [pr.number, pr])).values()];
  const verdict = pr => (child.review?.verdicts || []).filter(entry => entry.head === pr.head).map(entry => `${entry.verdict} at ${short(entry.head)}`).join(', ') || '-';
  const checks = pr => (pr.checks && pr.checks.at_head === pr.head ? `${pr.checks.state} ${pr.checks.required_passed}/${pr.checks.required_total}` : 'UNKNOWN');
  return [
    `# HANDOVER #${issue}: ${title}`, '',
    'Generated by `programme.cjs handover` from the programme state at each gate end. Do not edit it by hand.', '',
    `- Task: #${issue} (${open ? 'open' : 'closed'})`,
    `- PATH: ${chain.map(number => `#${number}`).join(' > ')}`,
    child.parent ? `- Status: ${child.lifecycle}` : `- Status: ${child.lifecycle}; gate ${gateText}; release ${child.release || '-'}`,
    `- Next action: ${child.next_action}`,
    `- Last updated: ${at} at the end of ${gate}`, '',
    '## OPEN PRS', '',
    ...(unique.length ? unique.map(pr => `- #${pr.number} ${pr.state} at ${short(pr.head)}; CI ${checks(pr)}; review ${verdict(pr)}; UAT ${child.uat?.state || '-'}`) : ['- None.']), '',
    '## HOLDS AND FINDINGS', '',
    ...[...(child.blockers || []).map(text => `- Blocker: ${text}`), ...findings.map(text => `- ${text}`)].concat(child.blockers?.length || findings.length ? [] : ['- None.']), '',
    '## RECENT DECISIONS', '',
    ...(decisions.length ? decisions.map(entry => `- ${entry.tag} · ${entry.date} · [${entry.summary}](${entry.url})`) : ['- None recorded yet.']),
    `- Full list: \`programme.cjs trace ${issue}\``, '',
    '## PLAN', '',
    plan ? `- ${plan}` : '- Not recorded yet.', '',
    '## EVIDENCE', '',
    ...(evidence.length ? evidence.map(url => `- ${url}`) : ['- None recorded yet.']),
    ...(note ? [`- Note: ${note}`] : []), '',
  ].join('\n');
}

function readFile(transport, store, file) {
  const response = transport.request('GET', `repos/${store.repository}/contents/${encodePath(file)}?ref=${encodeURIComponent(store.branch)}`);
  if (response.status === 404) return { text: null, sha: null };
  if (response.status !== 200 || response.json?.encoding !== 'base64') throw new ProgrammeError('GH_FAILED', `Reading ${file} failed (${response.status}).`);
  return { text: Buffer.from(response.json.content, 'base64').toString('utf8'), sha: response.json.sha };
}

// Written only to a private store, against the version read, and read back at the commit it made.
function writeFile(transport, store, file, text, previous) {
  const repo = transport.request('GET', `repos/${store.repository}`);
  if (repo.status !== 200) throw new ProgrammeError('GH_FAILED', `Reading the store ${store.repository} failed (${repo.status}).`);
  if (repo.json?.private !== true) throw new ProgrammeError('STORE_NOT_PRIVATE', `The store ${store.repository} is not private, so no handover file was written.`);
  const response = transport.request('PUT', `repos/${store.repository}/contents/${encodePath(file)}`, {
    message: `programme handover: ${file.split('/').pop()}`, content: Buffer.from(text, 'utf8').toString('base64'), branch: store.branch, ...(previous.sha ? { sha: previous.sha } : {}),
  });
  if (response.status === 409 || (response.status === 422 && !previous.sha)) throw new ProgrammeError('STATE_CONFLICT', `${file} moved since it was read; run handover again.`);
  if (response.status < 200 || response.status >= 300) throw new ProgrammeError('GH_FAILED', `Writing ${file} failed (${response.status}).`);
  const commit = response.json?.commit?.sha;
  const readback = commit ? transport.request('GET', `repos/${store.repository}/contents/${encodePath(file)}?ref=${encodeURIComponent(commit)}`) : null;
  if (readback?.status !== 200 || Buffer.from(readback.json.content || '', 'base64').toString('utf8') !== text) {
    throw new ProgrammeError('STATE_READBACK_MISMATCH', `${file} did not read back as written.`);
  }
  return commit;
}

// The parent has no task document: its file shows the attention line and points at CURRENT.
function parentView(state, parentDoc) {
  if (!parentDoc) return null;
  return { parent: true, lifecycle: `programme parent; ${state.attentionLine(parentDoc.attention)}`, gate: {}, release: null, pr: null, prs: [], blockers: [],
    next_action: `Controller: read CURRENT, answer attention (\`node <Toolkit>/${require('../../../repo/scripts/toolkit-user-state.cjs').PROGRAMME_SCRIPT} attention\`), then run the queue` };
}

function command(argv, deps, out, openContext) {
  const args = parse(argv);
  const state = require('./programme-state.cjs');
  const history = require('./decision-history.cjs');
  const context = openContext({ command: 'handover', ...(args['repo-root'] ? { 'repo-root': args['repo-root'] } : {}) }, deps);
  const { binding, transport, repository, store } = context;
  const parentDoc = store.read('parent', binding.parent_issue).doc;
  const isParent = args.issue === binding.parent_issue;
  const child = isParent ? parentView(state, parentDoc) : store.read('child', args.issue).doc;
  if (!child) throw new ProgrammeError('STATE_MISSING', `#${args.issue} has no programme state document, so it has no handover file.`);
  const reader = new state.ProgrammeGraphReader({ transport, repository });
  const issue = reader.issue(args.issue);
  if (!issue) throw new ProgrammeError('ISSUE_MISSING', `#${args.issue} could not be read.`);
  const { entries } = history.entriesFromComments(args.issue, comments(transport, repository, args.issue), { repo: repository, prefix: binding.record_prefix });
  // A summary that would hold a path on a computer or a secret shape is withheld behind its link,
  // so one comment cannot block the whole file.
  const decisions = history.analyseTrace(entries).live.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, DECISIONS)
    .map(entry => (unsafe(state, entry.summary) ? { ...entry, summary: 'Summary withheld: open the record' } : entry));
  // The parent's file lists the work queue first, then the other open findings; a task's lists its own.
  const open = state.openFindings(parentDoc?.attention);
  const findings = (isParent ? [...state.workQueue(parentDoc?.attention), ...open.filter(entry => !state.workQueue(parentDoc?.attention).includes(entry))] : open.filter(entry => entry.issue === args.issue))
    .slice(0, FINDINGS).map(entry => state.findingText(entry));
  const file = handoverPath(binding.store, args.issue);
  const earlier = readFile(transport, binding.store, file);
  const carried = sectionLines(earlier.text, 'EVIDENCE').map(line => line.slice(2)).filter(value => URL.test(value));
  const evidence = [...new Set([...carried, ...args.evidence])].slice(-EVIDENCE_LIMIT);
  const plan = args.plan || sectionLines(earlier.text, 'PLAN').map(line => line.slice(2)).find(value => URL.test(value)) || null;
  const now = (deps.now || (() => new Date().toISOString()))();
  const text = renderHandover({ issue: args.issue, title: issue.title, open: issue.state === 'open', chain: pathOf(reader, issue, binding.parent_issue), child,
    findings, decisions, plan, evidence, note: args.note || null, gate: args.gate || 'a gate', at: now });
  const errors = [];
  state.screenSecrets(errors, text, 'handover');
  if (errors.length) throw refuse(`The handover file would hold text shaped like a secret, so nothing was written (${errors[0].replace(/^handover /, '')}).`);
  if (DEVICE_PATH.test(text)) throw refuse('The handover file would hold a path on a computer, so nothing was written; link the evidence store instead.');
  const same = earlier.text !== null && earlier.text.replace(LAST_UPDATED, '') === text.replace(LAST_UPDATED, '');
  let outcome = 'DRY_RUN', commit = null;
  if (args.apply) {
    if (same) outcome = 'NOOP';
    else { commit = writeFile(transport, binding.store, file, text, earlier); outcome = 'WRITTEN'; }
  }
  const url = handoverUrl(binding.store, args.issue);
  out.write(args.json ? `${JSON.stringify({ issue: args.issue, outcome, path: file, url, commit, text }, null, 2)}\n` : `${text}\n${outcome}: ${url}\n`);
  return 0;
}

module.exports = Object.freeze({ DEVICE_PATH, handoverPath, handoverUrl, renderHandover, parse, command });
