#!/usr/bin/env node
'use strict';

// Owner-line lint: reads the owner's own lines in a controller's instructions (project instructions,
// an agent instruction file or a memory file) and offers one-tap fixes for the lines that say again,
// or say against, what the controller settings or Toolkit's block already say. It prevents the drift
// seen in a project whose instructions carried a stack line twice in different words, a "gates run on
// my computer" line that no longer matched where gates ran, and a post format line that overrode the
// block's house format.
//
//   node repo/scripts/toolkit-owner-lines.cjs check --file <file> [--settings <settings.json> [--repository <owner/name>]] [--block projects] [--json]
//   node repo/scripts/toolkit-owner-lines.cjs apply --file <file> --fix <id>[,<id>...] [--settings <settings.json> [--repository <owner/name>]] [--block projects] [--json]
//
// The reader is default-deny. A settings line is read only when the whole line is one of the shapes
// below (LANES, PROFILE, PLACEMENT, POST_FORMAT): one more word, a negation or a character outside
// plain printable ASCII makes it unknown, which is listed and never fixed. A line gets a fix only
// where it stands on its own (readLines): not nested, wrapped, under a lead-in line or under a heading
// that may change what it means. A line whose words mostly match another's is a hint without a fix,
// unless it is the same line again. Code fences, quotes, tables, comments and Toolkit's own blocks are
// not owner lines, and a line labelled "(adds to the block ...)" or "(kept ...)" is left alone.
//
// A fix only deletes a line or replaces it with the line the controller settings render. Its id binds
// the whole file, the line, the replacement and the settings' repository, so `apply` writes exactly
// what the owner was shown and tapped, or refuses. `apply` refuses a file that is not valid UTF-8,
// leaves every other byte as it is, and writes by a temporary file and a rename over unchanged bytes.
// `check` writes nothing. Gate and launcher-bound helper sessions cannot apply fixes.
// What it cannot judge: plain sentences above a line that never mention it (no colon, list or
// heading), which is why every fix prints the line it removes or replaces.
//
// Exit codes of `check`: 0 nothing to do, 1 a fix or a conflict to settle, 2 it could not run.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { findBlocks, normalizeBody } = require('./toolkit-managed-block.cjs');

const MAX_BYTES = 1024 * 1024;
const PLAIN = /^[\x20-\x7e]*$/;
const BULLET = /^([-*+]|\d{1,2}[.)]) +/;
const KEEP = /\((?:adds to the block|kept\b)[^()]*\)/i;
const NUMBER_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 });

// ---- The shapes the reader understands, each against the whole plain line (bullet removed, runs of
// spaces as one). END is the owner tag the settings lines carry and one full stop.

const END = '(?: \\(owner(?:, \\d{4}-\\d{2}-\\d{2})?\\))?\\.?$';
const shape = source => new RegExp(`^${source}${END}`, 'i');
const COUNT = `(${Object.keys(NUMBER_WORDS).join('|')}|[1-9])`;
const LANES = [
  shape(`(?:(?:live|working|parallel) )?lanes?: ?${COUNT}(?: (?:(?:live|working|parallel) )?lanes?)?`),
  shape(`${COUNT} (?:live|working|parallel) lanes?`),
];
const PROFILE = [
  shape('(?:stack|stack profile|gate profile|profile): `?([a-z0-9-]+)`?'),
  shape('(?:the )?stack profile is `?([a-z0-9-]+)`?'),
  shape('use the `?([a-z0-9-]+)`? (?:stack )?profile(?: for (?:every|each) gate(?: launch| session)?| for all gates(?: launches| sessions)?)?'),
];
const PLACES = Object.freeze({
  cloud: 'in (?:the )?cloud(?: threads?)?',
  remote_control: '(?:on (?:this|my|the) (?:device|computer|laptop|desktop|pc|machine)(?: by remote control)?|by remote control)',
  any: 'wherever the controller starts them',
});
const PLACE = `(?:${Object.values(PLACES).join('|')})`;
// "This device", "my computer", "the machine" and "by Remote Control" are the device the controller works
// from. The other computer words in PLACES are kinds of computer that may be different ones, so a line
// naming one is the same place as another line only when both name the same kinds (computerKinds).
const COMPUTER_KINDS = /\b(laptop|desktop|pc)\b/gi;
const computerKinds = text => [...new Set((text.match(COMPUTER_KINDS) || []).map(word => word.toLowerCase()))].sort().join(' and ');
const PLACEMENT = shape(`(?:all )?(?:the )?(?:gates run|gate work runs) (${PLACE})((?:; G[012] ${PLACE})*)(?: \\(([^()]+)\\))?`);
const GATE_PLACE = new RegExp(`; (G[012]) (${PLACE})`, 'gi');
// A folder in the brackets after a placement; a device there is read only when it is the settings' own.
const FOLDER_ONLY = /^(?:[A-Za-z]:[\\/]|~?[\\/])[A-Za-z0-9._:\\/~-]*$/;
// A post format: a label and a list of closed phrases. "No" here is part of the phrase ("no headings").
const PHRASE = '(?:(?:one|two|three|[1-9]) (?:short )?(?:paragraph|sentence|line|bullet)s?(?: per (?:pull request|post|task|update|item))?|(?:no|with) (?:heading|bullet|emoji|table|link|list)s?|(?:bullet|paragraph)s only)';
const POST_FORMAT = new RegExp(`^(?:(?:board|status) )?posts? (?:format|style): ${PHRASE}(?:, ${PHRASE})*\\.?$`, 'i');

// Headings a settings line keeps its meaning under. Any other heading (another repository's part,
// retired or example lines) may change what the line is about, so it gets no fix. The file's own title
// is the file's name, so it counts only when it says such a thing itself.
const HEADING_WORDS = new Set(('project projects controller settings setting instructions toolkit gate gates lane lanes stack profile route routes '
  + 'work rules owner owners my our the and general notes lines line setup where run runs post posts format board status agent agents').split(' '));
const TITLE_HOLD = /\b(?:no|not|never|don|avoid|without|old|former|previous|retired|superseded|examples?|history|drafts?|template)\b/i;

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
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

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

// ---- The line reader ----

// What each line is: toolkit (inside a Toolkit block), quiet (comment, rule, front matter), block (code
// fence, quote or table), blank, heading { level, title }, indented, item or plain.
function lineKinds(lines, outside) {
  const kinds = [];
  let fence = null;
  let comment = false;
  const front = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  lines.forEach((line, index) => {
    const before = kinds[index - 1];
    const push = (kind, extra = {}) => kinds.push({ kind, ...extra });
    if (!outside(index)) return push('toolkit');
    if (index <= front) return push('quiet');
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return push('block');
    }
    if (comment) {
      const end = line.indexOf('-->');
      if (end >= 0) comment = line.lastIndexOf('<!--') > line.lastIndexOf('-->');
      return push('quiet');
    }
    const open = /^\s*(?:(?:[-*+]|\d{1,2}[.)])\s+)*(`{3,}|~{3,})/.exec(line);
    if (open) { fence = open[1]; return push('block'); }
    if (line.includes('<!--')) {
      comment = line.lastIndexOf('<!--') > line.lastIndexOf('-->');
      if (/^\s*<!--/.test(line)) return push('quiet');
    }
    if (!line.trim()) return push('blank');
    if (/^\s*(?:(?:[-*+]|\d{1,2}[.)])\s+)*[>|]/.test(line)) return push('block');
    const heading = /^ {0,3}(#{1,6})(?:\s+(.*))?$/.exec(line);
    if (heading) return push('heading', { level: heading[1].length, title: heading[2] || '' });
    const rule = /^ {0,3}(=+|-+)\s*$/.exec(line);
    if (rule && before && before.kind === 'plain') {
      Object.assign(before, { kind: 'heading', level: rule[1][0] === '=' ? 1 : 2, title: lines[index - 1] });
      return push('quiet');
    }
    if (rule || /^ {0,3}(?:(?:\* *){3,}|(?:_ *){3,}|(?:- *){3,})$/.test(line)) return push('quiet');
    if (/^\s/.test(line)) return push('indented');
    return push(BULLET.test(line) ? 'item' : 'plain');
  });
  return kinds;
}

// Whether a line may say what the lines under it mean: it ends in a colon, is all bold, opens a tag or a
// fenced note, or is a bare line of text (no label, no full stop) that reads like a heading.
const leadsIn = (kind, body) => /:[*_`\s]*$/.test(body) || /^(\*\*|__).+\1$/.test(body) || /^(?:<[a-z/!]|:::|!!!)/i.test(body) || (kind === 'plain' && !/[:.!?]/.test(body));

// The owner's lines in a text, each { number, start, end, next (offsets of the line, its end and the
// line after), line, bullet, body, numbered, hold (why the line does not stand on its own, or null),
// headingHold (why its headings may change what a settings line means, or null), section }.
function readLines(text, outside) {
  const raws = String(text).split('\n');
  const lines = raws.map((raw, index) => (index === 0 ? raw.replace(/^\ufeff/, '') : raw).replace(/\r$/, ''));
  const kinds = lineKinds(lines, outside);
  const strange = /\r(?!\n)|[\v\f\u0085\u2028\u2029]/.test(text);
  const kindAt = index => (kinds[index] ? kinds[index].kind : 'blank');
  const gap = kind => ['blank', 'quiet', 'toolkit', 'heading'].includes(kind);
  const sentence = line => /[.!?]$/.test(line.trim());
  const found = [];
  let heads = [];
  let lead = null;
  let leadSeen = false;
  let anyText = false;
  let offset = 0;
  raws.forEach((raw, index) => {
    const start = offset;
    const end = start + raw.replace(/\r$/, '').length;
    offset = start + raw.length + 1;
    const { kind, level, title } = kinds[index];
    if (kind === 'heading') {
      heads = [...heads.filter(head => head.level < level), { level, title, own: level === 1 && !anyText && !heads.length }];
      lead = null;
      anyText = true;
      return;
    }
    if (kind === 'toolkit') { lead = null; return; }
    if (!['indented', 'item', 'plain'].includes(kind)) return;
    anyText = true;
    const line = lines[index];
    const above = kindAt(index - 1);
    const under = kindAt(index + 1);
    let after = index + 1;
    while (after < raws.length && ['blank', 'quiet'].includes(kindAt(after))) after += 1;
    let hold = strange ? 'the file has line breaks Toolkit does not read' : null;
    const held = why => { hold = hold || why; };
    if (kind === 'plain' && lead && leadSeen && gap(above)) lead = null;
    if (kind === 'item' && above === 'plain' && !lead) { lead = index; leadSeen = false; }
    if (kind === 'indented') held('it is nested or indented');
    if (kind === 'plain' && !gap(above) && !(above === 'plain' && sentence(lines[index - 1]))) held('it may continue the line above it');
    if (kindAt(after) === 'indented' && after < raws.length) held('the lines under it may be part of it');
    if (!gap(under) && !(kind === 'item' && under === 'item') && !(kind === 'plain' && under === 'plain' && sentence(line))) held('the lines under it may be part of it');
    if (lead) held(`it comes under line ${lead}, which may change what it means`);
    const bullet = kind === 'item' ? BULLET.exec(line) : null;
    const body = line.slice(bullet ? bullet[0].length : 0).replace(/ +/g, ' ').trim();
    const head = heads.find(entry => (entry.own ? TITLE_HOLD.test(entry.title) : (entry.title.toLowerCase().match(/[^\s#]+/g) || []).some(word => !HEADING_WORDS.has(word.replace(/['`*_:]/g, '')))));
    found.push({
      number: index + 1, start: index === 0 ? start + (raw.length - raw.replace(/^\ufeff/, '').length) : start, end, next: Math.min(offset, text.length), line, body, hold,
      bullet: bullet ? bullet[0] : '', numbered: Boolean(bullet) && /^\d/.test(bullet[0]),
      headingHold: head ? `its heading "${head.title.trim()}" may change what it means` : null,
      section: heads.map(entry => `${entry.level} ${entry.title}`).join('\n'),
    });
    if (leadsIn(kind, body)) { lead = index + 1; leadSeen = false; } else if (lead) leadSeen = true;
  });
  return found;
}

// ---- The lint ----

const LABELS = Object.freeze({ live_lanes: 'live lanes', stack_profile: 'stack profile', placement: 'placement' });
const placeName = text => Object.keys(PLACES).find(name => new RegExp(`^${PLACES[name]}$`, 'i').test(text));
const placementLabel = (standard, gates) => [standard, ...Object.keys(gates).sort().filter(gate => gates[gate] !== standard).map(gate => `${gate}=${gates[gate]}`)].join(' ');
const sameText = body => body.toLowerCase().replace(/\.$/, '');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// The setting a whole line states, as { key, value, tail, computer, where }, or null. `value` is how it
// is printed and compared; `tail` is the device and folder a placement line names, or null; `computer`
// the kinds of computer a placement line names ('' for this device) and `where` its place words as written.
function statedSetting(body, profiles, ownTail) {
  for (const pattern of LANES) {
    const lanes = pattern.exec(body);
    if (lanes) return { key: 'live_lanes', value: String(NUMBER_WORDS[lanes[1].toLowerCase()] || lanes[1]), tail: null, computer: '' };
  }
  for (const pattern of PROFILE) {
    const profile = pattern.exec(body);
    if (profile && profiles.includes(profile[1])) return { key: 'stack_profile', value: profile[1], tail: null, computer: '' };
  }
  const place = PLACEMENT.exec(body);
  if (!place) return null;
  const gates = {};
  for (const [, gate, where] of place[2].matchAll(GATE_PLACE)) {
    if (Object.hasOwn(gates, gate.toUpperCase())) return null;
    gates[gate.toUpperCase()] = placeName(where);
  }
  const tail = place[3] && !/^owner(?:, \d{4}-\d{2}-\d{2})?$/i.test(place[3]) ? place[3] : null;
  if (tail && tail !== ownTail.text && !FOLDER_ONLY.test(tail) && !(ownTail.device && tail.startsWith(`${ownTail.device}, `) && FOLDER_ONLY.test(tail.slice(ownTail.device.length + 2)))) return null;
  return { key: 'placement', value: placementLabel(placeName(place[1]), gates), tail, computer: computerKinds(`${place[1]}${place[2]}`), where: `${place[1]}${place[2]}` };
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

  // What the settings say for `key`: { value, tail, body } with the rendered line's text, or null.
  #current(key) {
    if (!this.#settings) return null;
    const { live_lanes: lanes, stack_profile: profile, placement } = this.#settings;
    const [lanesLine, profileLine, placementLine] = this.#rendered.project_lines.map(line => line.replace(BULLET, ''));
    return {
      live_lanes: { value: String(lanes), tail: null, body: lanesLine },
      stack_profile: { value: profile, tail: null, body: profileLine },
      placement: { value: placementLabel(placement.default, placement.gates || {}), tail: [placement.device, placement.folder].filter(Boolean).join(', ') || null, body: placementLine },
    }[key];
  }

  // { findings: [{ id, line, kind, text, message, fix? }], unknown: [line numbers] }. Writes nothing.
  check(text) {
    return this.#read(text).result;
  }

  #read(text) {
    const outside = outsideBlocks(text);
    const lines = readLines(text, outside);
    const digest = sha(text);
    const findings = [];
    const unknown = [];
    const stated = new Map();
    const seenWords = [];
    const seenSame = new Map();
    const own = { text: this.#current('placement')?.tail || null, device: this.#settings?.placement.device || null };
    const overlaps = new Map((this.#blockBody ? blockOverlaps(text, this.#blockBody, outside) : []).map(entry => [entry.line, entry.block]));
    const blockSame = new Set(this.#blockBody ? readLines(normalizeBody(this.#blockBody), () => true).filter(line => !line.hold).map(line => sameText(line.body)) : []);
    for (const line of lines) {
      const { number, body } = line;
      if (!PLAIN.test(line.line) || KEEP.test(line.line)) { unknown.push(number); continue; }
      const add = (kind, message, fix = null) => findings.push({
        id: `${number}-${kind}-${sha(JSON.stringify([digest, fix, this.#settings?.repository || null])).slice(0, 16)}`,
        line: number, kind, text: line.line, message, ...(fix ? { fix } : {}),
      });
      const says = statedSetting(body, this.#profiles, own);
      const format = !says && this.#blockBody && POST_FORMAT.test(body);
      const hold = line.hold || line.headingHold;
      if ((says || format) && hold) {
        add('held', `It reads like ${says ? `${LABELS[says.key]} ${says.value}` : 'a post format'}, but ${hold}, so no fix is offered.`);
        continue;
      }
      if (says) { this.#checkSetting(line, says, stated, add); continue; }
      if (format) {
        add('overrides-block', 'It sets a post format of its own, against the house format in Toolkit\'s block. Remove it to use the block\'s, or keep it as the owner\'s own choice: end it with "(kept by the owner)".', { action: 'delete' });
        continue;
      }
      const same = sameText(body);
      if (overlaps.has(number)) {
        // The heading hold counts here as for a settings line: "## Not in this project" turns it round.
        if (!line.hold && !line.headingHold && blockSame.has(same)) add('repeats-block', `It is the same as line ${overlaps.get(number)} of Toolkit's block.`, { action: 'delete' });
        else if (!line.hold && blockSame.has(same)) add('repeats-block', `It is the same as line ${overlaps.get(number)} of Toolkit's block, but ${line.headingHold}, so no fix is offered: read both.`);
        else add('repeats-block', `It shares most of its words with line ${overlaps.get(number)} of Toolkit's block, but ${blockSame.has(same) ? 'its place may matter' : 'is not the same line'}, so no fix is offered: read both, and trim what it repeats.`);
        continue;
      }
      const mine = words(body);
      const first = seenSame.get(`${line.section}\n\n${same}`);
      const near = seenWords.find(entry => entry.same === same) || seenWords.find(entry => overlap(mine, entry.words));
      if (first && mine.size >= OVERLAP_MIN_WORDS && !line.hold && !line.numbered) {
        add('duplicate', `It is the same as line ${first.number}.`, { action: 'delete' });
      } else if (near && mine.size >= OVERLAP_MIN_WORDS) {
        add('duplicate-hint', `It shares most of its words with line ${near.number}, but ${near.same === same ? 'its place may matter' : 'is not the same line'}, so no fix is offered: read both.`);
      } else unknown.push(number);
      if (!first && !line.hold && !line.numbered) seenSame.set(`${line.section}\n\n${same}`, line);
      if (mine.size >= OVERLAP_MIN_WORDS) seenWords.push({ number, words: mine, same });
    }
    return { lines, result: { findings, unknown } };
  }

  #checkSetting(line, says, stated, add) {
    const label = LABELS[says.key];
    const current = this.#current(says.key);
    const isRendered = current && line.body === current.body;
    const first = stated.get(says.key);
    if (first && first.value === says.value && first.tail === says.tail && first.computer === says.computer) {
      add('duplicate', `It says ${label} ${says.value} again (first on line ${first.number}).`, { action: 'delete' });
      return;
    }
    if (first && first.value === says.value && first.tail === says.tail) {
      if (!isRendered) add('conflicts-line', `It says ${label} ${says.value} ${says.where}, but line ${first.number} says ${first.where}: they may be two computers. Ask the owner which one stands; no fix is offered.`);
      return;
    }
    if (first) {
      const also = says.value === first.value ? `${says.value} with ${says.tail || 'no folder'}, but line ${first.number} names ${first.tail || 'no folder'}` : `${says.value}, but line ${first.number} says ${first.value}`;
      if (!isRendered) add('conflicts-line', `It says ${label} ${also}${current ? `, and the controller settings say ${current.value}` : ''}. Ask the owner which one stands; no fix is offered.`);
      return;
    }
    stated.set(says.key, { ...says, number: line.number });
    if (!current) { add('setting', `It states the ${label}, which belongs in the controller settings: set it there on the owner's word, then this line can be rendered from them.`); return; }
    if (isRendered) return;
    // A kind of computer is the settings' device only where the line names that device too.
    const device = says.key === 'placement' ? this.#settings.placement.device : null;
    if (device && says.computer && !(says.tail === device || String(says.tail).startsWith(`${device}, `))) {
      add('conflicts-setting', `It says ${label} ${says.value} ${says.where}, but the controller settings ${says.value === current.value ? '' : `say ${current.value} and `}name the device ${device}: it may be another computer. Ask the owner which one stands, or change the settings on the owner's word; no fix is offered.`);
      return;
    }
    const fix = { action: 'replace', with: `${line.bullet}${current.body}` };
    if (says.value === current.value && (!says.tail || says.tail === current.tail)) add('repeats-setting', 'It says what the controller settings already say; the settings line replaces it.', fix);
    else add('conflicts-setting', `It says ${label} ${says.value}${says.tail ? ` (${says.tail})` : ''}, but the controller settings say ${current.value}${says.tail && current.tail ? ` (${current.tail})` : ''}. Replace it with the settings line, or change the settings on the owner's word.`, fix);
  }

  // Applies the fixes named by id, which must all be offered for the text as it is now; returns the
  // new text and what was applied. Never applies a fix that was not named.
  apply(text, ids) {
    const refused = require('./toolkit-controller-settings.cjs').refusedSession(this.#environment);
    if (refused) throw new LintError('LINT_ROLE', `${refused} cannot change the owner's lines: only the controller does, with the fixes the owner tapped.`);
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new LintError('LINT_ARGUMENTS', 'Name each fix the owner tapped once, with --fix.');
    const { lines, result: { findings } } = this.#read(text);
    const chosen = ids.map(id => findings.find(finding => finding.id === id && finding.fix));
    const missing = ids.filter((id, index) => !chosen[index]);
    if (missing.length) throw new LintError('LINT_STALE_FIX', `These fixes are not offered for the file and settings as they are now, so nothing was changed: ${missing.join(', ')}. Run check again and ask the owner again.`);
    let next = text;
    for (const finding of [...chosen].sort((a, b) => b.line - a.line)) {
      const { start, end, next: after } = lines.find(line => line.number === finding.line);
      next = finding.fix.action === 'delete' ? next.slice(0, start) + next.slice(after) : next.slice(0, start) + finding.fix.with + next.slice(end);
    }
    return { text: next, applied: chosen.map(finding => ({ id: finding.id, line: finding.line, action: finding.fix.action, text: finding.text })) };
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
    const key = { '--file': 'file', '--settings': 'settings', '--repository': 'repository', '--block': 'block', '--fix': 'fix' }[flag];
    if (!key || options[key] !== undefined || (key === 'fix' && command !== 'apply')) throw new LintError('LINT_ARGUMENTS', `Unknown or repeated flag ${flag}.`);
    options[key] = value;
  }
  if (!options.file) throw new LintError('LINT_ARGUMENTS', 'Name the file with --file.');
  if (options.repository && !options.settings) throw new LintError('LINT_ARGUMENTS', '--repository names whose --settings these must be.');
  if (options.block !== undefined && options.block !== 'projects') throw new LintError('LINT_ARGUMENTS', '--block takes projects.');
  if (command === 'apply' && !options.fix) throw new LintError('LINT_ARGUMENTS', 'apply needs --fix with the ids the owner tapped.');
  return options;
}

const USAGE = 'Usage: toolkit-owner-lines.cjs check|apply --file <file> [--settings <settings.json> [--repository <owner/name>]] [--block projects] [--fix <id,...>] [--json]';

function lintFor(options, { root, environment }) {
  const profiles = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'repo/contracts/controller-kernel/stack-registry-v3.json'), 'utf8')).profiles || {});
  let settings = null;
  let rendered = null;
  if (options.settings) {
    const { ControllerSettings } = require('./toolkit-controller-settings.cjs');
    rendered = new ControllerSettings({ file: options.settings, root, environment, profiles }).render();
    settings = rendered.settings;
    if (options.repository && settings.repository.toLowerCase() !== options.repository.toLowerCase()) throw new LintError('LINT_REPOSITORY', `These controller settings are for ${settings.repository}, not ${options.repository}, so nothing was read against them.`);
  }
  const blockBody = options.block === 'projects' ? fs.readFileSync(path.join(root, PROJECTS_BLOCK), 'utf8') : null;
  return { lint: new OwnerLineLint({ profiles, settings, rendered, blockBody, environment }), settings };
}

// The file's bytes and its text, which encodes back to the same bytes, or throws.
function readOwnerFile(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (error) { throw new LintError('LINT_UNREADABLE', `The file could not be read (${error.code || error.name}).`); }
  if (bytes.length > MAX_BYTES) throw new LintError('LINT_UNREADABLE', 'The file is over 1 MB, so its owner lines are not read.');
  try { return { bytes, text: STRICT_UTF8.decode(bytes) }; } catch { throw new LintError('LINT_UNREADABLE', 'The file is not valid UTF-8, so its owner lines are not read and nothing was changed. Save it as UTF-8 first.'); }
}

function report(result, settings) {
  const cut = finding => (finding.fix || finding.text.length <= 160 ? finding.text : `${finding.text.slice(0, 160)}...`);
  const lines = result.findings.map(finding => `line ${finding.line}: "${cut(finding)}" ${finding.message}${finding.fix ? ` Fix ${finding.id}: ${finding.fix.action === 'delete' ? 'remove this line' : `replace it with "${finding.fix.with}"`}.` : ''}`);
  if (result.unknown.length) lines.push(`Not read (no fix offered; the owner's own words): line${result.unknown.length === 1 ? '' : 's'} ${result.unknown.join(', ')}.`);
  if (!lines.length) lines.push('Nothing to fix.');
  if (settings) lines.push(`Read against the controller settings of ${settings.repository}.`);
  return lines;
}

const NEEDS_ATTENTION = new Set(['setting', 'conflicts-line', 'conflicts-setting']);

function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, environment = process.env, root = path.resolve(__dirname, '..', '..') } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { stderr.write(`${error.message}\n`); return 2; }
  try {
    const { lint, settings } = lintFor(options, { root, environment });
    const { bytes, text } = readOwnerFile(options.file);
    if (options.command === 'check') {
      const result = lint.check(text);
      stdout.write(options.json ? `${JSON.stringify(result)}\n` : `${report(result, settings).join('\n')}\n`);
      return result.findings.some(finding => finding.fix || NEEDS_ATTENTION.has(finding.kind)) ? 1 : 0;
    }
    const { text: next, applied } = lint.apply(text, options.fix.split(',').map(id => id.trim()).filter(Boolean));
    require('./toolkit-controller-settings.cjs').replaceFile(options.file, bytes, Buffer.from(next));
    stdout.write(options.json ? `${JSON.stringify({ applied })}\n` : `${[`Applied and read back: ${applied.map(entry => `${entry.id} (${entry.action === 'delete' ? 'removed' : 'replaced'} "${entry.text}")`).join(', ')}.`, ...report(lint.check(next), settings)].join('\n')}\n`);
    return 0;
  } catch (error) {
    const code = String((error && error.code) || '');
    stderr.write(/^(?:LINT|SETTINGS|FILE)_/.test(code) ? `${error.message}\n` : `Owner-line lint stopped on an unexpected problem (${code || error?.name || 'Error'}).${options.command === 'check' ? ' check writes nothing.' : ' Check the file before using it.'}\n`);
    return code === 'LINT_ARGUMENTS' || (options.command === 'check' && code !== 'LINT_MARKERS') ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ OwnerLineLint, blockOverlaps, words, main });
