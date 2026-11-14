#!/usr/bin/env node
'use strict';

// Merge card readiness: whether the merge thread may post the owner's merge card now, and, after the
// tap, whether nothing on the pull request changed since. An owner tap is used up by one merge
// attempt. A body or title edit after the tap starts a required Validate run, GitHub refuses the
// merge while it runs, and the refused attempt spends the tap, so the owner has to tap again. This
// check puts every body fix before the card:
//
//   node repo/scripts/toolkit-merge-card-ready.cjs --repo <owner/name> --pr <n> --head <full SHA> [--body-sha <sha256>] [--workflow <file>] [--json]
//
// It reads the pull request through `gh api` (REST), then:
//   - the head must still be --head and the pull request open;
//   - the body's UAT line must let it merge (toolkit-auto-merge-eligible.cjs's own reader, on the
//     body GitHub has now, with the merge scope read from local git, so fetch the head first). A
//     merge-rule scope is no reason to wait: that is what the card is for;
//   - the newest Validate run on that head (--workflow, default validate.yml) must have finished
//     green. A body or title edit starts a new run on the same head, so an edit made after the last
//     green run shows here as a run still going;
//   - with --body-sha (the sha256 this check printed when the card was posted), the body must be
//     unchanged since. Run it again with that value just before merging on the tap.
//
// Exit 0: ready (post the card, or merge on the tap). Exit 1: wait, with every reason named. Exit 2:
// bad arguments, or GitHub or git could not be read. It grants no merge authority: the tap, the
// merge hold and the repository's rules decide that. It loads only Node's own modules and the
// eligibility check beside it.

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { eligibilityOf, uatVerdict } = require(path.join(__dirname, 'toolkit-auto-merge-eligible.cjs'));

const SHA = /^[0-9a-f]{40}$/;
const BODY_SHA = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const USAGE = 'Usage: node repo/scripts/toolkit-merge-card-ready.cjs --repo <owner/name> --pr <n> --head <full SHA> [--body-sha <sha256>] [--workflow <file>] [--json]\n';

class ReadError extends Error {}

function ghApi(route) {
  const result = spawnSync('gh', ['api', route], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new ReadError(`GitHub could not be read for ${route.split('?')[0]}`);
  try { return JSON.parse(result.stdout); } catch { throw new ReadError(`GitHub's answer for ${route.split('?')[0]} was not JSON`); }
}

const bodySha = body => crypto.createHash('sha256').update(String(body), 'utf8').digest('hex');

// The facts and every reason to wait. `github` answers a REST route with parsed JSON; `scope` reads
// the merge scope from git (null when the commits are not here).
function check({ repository, number, head, expectedBodySha = null, workflow = 'validate.yml' }, { github = ghApi, cwd = process.cwd(), scope = eligibilityOf } = {}) {
  const pr = github(`repos/${repository}/pulls/${number}`);
  const reasons = [];
  if (pr?.state !== 'open' || pr?.merged) reasons.push(`the pull request is ${pr?.merged ? 'merged' : String(pr?.state || 'unknown')}, not open`);
  const liveHead = pr?.head?.sha;
  if (liveHead !== head) reasons.push(`the head moved to ${String(liveHead || 'unknown').slice(0, 12)}: review that head, then run this check for it`);
  const body = typeof pr?.body === 'string' ? pr.body : '';
  const sha = bodySha(body);
  if (expectedBodySha && sha !== expectedBodySha) reasons.push('the body changed since the card was posted: the tap is stale; withdraw that card, wait for the new Validate run to go green, run this check again, then post a fresh card');
  const uat = uatVerdict(body);
  if (!uat.mergeable) reasons.push(`the body's UAT line does not let it merge (${uat.problem || uat.state}): fix the line now, before any card, then wait for the new Validate run to go green and run this check again`);
  const base = pr?.base?.sha;
  const merge = SHA.test(base || '') ? scope(cwd, base, head) : null;
  if (!merge) throw new ReadError('the merge scope could not be read from git: fetch the pull request head and its base, then run the check again');
  const runs = (github(`repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${head}&per_page=20`)?.workflow_runs || [])
    .filter(run => run && run.head_sha === head);
  const newest = runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null;
  if (!newest) reasons.push(`no ${workflow} run on this head yet: wait for it to start and go green`);
  else if (newest.status !== 'completed') reasons.push(`the newest ${workflow} run on this head (${newest.id}) is ${newest.status}: a body, title or branch change started it; wait for it to go green, then run this check again`);
  else if (newest.conclusion !== 'success') reasons.push(`the newest ${workflow} run on this head (${newest.id}) ended ${newest.conclusion}: fix that first`);
  return { ready: reasons.length === 0, head, body_sha: sha, uat: uat.state, merge_rules: !merge.eligible, validate_run: newest ? newest.id : null, reasons };
}

function main(argv, { stdout = process.stdout, stderr = process.stderr, ...deps } = {}) {
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const repository = value('--repo');
  const number = Number(value('--pr'));
  const head = value('--head');
  const expectedBodySha = value('--body-sha') || null;
  const workflow = value('--workflow') || 'validate.yml';
  if (!REPOSITORY.test(repository || '') || !Number.isSafeInteger(number) || number < 1 || !SHA.test(head || '')
    || (argv.includes('--body-sha') && !BODY_SHA.test(expectedBodySha || '')) || !WORKFLOW.test(workflow)) { stderr.write(USAGE); return 2; }
  let result;
  try { result = check({ repository, number, head, expectedBodySha, workflow }, deps); } catch (error) {
    if (!(error instanceof ReadError)) throw error;
    stderr.write(`Merge card check could not finish: ${error.message}. Nothing is ready until it does.\n`);
    return 2;
  }
  if (argv.includes('--json')) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.ready) {
    stdout.write(expectedBodySha
      ? `Ready to merge on the tap: head ${head} and the body are unchanged since the card, and Validate run ${result.validate_run} is green.\n`
      : `Ready for the merge card: Merge ${repository}#${number} at ${head}? Validate run ${result.validate_run} is green and the UAT line is ${result.uat}.\n`
        + `Body sha256 ${result.body_sha}. From the card until it lands, edit nothing on this pull request (body, title or branch); just before merging on the tap, run this check again with --body-sha ${result.body_sha}.\n`);
  } else stdout.write(`Not ready for ${expectedBodySha ? 'the merge' : 'the merge card'}:\n${result.reasons.map(reason => `- ${reason}`).join('\n')}\n`);
  return result.ready ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ bodySha, check, main, ReadError });
