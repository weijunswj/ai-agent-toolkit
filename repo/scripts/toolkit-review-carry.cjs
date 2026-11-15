'use strict';

// Scripted review carry: the few pull request classes the merge train finder lets board without a
// fresh G2 PASS at their head, each proved by an exact check instead of a reviewer. The failure it
// prevents: a fix that changes nothing a reviewer judged (a body line, a bot's timing numbers, a
// regenerated output) waiting hours for a full review queue. Anything outside a class's exact file
// list, or any doubt, falls back to the normal G2.
//
//   body-only        the newest verdict for the head is a FAIL whose `Carry: body-only uat=<state>`
//                    line says only the description failed; the head is the reviewed commit, and the
//                    body's UAT state is the one the reviewer named or stricter (OWNER_TEST_NEEDED).
//   shard-timings    a bot's refresh branch (toolkit/shard-timings-*) that changes only the shard
//                    manifest, and only its measured times and the files each named shard lists:
//                    every other key, every budget and every shard stay as they were. The rest
//                    shard runs any file no named shard lists, and CI's `--verify-ci` proves each
//                    file ran once, so moving files between shards changes only where a file runs.
//   generated-sync   only files a sync script writes (PROJECTED_OUTPUTS of the two syncs): whole
//                    projected files, or managed blocks with the hand-written rest unchanged, and
//                    only where the Validate workflow runs both syncs' `--check` (the Toolkit
//                    repository), which proves the generated text matches its sources.
//
// The finder still asks for green required checks, one `Bump:` line, an accepted `UAT:` line and no
// footer or other personal data in the title or body (attribution rules on). A RISKY member keeps
// the owner's merge card: the finder never fills the owner's OK.
//
// Wording-only docs: a pull request whose every file is a LIGHT `.md` file may take one G2 at high
// instead of the reviewer pin's effort (wordingOnly); the finder accepts that stamp only then.

const { findBlocks } = require('./toolkit-managed-block.cjs');
const riskTier = require('./toolkit-risk-tier.cjs');
const shards = require('./ci-test-shards.cjs');
const governedShards = require('./governed-test-shards.cjs');
const instructionSync = require('./sync-agent-instruction-shims.cjs');
const docContractSync = require('./sync-repo-doc-contract.cjs');
const { detectPrText } = require('../../skills/secure-ci-cd/scripts/personal-data-guard.cjs');

const CARRY = /^Carry: body-only uat=(NOT_REQUIRED|OWNER_TEST_NEEDED|PASSED)[ \t]*$/;
const SHARD_BRANCH = 'toolkit/shard-timings-';
const SHARD_MANIFESTS = Object.freeze([shards.MANIFEST_REL, governedShards.MANIFEST_REL]);
const OUTPUTS = Object.freeze(new Map([...instructionSync.PROJECTED_OUTPUTS, ...docContractSync.PROJECTED_OUTPUTS].map(entry => [entry.path, entry.blocks])));
const { WORDING_EFFORT } = require('./toolkit-gate-route.cjs');
// Where CI proves the generated text: the Validate workflow running each sync's `--check`.
const SYNC_WORKFLOW = '.github/workflows/validate.yml';
const SYNC_SCRIPTS = Object.freeze(['repo/scripts/sync-repo-doc-contract.cjs', 'repo/scripts/sync-agent-instruction-shims.cjs']);

// The UAT state a body-only carry names, from the verdict comment's lines after its first; null
// without exactly one Carry line.
function carryFloor(lines) {
  const found = lines.map(line => CARRY.exec(String(line).trim())).filter(Boolean);
  return found.length === 1 ? found[0][1] : null;
}

// Whether a fixed body's UAT state keeps the reviewer's: the same state, or OWNER_TEST_NEEDED, the
// strictest. Anything else (NOT_REQUIRED or PASSED in place of a needed test) needs a G2.
function uatKept(floor, state) {
  return state === floor || state === 'OWNER_TEST_NEEDED';
}

// Why the title or body carries text the personal-data guard reports (a footer, session link,
// attribution marker or home path), or null.
function textProblem(title, body) {
  const rules = [...new Set([...detectPrText(String(title || ''), true), ...detectPrText(String(body || ''), true)].map(finding => finding.rule))];
  return rules.length ? `its title or body has text the personal-data guard reports (${rules.join(', ')})` : null;
}

// A shard manifest with the parts a refresh may change taken out: measured times, and the files
// each named shard lists (a refresh's rebalance moves files between named shards and the rest shard).
function shardSkeleton(text) {
  const manifest = JSON.parse(text);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('not an object');
  const copy = JSON.parse(JSON.stringify(manifest));
  delete copy.durations_seconds;
  for (const entry of Object.values(copy.systems || {})) {
    const list = Array.isArray(entry) ? entry : (entry && entry.shards) || [];
    for (const shard of list) if (shard && Array.isArray(shard.files)) shard.files = [];
  }
  return JSON.stringify(copy);
}

// Why a pull request is not a shard-timing refresh the finder can carry, or null. `read(ref, path)`
// gives a file's text at a commit, or null.
function shardRefreshProblem(pull, files, read, base) {
  const login = pull.user && pull.user.login;
  if (!(pull.user && pull.user.type === 'Bot' && /\[bot\]$/.test(String(login)))) return 'not opened by a bot account';
  if (!String(pull.head && pull.head.ref).startsWith(SHARD_BRANCH)) return `not on a ${SHARD_BRANCH}* branch`;
  const own = pull.base && pull.base.repo && pull.head && pull.head.repo && pull.head.repo.full_name === pull.base.repo.full_name;
  if (!own) return 'its branch is not in this repository';
  if (files.length !== 1 || !SHARD_MANIFESTS.includes(files[0])) return `it changes more than the shard manifest (${files.join(', ')})`;
  const before = read(base, files[0]);
  const after = read(pull.head.sha, files[0]);
  if (before === null || after === null) return 'the shard manifest is missing at the merge base or the head';
  try {
    if (shardSkeleton(before) !== shardSkeleton(after)) return 'it changes more than measured times and which shard runs which file';
  } catch (error) {
    return `the shard manifest does not read as JSON (${error.message})`;
  }
  return null;
}

// The text of a file with the named managed blocks taken out, or null when its markers are broken
// or a named block is missing.
function outsideBlocks(text, names) {
  const { blocks, errors } = findBlocks(String(text).replace(/\r\n/g, '\n'));
  if (errors.length) return null;
  if (!names.every(name => blocks.some(block => block.name === name))) return null;
  let rest = String(text).replace(/\r\n/g, '\n');
  for (const block of [...blocks].reverse()) if (names.includes(block.name)) rest = rest.slice(0, block.start) + rest.slice(block.end);
  return rest;
}

// Why CI at a commit does not prove the generated text, or null: each sync script and the Validate
// workflow line that runs its `--check` must be there.
function syncCheckProblem(read, ref) {
  const workflow = read(ref, SYNC_WORKFLOW);
  const lines = workflow === null ? [] : String(workflow).split(/\r?\n/).map(line => line.trim());
  const missing = SYNC_SCRIPTS.filter(script => read(ref, script) === null || !lines.includes(`node ${script} --check`));
  return missing.length ? `CI here does not run ${missing.map(script => `${script} --check`).join(' and ')}, so nothing proves the generated text` : null;
}

// Why a pull request is not a generated-sync change the finder can carry, or null.
function generatedSyncProblem(pull, files, read, base) {
  if (!files.length) return 'it changes no file';
  const other = files.filter(file => !OUTPUTS.has(file));
  if (other.length) return `it changes files no sync writes (${other.join(', ')})`;
  const unproved = syncCheckProblem(read, base) || syncCheckProblem(read, pull.head.sha);
  if (unproved) return unproved;
  for (const file of files) {
    const names = OUTPUTS.get(file);
    if (names === null) continue; // the sync check compares the whole file
    const before = read(base, file);
    const after = read(pull.head.sha, file);
    if (before === null || after === null) return `${file} is missing at the merge base or the head`;
    const restBefore = outsideBlocks(before, names);
    const restAfter = outsideBlocks(after, names);
    if (restBefore === null || restAfter === null) return `${file} has broken or missing managed blocks`;
    if (restBefore !== restAfter) return `${file} changes outside its managed blocks`;
  }
  return null;
}

// Whether every changed file is a `.md` file the risk-tier list makes LIGHT.
function wordingOnly(files, tiers) {
  return files.length > 0 && files.every(file => /\.md$/i.test(file) && riskTier.classify([{ path: file }], tiers).tier === 'LIGHT');
}

module.exports = Object.freeze({ CARRY, OUTPUTS, SHARD_BRANCH, WORDING_EFFORT, carryFloor, generatedSyncProblem, outsideBlocks, shardRefreshProblem, textProblem, uatKept, wordingOnly });
