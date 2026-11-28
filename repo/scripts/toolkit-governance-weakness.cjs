'use strict';

// Weaknesses Toolkit's governance finds in a repository's own workflow files (a required check no
// job produces, one that can be skipped, one that does not report on every pull request) are the
// repository's controller's work, never the owner's by hand (owner decision of 28 November 2026):
// each one is filed once as a native child task under the programme parent, with the file, the check,
// why it matters and the fix, so it is fixed after setup. An open task for the same weakness is named
// again, never filed twice; when it cannot be filed, the result says why and the controller files it.
//
// The failure this prevents: SQAG's required job "Quote Basis click budget" could be skipped when a
// job it waits for failed; the result told the owner to change it by hand three times, and nothing
// tracked the fix.

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const GH_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const OPEN_PAGES = 10;

// Why each kind of weakness matters and how it is fixed, in plain words, the same in every repository.
const WORDS = Object.freeze({
  skippable: {
    title: 'can be skipped and still count as passed',
    why: 'GitHub reports a skipped job as a success, so a pull request can merge while a job this check waits for failed.',
    fix: 'Run the job with `if: always()` (or `!cancelled()`) and make it fail when any job it needs did not succeed.',
  },
  trigger: {
    title: 'does not report on every pull request',
    why: 'A required check that does not run on a pull request to the default branch blocks that merge, or leaves it unchecked.',
    fix: 'Run its workflow on every pull request to the default branch (opened, synchronize and reopened), with no filter that leaves some out.',
  },
  'no-producer': {
    title: 'has no job that produces it',
    why: 'A required check that no job produces never reports, so requiring it blocks every merge.',
    fix: 'Add a job with exactly this name, or take the check out of the programme file\'s required checks in a pull request.',
  },
  'many-producers': {
    title: 'is produced by more than one job',
    why: 'Two jobs report under the same name, so one can pass for the other.',
    fix: 'Leave one job with this name and give the others their own names.',
  },
  'name-unclear': {
    title: 'is not clearly produced by one job',
    why: 'A job\'s name is not plain, so Toolkit cannot tell which job reports this check.',
    fix: 'Give the job that runs it a plain, fixed name equal to the check.',
  },
  'job-unclear': {
    title: 'cannot be confirmed to fail when it should',
    why: 'Toolkit cannot read enough of the job to confirm it runs and fails when a job it needs did not succeed.',
    fix: 'Keep the job\'s needs and condition in plain YAML, and make it fail when any job it needs did not succeed.',
  },
  'workflow-unreadable': {
    title: 'workflow could not be checked',
    why: 'Toolkit cannot read this workflow, so it cannot confirm the required checks run and fail as they should.',
    fix: 'Keep the workflow in plain YAML Toolkit can read (no anchors or block values where it reads triggers, needs and conditions).',
  },
});
const wordsOf = kind => WORDS[kind] || WORDS['job-unclear'];

// Text from the repository's own files, made safe for an issue: one line, no mention that notifies.
const plain = (text, max = 200) => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/@/g, '(at)').trim().slice(0, max);

// One key per weakness: what kind, which check, which file. The words may change between Toolkit
// releases; the key does not, so a rerun finds the task it filed.
function keyOf(finding) {
  return crypto.createHash('sha256').update(`${finding.kind}\n${finding.check || ''}\n${finding.file || ''}`).digest('hex').slice(0, 12);
}
const markOf = key => `<!-- toolkit-weakness:${key} -->`;

function taskFor(finding) {
  const words = wordsOf(finding.kind);
  const what = finding.check ? `Required check "${plain(finding.check, 100)}"` : `Workflow ${plain(finding.file, 100)}`;
  const title = `CI: ${what} ${words.title}${finding.check && finding.file ? ` (${plain(finding.file, 100)})` : ''}`;
  const body = [
    'Toolkit\'s governance refresh found this weakness in the repository\'s own CI. It is the controller\'s to fix in a pull request.',
    '',
    `**File:** ${finding.file ? `\`${plain(finding.file, 150)}\`` : 'none found'}`,
    `**Job (required check):** ${finding.check ? `\`${plain(finding.check, 150)}\`` : 'the workflow as a whole'}`,
    `**Found:** ${plain(finding.detail, 600)}.`,
    `**Why it matters:** ${words.why}`,
    `**The fix:** ${words.fix}`,
    '',
    '## DONE WHEN',
    '',
    '- [ ] The fix is merged in a pull request, and refresh governance no longer lists this weakness.',
    '',
    'Nearest child: none checked; Toolkit files one task per CI weakness it finds, which the controller may merge into an open task.',
    '',
    markOf(keyOf(finding)),
    '',
  ].join('\n');
  return { title: title.slice(0, 240), body };
}

// GitHub through the signed-in gh CLI: { ok, value } or { ok: false, reason }.
function ghRequest(method, endpoint, input = null, { spawn = childProcess.spawnSync } = {}) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', endpoint, '--method', method, ...(input === null ? [] : ['--input', '-'])], {
      input: input === null ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false,
    });
  } catch { return { ok: false, reason: 'gh-unavailable' }; }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) {
    const text = `${result.stderr || ''}${result.stdout || ''}`;
    if (/HTTP 403/.test(text) && !/rate limit/i.test(text)) return { ok: false, reason: 'forbidden' };
    if (/HTTP 410/.test(text)) return { ok: false, reason: 'issues-off' };
    return { ok: false, reason: /HTTP 404/.test(text) ? 'not-visible' : 'gh-request-failed' };
  }
  try { return { ok: true, value: JSON.parse(result.stdout) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

// Why a task could not be filed, in plain words, by reason code.
const WHY = Object.freeze({
  'no-parent': 'the programme file names no parent issue',
  'no-github': 'this run does not write to GitHub',
  forbidden: 'GitHub refused this computer\'s sign-in',
  'issues-off': 'issues are turned off in this repository',
  'not-visible': 'GitHub does not show the repository or its parent issue to this computer\'s sign-in',
  'gh-unavailable': 'the GitHub CLI could not run',
  'gh-request-failed': 'the GitHub request failed',
  'gh-output-invalid': 'GitHub gave an answer Toolkit could not read',
  'list-incomplete': 'the open issues could not all be read, so a task already filed could not be ruled out',
});
const whyOf = reason => WHY[reason] || String(reason || 'no answer');

// Files the weaknesses for one repository. `request(method, endpoint, input)` is the GitHub route.
class WeaknessTasks {
  #request;
  constructor({ request = ghRequest } = {}) { this.#request = request; }

  // The open issues that carry a weakness mark: Map(key -> issue number), or { reason } when the list
  // could not be read in full. Pull requests are left out.
  #open(repository) {
    const found = new Map();
    for (let page = 1; page <= OPEN_PAGES; page += 1) {
      const read = this.#request('GET', `repos/${repository}/issues?state=open&per_page=100&page=${page}`);
      if (!read.ok || !Array.isArray(read.value)) return { reason: read.ok ? 'gh-output-invalid' : read.reason };
      for (const issue of read.value) {
        if (!issue || issue.pull_request || !Number.isSafeInteger(issue.number)) continue;
        const mark = /<!-- toolkit-weakness:([0-9a-f]{12}) -->/.exec(String(issue.body || ''));
        if (mark && !found.has(mark[1])) found.set(mark[1], issue.number);
      }
      if (read.value.length < 100) return { found };
    }
    return { reason: 'list-incomplete' };
  }

  // Each finding ({ kind, check, file, detail }) once: { finding, state, number?, parent, why? } with
  // state 'filed' (new child under the parent), 'open' (filed before, still open), 'unlinked' (filed,
  // but not linked under the parent) or 'not-filed'. Nothing is written when the open list cannot be read.
  // Findings with the same key (one check's weakness said twice) share one task.
  file(repository, parent, findings) {
    const all = Array.isArray(findings) ? findings : [];
    if (!all.length) return [];
    const each = outcome => all.map(finding => ({ finding, parent, ...outcome(keyOf(finding)) }));
    if (!Number.isSafeInteger(parent) || parent <= 0) return each(() => ({ state: 'not-filed', why: whyOf('no-parent') }));
    const open = this.#open(repository);
    if (open.reason) return each(() => ({ state: 'not-filed', why: whyOf(open.reason) }));
    const outcomes = new Map();
    for (const finding of all) {
      const key = keyOf(finding);
      if (outcomes.has(key)) continue;
      if (open.found.has(key)) { outcomes.set(key, { state: 'open', number: open.found.get(key) }); continue; }
      const created = this.#request('POST', `repos/${repository}/issues`, taskFor(finding));
      if (!created.ok || !Number.isSafeInteger(created.value?.number) || !Number.isSafeInteger(created.value?.id)) {
        outcomes.set(key, { state: 'not-filed', why: whyOf(created.ok ? 'gh-output-invalid' : created.reason) });
        continue;
      }
      const linked = this.#request('POST', `repos/${repository}/issues/${parent}/sub_issues`, { sub_issue_id: created.value.id });
      outcomes.set(key, linked.ok ? { state: 'filed', number: created.value.number } : { state: 'unlinked', number: created.value.number, why: whyOf(linked.reason) });
    }
    return each(key => outcomes.get(key));
  }
}

// What the owner reads about one filed weakness, after "Your controller fixes this in a pull request: ...".
function filedWords(task) {
  if (!task) return '';
  if (task.state === 'filed') return ` Filed as #${task.number} under #${task.parent}.`;
  if (task.state === 'open') return ` Already filed as #${task.number}, still open.`;
  if (task.state === 'unlinked') return ` Filed as #${task.number}, but it could not be linked under #${task.parent} (${task.why}); your controller links it.`;
  return ` Not filed as a task (${task.why}); your controller files it.`;
}

module.exports = Object.freeze({ WORDS, WeaknessTasks, filedWords, ghRequest, keyOf, taskFor });
