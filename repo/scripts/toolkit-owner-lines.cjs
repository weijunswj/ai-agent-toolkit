#!/usr/bin/env node
'use strict';

// Owner-line lint: reads the owner's own lines in a controller's instructions (Claude Projects
// instructions, a CLAUDE.md or AGENTS.md, a memory file) and offers one-tap fixes for the lines that
// say again, or say against, what the controller settings or Toolkit's block already say. It
// prevents the drift seen in a project whose instructions carried a stack line twice in different
// words, a "gates run on my computer" line that no longer matched where gates ran, and a post format
// line that overrode the block's house format.
//
//   node repo/scripts/toolkit-owner-lines.cjs check --file <file> [--settings <settings.json>] [--block projects] [--json]
//   node repo/scripts/toolkit-owner-lines.cjs apply --file <file> --fix <id>[,<id>...] [--settings <settings.json>] [--block projects] [--json]
//
// The reader is default-deny over a stated subset of line shapes (SHAPES below); every other line,
// and any line holding a character outside plain printable ASCII, is reported as unknown and never
// fixed. Lines inside a Toolkit managed block are Toolkit's and are not read. A fix only deletes a
// line or replaces it with the line the controller settings render; `apply` applies only the fix
// ids the owner tapped, each bound to its line's exact text, writes once and reads the file back.
// `check` writes nothing. A Toolkit gate session (TOOLKIT_GATE_ROLE set) cannot apply fixes.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { findBlocks, normalizeBody } = require('./toolkit-managed-block.cjs');

const PLAIN = /^[\x20-\x7e\t]*$/;
const BULLET = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/;
const NUMBER_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 });
// The shapes the reader understands. Each is matched against the whole plain line (bullet removed).
const LANES = /(?:^lanes?\s*:\s*(\d)\b|\b(\d|one|two|three|four|five|six|seven|eight|nine)\s+(?:working\s+|live\s+|parallel\s+)?lanes?\b)/i;
const PLACEMENT = /^(?:all\s+)?(?:the\s+)?(?:gates?|gate\s+work|g0\s*[,/]\s*g1\s*(?:[,/]|and)\s*g2)\b.*\b(?:run|runs|work|works|go|goes|happen|happens)\b.*\b(cloud\s+threads?|the\s+cloud|cloud|remote\s+control|(?:on|in)\s+(?:the|my|this|our)\s+[a-z0-9_-]+)\b/i;
const POST_FORMAT = /^(?:posts?|board|board\s+posts?|status\s+posts?|updates?)\s*(?:format|style)?\s*:/i;
// Words too common to count when two lines are compared.
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'its', 'are', 'any', 'all', 'not',
  'only', 'each', 'when', 'then', 'than', 'but', 'also', 'own', 'one', 'out', 'has', 'have', 'was', 'were', 'will', 'can', 'may']);
// Flag when most words match (a near copy), or when many words match (a long line that restates
// another among its own text). A cheap hint: it misses repeats worded very differently.
const OVERLAP_SHARE = 0.6;
const OVERLAP_MIN_WORDS = 4;
const OVERLAP_MANY_WORDS = 8;
const OVERLAP_MANY_SHARE = 0.4;
const PROJECTS_BLOCK = 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md';

class LintError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function words(line) {
  return new Set((line.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length >= 3 && !STOP_WORDS.has(word)));
}

// Whether two lines share most of their words, either way round, as { share } or null.
function overlap(a, b) {
  if (a.size < OVERLAP_MIN_WORDS || b.size < OVERLAP_MIN_WORDS) return null;
  const shared = [...a].filter(word => b.has(word)).length;
  const share = Math.max(shared / a.size, shared / b.size);
  return (shared >= OVERLAP_MIN_WORDS && share >= OVERLAP_SHARE) || (shared >= OVERLAP_MANY_WORDS && share >= OVERLAP_MANY_SHARE) ? { share } : null;
}

// Project lines (outside the markers) sharing most of their words with a line of `blockBody`: the
// Projects instructions' overlap hint, kept here as its one home. File line numbers for the project
// line, body line numbers for the block line.
function blockOverlaps(text, blockBody, isOutside) {
  const blockLines = normalizeBody(blockBody).split('\n').map((line, index) => ({ index: index + 1, words: words(line) }));
  const found = [];
  String(text).split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    if (!isOutside(index) || !line.trim() || /\(adds to the block/i.test(line)) return;
    const own = words(line);
    let best = null;
    for (const block of blockLines) {
      const match = overlap(own, block.words);
      if (match && (!best || match.share > best.share)) best = { block: block.index, share: match.share };
    }
    if (best) found.push({ line: index + 1, block: best.block });
  });
  return found;
}

// Which file lines (0-based) sit outside every Toolkit managed block, or throws on broken markers.
function outsideBlocks(text) {
  const { blocks, errors } = findBlocks(text);
  if (errors.length) throw new LintError('LINT_MARKERS', 'The file has a Toolkit marker that is not closed or is repeated, so its owner lines are not read.');
  const starts = [];
  let offset = 0;
  for (const raw of String(text).split('\n')) { starts.push(offset); offset += raw.length + 1; }
  return index => !blocks.some(block => starts[index] >= block.start && starts[index] <= block.end);
}

const idOf = (line, kind, text) => `${line}-${kind}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 8)}`;

// The setting a line states, or null: { key: 'live_lanes', value } | { key: 'stack_profile', value }
// | { key: 'placement', value }.
function settingOf(plain, profiles) {
  const lanes = LANES.exec(plain);
  if (lanes) {
    const raw = (lanes[1] || lanes[2]).toLowerCase();
    return { key: 'live_lanes', value: Number(NUMBER_WORDS[raw] || raw) };
  }
  const profile = profiles.find(id => new RegExp(`(^|[^a-z0-9-])${id}([^a-z0-9-]|$)`, 'i').test(plain));
  if (profile && /\b(stack|profile|route|routes|models?)\b/i.test(plain)) return { key: 'stack_profile', value: profile };
  const place = PLACEMENT.exec(plain);
  if (place) return { key: 'placement', value: /cloud/i.test(place[1]) ? 'cloud' : 'remote_control' };
  return null;
}

class OwnerLineLint {
  #profiles; #settings; #rendered; #blockBody; #environment;

  // `settings` and `rendered` come from toolkit-controller-settings.cjs (or null); `blockBody` is the
  // managed block's text whose lines an owner line should not repeat (or null).
  constructor({ profiles = [], settings = null, rendered = null, blockBody = null, environment = process.env } = {}) {
    this.#profiles = profiles;
    this.#settings = settings;
    this.#rendered = rendered;
    this.#blockBody = blockBody;
    this.#environment = environment;
  }

  // The rendered settings line that states `key`, or null.
  #settingLine(key) {
    if (!this.#rendered) return null;
    const lines = this.#rendered.project_lines;
    return { live_lanes: lines[0], stack_profile: lines[1], placement: lines[2] }[key] || null;
  }

  // { findings: [{ id, line, kind, text, message, fix? }], unknown: [line numbers] }. Writes nothing.
  check(text) {
    const outside = outsideBlocks(text);
    const lines = String(text).split('\n');
    const findings = [];
    const unknown = [];
    const seenSettings = new Map();
    const seenWords = [];
    const overlaps = new Map((this.#blockBody ? blockOverlaps(text, this.#blockBody, outside) : []).map(entry => [entry.line, entry.block]));
    lines.forEach((raw, index) => {
      const number = index + 1;
      const line = raw.replace(/\r$/, '');
      if (!outside(index) || !line.trim() || /^\s*#/.test(line) || /^\s*<!--/.test(line)) return;
      if (!PLAIN.test(line)) { unknown.push(number); return; }
      const plain = line.replace(BULLET, '').trim();
      const add = (kind, message, fix = null) => findings.push({ id: idOf(number, kind, line), line: number, kind, text: line, message, ...(fix ? { fix } : {}) });
      const setting = settingOf(plain, this.#profiles);
      if (setting) {
        const rendered = this.#settingLine(setting.key);
        if (seenSettings.has(setting.key)) {
          add('duplicate', `It says ${setting.key.replace('_', ' ')} again (first on line ${seenSettings.get(setting.key)}).`, { action: 'delete' });
          return;
        }
        seenSettings.set(setting.key, number);
        if (!this.#settings) { add('setting', `It states the ${setting.key.replace('_', ' ')}, which belongs in the controller settings: set it there on the owner's word, then this line can be rendered from them.`); return; }
        if (line.trim() === rendered) return;
        // "All gates" also says no gate runs elsewhere, so it differs from settings that place one gate apart.
        const split = setting.key === 'placement' && /^all\b/i.test(plain) && Object.keys(this.#settings.placement.gates || {}).length > 0;
        const current = setting.key === 'placement' ? `${this.#settings.placement.default}${split ? ' with some gates elsewhere' : ''}` : this.#settings[setting.key];
        if (setting.value === current) add('repeats-setting', `It says what the controller settings already say; the settings line replaces it.`, { action: 'replace', with: rendered });
        else add('conflicts-setting', `It says ${setting.key.replace('_', ' ')} ${setting.value}, but the controller settings say ${current}. Replace it with the settings line, or change the settings on the owner's word.`, { action: 'replace', with: rendered });
        return;
      }
      if (POST_FORMAT.test(plain)) {
        add('overrides-block', 'It sets a post format of its own, against the house format in Toolkit\'s block. Remove it to use the block\'s, or keep it as the owner\'s own choice.', { action: 'delete' });
        return;
      }
      if (overlaps.has(number)) {
        add('repeats-block', `It says again what Toolkit's block line ${overlaps.get(number)} says.`, { action: 'delete' });
        return;
      }
      const own = words(plain);
      const earlier = seenWords.find(entry => overlap(own, entry.words));
      if (earlier) {
        add('duplicate', `It says again what line ${earlier.line} says, in other words.`, { action: 'delete' });
        return;
      }
      seenWords.push({ line: number, words: own });
      unknown.push(number);
    });
    return { findings, unknown };
  }

  // Applies the fixes named by id, which must all be offered for the text as it is now; returns the
  // new text and what was applied. Never applies a fix that was not named.
  apply(text, ids) {
    const role = this.#environment.TOOLKIT_GATE_ROLE;
    if (role) throw new LintError('LINT_ROLE', 'A gate session cannot change the owner\'s lines: only the controller does, with the fixes the owner tapped.');
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new LintError('LINT_ARGUMENTS', 'Name each fix the owner tapped once, with --fix.');
    const { findings } = this.check(text);
    const chosen = ids.map(id => findings.find(finding => finding.id === id && finding.fix));
    const missing = ids.filter((id, index) => !chosen[index]);
    if (missing.length) throw new LintError('LINT_STALE_FIX', `These fixes are not offered for the file as it is now, so nothing was changed: ${missing.join(', ')}. Run check again and ask the owner again.`);
    const lines = String(text).split('\n');
    for (const finding of [...chosen].sort((a, b) => b.line - a.line)) {
      const cr = lines[finding.line - 1].endsWith('\r') ? '\r' : '';
      if (finding.fix.action === 'delete') lines.splice(finding.line - 1, 1);
      else lines[finding.line - 1] = `${finding.fix.with}${cr}`;
    }
    return { text: lines.join('\n'), applied: chosen.map(finding => ({ id: finding.id, line: finding.line, action: finding.fix.action })) };
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['check', 'apply'].includes(command)) throw new LintError('LINT_ARGUMENTS', USAGE);
  const options = { command, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--json') { options.json = true; continue; }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new LintError('LINT_ARGUMENTS', `${flag} needs a value.`);
    index += 1;
    const key = { '--file': 'file', '--settings': 'settings', '--block': 'block', '--fix': 'fix' }[flag];
    if (!key || options[key] !== undefined || (key === 'fix' && command !== 'apply')) throw new LintError('LINT_ARGUMENTS', `Unknown or repeated flag ${flag}.`);
    options[key] = value;
  }
  if (!options.file) throw new LintError('LINT_ARGUMENTS', 'Name the file with --file.');
  if (options.block !== undefined && options.block !== 'projects') throw new LintError('LINT_ARGUMENTS', '--block takes projects.');
  if (command === 'apply' && !options.fix) throw new LintError('LINT_ARGUMENTS', 'apply needs --fix with the ids the owner tapped.');
  return options;
}

const USAGE = 'Usage: toolkit-owner-lines.cjs check|apply --file <file> [--settings <settings.json>] [--block projects] [--fix <id,...>] [--json]';

function lintFor(options, { root, environment }) {
  const settingsModule = require('./toolkit-controller-settings.cjs');
  const profiles = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'repo/contracts/controller-kernel/stack-registry-v3.json'), 'utf8')).profiles || {});
  let settings = null;
  let rendered = null;
  if (options.settings) {
    rendered = new settingsModule.ControllerSettings({ file: options.settings, root, environment, profiles }).render();
    settings = rendered.settings;
  }
  const blockBody = options.block === 'projects' ? fs.readFileSync(path.join(root, PROJECTS_BLOCK), 'utf8') : null;
  return new OwnerLineLint({ profiles, settings, rendered, blockBody, environment });
}

function report(result) {
  const lines = result.findings.map(finding => `line ${finding.line}: ${finding.message}${finding.fix ? ` Fix ${finding.id}: ${finding.fix.action === 'delete' ? 'remove the line' : `replace it with "${finding.fix.with}"`}.` : ''}`);
  if (result.unknown.length) lines.push(`Not read (no fix offered; the owner's own words): line${result.unknown.length === 1 ? '' : 's'} ${result.unknown.join(', ')}.`);
  return lines.length ? lines : ['Nothing to fix.'];
}

function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, environment = process.env, root = path.resolve(__dirname, '..', '..') } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { stderr.write(`${error.message}\n`); return 2; }
  try {
    const lint = lintFor(options, { root, environment });
    const text = fs.readFileSync(options.file, 'utf8');
    if (options.command === 'check') {
      const result = lint.check(text);
      stdout.write(options.json ? `${JSON.stringify(result)}\n` : `${report(result).join('\n')}\n`);
      return result.findings.some(finding => finding.fix) ? 1 : 0;
    }
    const { text: next, applied } = lint.apply(text, options.fix.split(',').map(id => id.trim()).filter(Boolean));
    fs.writeFileSync(options.file, next);
    if (fs.readFileSync(options.file, 'utf8') !== next) throw new LintError('LINT_READBACK', 'The file was written but did not read back the same; check it before using it.');
    stdout.write(options.json ? `${JSON.stringify({ applied })}\n` : `${[`Applied and read back: ${applied.map(entry => `${entry.id} (${entry.action === 'delete' ? 'removed' : 'replaced'})`).join(', ')}.`, ...report(lint.check(next))].join('\n')}\n`);
    return 0;
  } catch (error) {
    const known = error instanceof LintError || (error && error.code === 'SETTINGS_INVALID') || (error && /^SETTINGS_/.test(error.code || ''));
    stderr.write(known ? `${error.message}\n` : `Owner-line lint stopped on an unexpected problem (${error?.code || error?.name || 'Error'}). Nothing was changed.\n`);
    return error && error.code === 'LINT_ARGUMENTS' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ OwnerLineLint, LintError, blockOverlaps, overlap, words, settingOf, main });
