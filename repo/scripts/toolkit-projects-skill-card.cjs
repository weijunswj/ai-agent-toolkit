'use strict';

// Whether the owner's saved claude.ai copy of the Projects controller skill holds main's text, the one
// home of that rule. Setup's install check and the guidebook script's `--card` both use it.
//
// A release that touches the skill folder restamps SKILL.md's Version line even when its text is the
// same, and the synced copy drops the final newline, so neither the Version nor the bytes decide. The
// text is compared with LF line endings, without the Version line and without trailing whitespace; the
// frontmatter description counts too when the saved copy has frontmatter (the claude.ai record keeps
// only the body). The newest saved Version among several synced copies is the one compared.
//
// One line for the reader:
//   SKILL CARD OUTDATED: saved <old>, main <new>, text <fp8>   the text differs: offer the update card
//   SKILL CARD CURRENT <main> [(saved <old>, Version line only)]
//   SKILL CARD NOT SEEN [(<reason>)]                           no saved copy, or one that cannot be read
// <fp8> is the first 8 hex digits of the sha256 of main's compared text, so a card the owner already
// declined is not offered again after a release that changes only the Version line.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL_NAME = 'web-controller-projects';
const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const VERSION_LINE = /^Version:[ \t]*(\d{4}-\d{2}-\d{2}\.\d+)[ \t]*$/m;

// Versions look like 2026-10-23.6: the date, then a counter for that day (so .10 is newer than .9).
function compareSkillVersions(left, right) {
  const [ld, ln] = left.split('.'), [rd, rn] = right.split('.');
  if (ld !== rd) return ld > rd ? 1 : -1;
  return Number(ln) === Number(rn) ? 0 : (Number(ln) > Number(rn) ? 1 : -1);
}

function frontmatterDescription(frontmatter) {
  const match = /^description:[ \t]*(.*)$/m.exec(frontmatter);
  if (!match) return '';
  const value = match[1].trim();
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

// { version, description (null without frontmatter), text } of one SKILL.md.
function skillText(raw) {
  const lf = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n');
  const front = FRONTMATTER.exec(lf);
  const body = front ? lf.slice(front[0].length) : lf;
  const version = VERSION_LINE.exec(body)?.[1] || '';
  const text = body.replace(VERSION_LINE, '').replace(/\n+$/, '');
  return { version, description: front ? frontmatterDescription(front[1]) : null, text };
}

function fingerprint(main) {
  return crypto.createHash('sha256').update(`${main.description || ''}\n${main.text}`).digest('hex').slice(0, 8);
}

// The comparison of one saved copy's text with main's SKILL.md text.
function compareSkill(savedRaw, mainRaw) {
  const main = skillText(mainRaw);
  if (!main.version) return { state: 'not-seen', reason: 'main has no Version line' };
  const saved = skillText(savedRaw);
  if (!saved.version) return { state: 'not-seen', reason: 'saved copy has no Version line', main: main.version };
  const same = saved.text === main.text && (saved.description === null || saved.description === main.description);
  return { state: same ? 'current' : 'outdated', saved: saved.version, main: main.version, fingerprint: fingerprint(main) };
}

// The saved copies under a synced-skills folder (`<folder>/<account>/web-controller-projects/SKILL.md`),
// newest Version first. Unreadable entries are skipped; an unreadable folder is reported.
function savedCopies(syncedDir) {
  let entries;
  try { entries = fs.readdirSync(syncedDir, { withFileTypes: true }); }
  catch (error) { return { copies: [], reason: error.code === 'ENOENT' ? null : 'synced folder unreadable' }; }
  const copies = [];
  let unreadable = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(syncedDir, entry.name, SKILL_NAME, 'SKILL.md');
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') unreadable += 1; continue; }
    copies.push({ file, raw, version: skillText(raw).version });
  }
  copies.sort((a, b) => (a.version && b.version ? compareSkillVersions(b.version, a.version) : a.version ? -1 : b.version ? 1 : 0));
  return { copies, reason: copies.length || !unreadable ? null : 'saved copy unreadable' };
}

// The card state for the newest saved copy against main's SKILL.md text; never throws.
function skillCard(syncedDir, mainRaw) {
  try {
    const { copies, reason } = savedCopies(syncedDir);
    if (!copies.length) return { state: 'not-seen', reason };
    return { ...compareSkill(copies[0].raw, mainRaw), copies: copies.map(copy => copy.file) };
  } catch {
    return { state: 'not-seen', reason: 'saved copy unreadable' };
  }
}

function cardLine(result) {
  if (result.state === 'outdated') return `SKILL CARD OUTDATED: saved ${result.saved}, main ${result.main}, text ${result.fingerprint}`;
  if (result.state === 'current') {
    return `SKILL CARD CURRENT ${result.main}${result.saved !== result.main ? ` (saved ${result.saved}, Version line only)` : ''}`;
  }
  return `SKILL CARD NOT SEEN${result.reason ? ` (${result.reason})` : ''}`;
}

// Where Claude Code keeps skills synced from claude.ai (in Projects, /root/.claude/skills/synced).
function defaultSyncedDir(environment = process.env, home = os.homedir()) {
  return path.join(environment.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills', 'synced');
}

module.exports = Object.freeze({ defaultSyncedDir, compareSkillVersions, skillText, compareSkill, savedCopies, skillCard, cardLine, fingerprint });
