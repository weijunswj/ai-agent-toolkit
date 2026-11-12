#!/usr/bin/env node
'use strict';

// After the re-bump workflow ran toolkit-rebump-prs.cjs, tell each pull request it could not
// re-bump why, in one marked comment that later runs edit in place, and print a summary table.
// Success writes no new comment; a held comment left by an earlier run is edited to say it cleared.
// It only reads the report file and the pull requests' comments, and writes that one comment.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const MARKER = '<!-- toolkit-rebump -->';
const BOT = 'github-actions[bot]';
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const STATUSES = new Set(['held', 'verified', 'unchanged', 'eligible', 'skipped']);

// Reasons come from error text: keep one plain line that cannot open markup, mention anyone or
// link an issue.
function plain(text, limit = 400) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[<>`@#|*[\]]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, limit) || 'no reason given';
}
function commentBody(result, main) {
  if (result.status === 'held') {
    return [MARKER, `**Re-bump held.** After \`main\` moved to ${main.slice(0, 7)}, this pull request could not be re-bumped automatically.`, '',
      `- **Why:** ${plain(result.reason)}`,
      '- **What to do:** merge `main` into this branch, fix what the reason names, then prepare the version bump again as the branch\'s last commit.', ''].join('\n');
  }
  return [MARKER, `**Re-bump cleared.** Re-bumped to ${plain(result.version, 20)} at ${String(result.head).slice(0, 7)} after \`main\` moved to ${main.slice(0, 7)}.`, ''].join('\n');
}
function checkedReport(value) {
  const bad = () => new Error('not a re-bump report');
  if (!value || typeof value !== 'object' || !REPOSITORY.test(value.repository || '') || value.repository.includes('..') || !Array.isArray(value.results)) throw bad();
  for (const result of value.results) {
    if (!result || !Number.isSafeInteger(result.number) || result.number < 1 || !STATUSES.has(result.status)) throw bad();
    if (result.status === 'verified' && !SHA.test(result.head || '')) throw bad();
  }
  return value;
}
function runGitHub(args, input) {
  const result = spawnSync('gh', args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`GitHub call failed (${result.error?.code || `exit ${result.status}`})`);
  return result.stdout;
}

function report({ report: raw, main }, deps = {}) {
  const github = deps.github || runGitHub;
  const { repository, results } = checkedReport(raw);
  if (!SHA.test(main || '')) throw new Error('--main needs the full commit SHA of main');
  const ownComment = number => {
    for (let page = 1; page <= 20; page += 1) {
      const batch = JSON.parse(github(['api', `repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`]));
      if (!Array.isArray(batch)) throw new Error('invalid comment list');
      const found = batch.find(item => item?.user?.login === BOT && typeof item.body === 'string' && item.body.startsWith(MARKER));
      if (found) return found;
      if (batch.length < 100) break;
    }
    return null;
  };
  const actions = [];
  for (const result of results) {
    if (!['held', 'verified'].includes(result.status)) continue;
    const existing = ownComment(result.number);
    if (result.status === 'verified' && !existing) continue;
    const body = commentBody(result, main);
    const same = existing && (existing.body === body || (result.status === 'held' && existing.body.split('\n')[3] === body.split('\n')[3] && existing.body.includes('Re-bump held')));
    if (same) { actions.push({ number: result.number, action: 'unchanged' }); continue; }
    if (existing && result.status === 'verified' && existing.body.includes('Re-bump cleared')) continue;
    const input = JSON.stringify({ body });
    if (existing) github(['api', `repos/${repository}/issues/comments/${existing.id}`, '--method', 'PATCH', '--input', '-'], input);
    else github(['api', `repos/${repository}/issues/${result.number}/comments`, '--method', 'POST', '--input', '-'], input);
    actions.push({ number: result.number, action: existing ? (result.status === 'held' ? 'edited' : 'cleared') : 'commented' });
  }
  const detail = result => result.status === 'verified' ? `${plain(result.version, 20)} at ${result.head.slice(0, 7)}`
    : result.status === 'held' || result.status === 'skipped' ? plain(result.reason, 200) : result.target ? `would be ${plain(result.target, 20)}` : '';
  const summary = ['## Toolkit re-bump', '', `\`main\` at ${main.slice(0, 7)}.`, '', '| Pull request | Result | Detail |', '|---|---|---|',
    ...results.map(result => `| ${result.number} | ${result.status} | ${detail(result)} |`), ''].join('\n');
  return { actions, summary };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (['--report', '--main'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('-')) args[argv[i].slice(2)] = argv[++i];
    else throw new Error('usage: node repo/scripts/toolkit-rebump-report.cjs --report <report.json> --main <full sha>');
  }
  if (!args.report || !args.main) throw new Error('usage: node repo/scripts/toolkit-rebump-report.cjs --report <report.json> --main <full sha>');
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(args.report, 'utf8')); } catch { throw new Error('not a re-bump report'); }
    const { summary } = report({ report: parsed, main: args.main });
    process.stdout.write(summary);
  } catch (error) { console.error(`toolkit-rebump-report: ${error.message}`); process.exitCode = 1; }
}

module.exports = { MARKER, commentBody, report, parseArgs, plain };
