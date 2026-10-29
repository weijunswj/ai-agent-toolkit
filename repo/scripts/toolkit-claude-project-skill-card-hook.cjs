#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for the skill card tool (propose_skills). It stops a card for the Claude Projects
// controller skill (web-controller-projects) unless the card carries main's SKILL.md exactly, so a card whose text was
// cut short, HTML-escaped or retyped never reaches the owner, who would save it over the account skill.
// - Scope: the tool takes { proposals: [{ name, kind, description, skillMd, target, evidence }] } (one to three).
//   Every proposal whose name or target is web-controller-projects is checked; other skills' cards pass untouched.
// - Check: kind improvement, name and target web-controller-projects, description equal to main's frontmatter
//   description, and skillMd equal to main's SKILL.md after only CR removal and exactly one final newline.
// - Main: the raw file from the Toolkit repository's main branch. On a mismatch it reads once more through the GitHub
//   contents API, so a raw-cache lag right after a merge is not a false refusal. Downloads use curl (which follows the
//   host's proxy settings) with a short timeout. When main cannot be read, the card is refused as unchecked.
// Every refusal names main's and the card's bytes and sha256, the first differing offset with a short excerpt, the
// likely cause and the fix: read main's file again in this session and pass it unchanged, never through a helper.
// Limits: it runs only where the Toolkit plugin carrying it is installed and synced. Other tools, input it cannot read
// and a crash pass, and the hook is registered without `onFailure: "block"` so a hook that cannot start never stops
// every skill card. It reads only its input and main's file, and writes nothing but its decision.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const CARD_TOOL = 'propose_skills';
const SKILL = 'web-controller-projects';
const SKILL_PATH = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
const REPO = 'weijunswj/ai-agent-toolkit';
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/main/${SKILL_PATH}`;
const API_URL = `https://api.github.com/repos/${REPO}/contents/${SKILL_PATH}?ref=main`;
const RULE = 'Toolkit Projects rule: exact skill card.';
const FIX = `Read main's ${SKILL_PATH} again in this session (a fresh download, never a local branch) and pass its text unchanged as skillMd, never through a helper, subagent or retyping; follow main's reference/skill-card.md.`;
const ENTITIES = /&(?:lt|gt|amp|quot);/;

// One download with curl: { text } or { error }.
function curlDownload(url, headers = []) {
  const args = ['-fsSL', '--max-time', '4', ...headers.flatMap(header => ['-H', header]), url];
  const result = spawnSync('curl', args, { encoding: 'utf8', timeout: 4500, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error) return { error: result.error.code === 'ENOENT' ? 'curl is not installed' : result.error.message };
  if (result.status !== 0) return { error: (result.stderr || `curl exit ${result.status}`).trim().slice(0, 160) };
  return { text: result.stdout };
}

const DOWNLOADS = {
  raw: () => curlDownload(RAW_URL),
  api: () => curlDownload(API_URL, ['Accept: application/vnd.github.raw', 'User-Agent: toolkit-skill-card-check']),
};

// The one form both sides are compared in: no CR, exactly one final newline.
function normalise(text) {
  return `${text.replace(/\r/g, '').replace(/\n+$/, '')}\n`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// The frontmatter description of a SKILL.md (a quoted value is read as JSON), or null.
function frontmatterDescription(text) {
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  const line = front?.[1].match(/^description:[ \t]*(.*)$/m);
  if (!line) return null;
  const value = line[1].trim();
  if (!value.startsWith('"')) return value;
  try { return JSON.parse(value); } catch { return null; }
}

// Why a card's text differs from main's, with where it first differs.
function difference(card, main) {
  let at = 0;
  while (at < card.length && at < main.length && card[at] === main[at]) at += 1;
  const excerpt = text => JSON.stringify(text.slice(Math.max(0, at - 20), at + 40));
  let cause = 'changed text';
  if (card.length < main.length && main.startsWith(card.replace(/\n$/, ''))) cause = 'cut short';
  else if (ENTITIES.test(card) && !ENTITIES.test(main)) cause = 'HTML-escaped (&lt; or &amp; where main has plain < or &)';
  const bytes = text => Buffer.byteLength(text, 'utf8');
  return `Main's SKILL.md is ${bytes(main)} bytes, sha256 ${sha256(main)}; the card's skillMd is ${bytes(card)} bytes, sha256 ${sha256(card)} (both with CR removed and one final newline). They first differ at character ${at}: main ${excerpt(main)}, card ${excerpt(card)}. Likely cause: ${cause}.`;
}

// The problems with one controller-skill proposal against main's text, or [].
function proposalIssues(proposal, main) {
  const issues = [];
  if (proposal.kind !== 'improvement') issues.push(`kind must be "improvement" (got ${JSON.stringify(proposal.kind ?? null)})`);
  if (proposal.name !== SKILL || proposal.target !== SKILL) issues.push(`name and target must both be "${SKILL}" (got name ${JSON.stringify(proposal.name ?? null)}, target ${JSON.stringify(proposal.target ?? null)})`);
  const description = frontmatterDescription(main);
  if (description === null) issues.push('main\'s SKILL.md has no readable frontmatter description');
  else if (proposal.description !== description) issues.push(`description must equal main's frontmatter description exactly (${JSON.stringify(description)})`);
  if (typeof proposal.skillMd !== 'string') issues.push('skillMd is missing');
  else {
    const card = normalise(proposal.skillMd);
    if (card !== main) issues.push(`skillMd is not main's SKILL.md. ${difference(card, main)}`);
  }
  return issues;
}

function decide(input, { download = DOWNLOADS } = {}) {
  if (input?.tool_name !== CARD_TOOL) return '';
  const proposals = input.tool_input?.proposals;
  if (!Array.isArray(proposals)) return '';
  const ours = proposals.filter(item => item && typeof item === 'object' && (item.name === SKILL || item.target === SKILL));
  if (!ours.length) return '';
  const raw = download.raw();
  let main = typeof raw.text === 'string' ? normalise(raw.text) : null;
  let issues = main === null ? null : ours.map(item => proposalIssues(item, main));
  if (main === null || issues.some(list => list.length)) {
    // One more read through the contents API: a fresh merge can leave the raw file cached for a few minutes.
    const api = download.api();
    if (typeof api.text === 'string') {
      const second = normalise(api.text);
      const secondIssues = ours.map(item => proposalIssues(item, second));
      if (main === null || !secondIssues.some(list => list.length)) { main = second; issues = secondIssues; }
    } else if (main === null) {
      return `${RULE} This card for ${SKILL} could not be checked against main, so it holds: the raw file failed (${raw.error || 'no text'}) and the GitHub contents API failed (${api.error || 'no text'}). Check the network and try again; the card must carry main's SKILL.md exactly.`;
    }
  }
  const found = issues.flat();
  if (!found.length) return '';
  return `${RULE} This card for ${SKILL} does not carry main's SKILL.md exactly, and saving it would replace the account skill with a broken copy. ${found.join(' ')} ${FIX}`;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
  catch { return 0; }
  let reason;
  try { reason = decide(input); }
  catch { return 0; }
  if (!reason) return 0;
  const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.stderr.write(`${reason}\n`);
  return 2;
}

if (require.main === module) process.exitCode = main();

module.exports = { decide, normalise, frontmatterDescription, RAW_URL, API_URL };
