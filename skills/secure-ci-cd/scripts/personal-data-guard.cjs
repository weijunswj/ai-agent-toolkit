#!/usr/bin/env node
'use strict';

// Personal-data guard: blocks email addresses, phone numbers and WhatsApp links before they are
// committed or pushed, and fails CI when one reaches the repository. Zero dependencies (Node and
// git only), so a repository can carry a copy of this one file.
//
// It never prints a matched value, any part of one, or a hash of one: every finding is a place
// (path, line, column, or a commit and field) plus a class and a rule ID. Any error that stops a
// complete scan exits 2 ("could not scan"), never 0.
//
// Modes:
//   staged                       staged changes (pre-commit hook)
//   message <file>               a commit message file (commit-msg hook)
//   pre-push <remote> [<url>]    refs on stdin as git gives them to the pre-push hook; commits
//                                already on that remote's tracking refs are not checked again
//   range <base>..<head>         every commit in the range (a reviewer's check of a PR)
//   range <head> --not <ref>     every commit reachable from head and not from ref
//   ci                           the GitHub Actions event in GITHUB_EVENT_PATH (pull_request, push)
//   pr                           pull request title and body from PDG_PR_TITLE and PDG_PR_BODY
//   tree [<rev>]                 every tracked file at rev (default HEAD), whole content
//   explain                      the rules, the declared scope and what is not scanned
// Options: --repo <dir> (default: current folder), --config <file> (default:
// <repo>/.github/personal-data-guard.json).
// Exit codes: 0 nothing found, 1 findings (blocked), 2 could not scan.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const GUARD_VERSION = 1;
const CONFIG_SCHEMA = 'personal-data-guard/v1';
const DEFAULT_CONFIG = path.join('.github', 'personal-data-guard.json');
const MAX_BLOB_BYTES = 25 * 1024 * 1024;
const MAX_INFLATED_BYTES = 50 * 1024 * 1024;
const ZERO_SHA = /^0+$/;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const RULES = Object.freeze({
  'PDG-EMAIL': { class: 'email', text: 'an email address' },
  'PDG-PHONE-E164': { class: 'phone', text: 'a phone number with a + country code' },
  'PDG-PHONE-SG': { class: 'phone', text: 'a Singapore number written as 65 and eight digits' },
  'PDG-WHATSAPP': { class: 'whatsapp-link', text: 'a wa.me, api.whatsapp.com/send, web.whatsapp.com/send or whatsapp://send link to a number' },
  'PDG-UNSCANNABLE': { class: 'unscannable', text: 'content this guard cannot read, not listed in not_scanned' },
  'PDG-ALLOW-NO-REASON': { class: 'allow-marker', text: 'an allow marker without a reason' },
});

// Gaps every run prints, whatever the config says.
const FIXED_GAPS = Object.freeze([
  'Singapore numbers written as eight digits with no 65 or +65 (too common in ordinary numbers to block on)',
  'Git LFS content (only the pointer is in git) and submodule contents',
  'images, legacy Office binaries (.doc, .xls, .ppt), archives and other binary files: reported as unscannable',
  'lines that were already present before the change (only introduced content is checked, except in tree mode)',
  'encoded content such as base64, and a value split across two lines',
]);

const ROLE_LOCAL_PARTS = new Set(['abuse', 'admin', 'billing', 'contact', 'enquiries', 'feedback', 'hello', 'help', 'hostmaster', 'info', 'legal', 'marketing', 'no-reply', 'noreply', 'notifications', 'postmaster', 'press', 'privacy', 'sales', 'security', 'support', 'team', 'webmaster']);
const RESERVED_SUFFIXES = ['.example', '.test', '.invalid', '.localhost', '.local', '.internal'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

const ALLOW_MARKER = /personal-data-guard:\s*allow\b(.*)$/i;

class GuardError extends Error {
  constructor(message) { super(message); this.name = 'GuardError'; }
}

// ---------------------------------------------------------------------------------------------
// Normalisation: separator and digit variants are folded before matching, and every folded
// character maps back to its column in the original line.

const SPACES = new Set([0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000]);
const DASHES = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFE58, 0xFE63]);
// Soft hyphen, zero-width characters, byte order mark and bidirectional marks.
const INVISIBLE = new Set([0x00AD, 0x061C, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF]);
// Percent-encoded and HTML-entity forms of the characters that make up an address or a number.
const PERCENT = Object.freeze({ '20': ' ', '28': '(', '29': ')', '2B': '+', '2D': '-', '2E': '.', '40': '@' });
const NAMED_ENTITIES = Object.freeze({ commat: '@', dash: '-', hyphen: '-', lpar: '(', nbsp: ' ', period: '.', plus: '+', rpar: ')' });
const ENTITY = /^&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]{2,8}));/i;
const NEEDS_FOLDING = /[^\x00-\x7F]|%[0-9a-f]{2}|&#?\w+;/i;

function foldChar(char) {
  const code = char.codePointAt(0);
  if (INVISIBLE.has(code)) return '';
  if (SPACES.has(code)) return ' ';
  if (DASHES.has(code)) return '-';
  if (code >= 0xFF01 && code <= 0xFF5E) return String.fromCharCode(code - 0xFEE0);
  return char;
}

function normalise(line) {
  if (!NEEDS_FOLDING.test(line)) return { text: line, map: null };
  let text = '';
  const map = [];
  let index = 0;
  while (index < line.length) {
    let folded;
    let width = 0;
    const char = line[index];
    if (char === '%') {
      const replacement = PERCENT[line.slice(index + 1, index + 3).toUpperCase()];
      if (replacement !== undefined) { folded = replacement; width = 3; }
    } else if (char === '&') {
      const entity = ENTITY.exec(line.slice(index, index + 12));
      if (entity) {
        const code = entity[1] ? parseInt(entity[1], 16) : entity[2] ? parseInt(entity[2], 10) : null;
        if (code !== null && code <= 0x10FFFF) { folded = foldChar(String.fromCodePoint(code)); width = entity[0].length; }
        else if (entity[3] && NAMED_ENTITIES[entity[3].toLowerCase()] !== undefined) { folded = NAMED_ENTITIES[entity[3].toLowerCase()]; width = entity[0].length; }
      }
    }
    if (folded === undefined) {
      const whole = String.fromCodePoint(line.codePointAt(index));
      folded = foldChar(whole);
      width = whole.length;
    }
    for (let at = 0; at < folded.length; at += 1) { text += folded[at]; map.push(index); }
    index += width;
  }
  map.push(line.length);
  return { text, map };
}

// ---------------------------------------------------------------------------------------------
// Detectors. Each returns { rule, start, end } spans on the normalised text. False positives are
// handled here, by pattern, never by skipping a file or an extension.

const EMAIL = /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}._%+-]+)@((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59}))(?![\p{L}\p{N}-])/giu;
const E164 = /(?<![\p{N}_.+])\+[1-9](?:[ ().-]{0,2}\d){7,14}(?!\p{N})/gu;
const SG = /(?<![A-Za-z\p{N}_.+-])(?:(?:\+|00)?65|\(\+?65\))[ .-]{0,2}[3689]\d{3}[ .-]{0,2}\d{4}(?![A-Za-z\p{N}_])/gu;
const WHATSAPP = /\b(?:wa\.me\/\+?\d{6,}|(?:(?:api|web)\.whatsapp\.com\/send\/?|whatsapp:\/\/send\/?)\?(?:[^\s"'<>&]*&){0,20}phone=\+?\d{6,})/giu;
const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@]*$/i;
const LOOKBACK = 2048;

function reservedDomain(domain) {
  const lower = domain.toLowerCase();
  if (RESERVED_DOMAINS.some((name) => lower === name || lower.endsWith(`.${name}`))) return true;
  return RESERVED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

// Why an email-shaped match is not an address, or null when it is one.
function emailNotAddress(text, match) {
  const start = match.index;
  let local = match[1];
  const domain = match[2];
  const end = start + match[0].length;
  // An escape such as \n written in source text before the @.
  if (start > 0 && text[start - 1] === '\\') local = local.slice(1);
  if (!local) return 'escape';
  if (reservedDomain(domain)) return 'reserved-domain';
  // scp-style remotes: git@host:owner/repo, deploy@host:/srv/app.
  const after = text.slice(end, end + 256);
  if (after.startsWith(':') && (local === 'git' || /^:[\w~.-]*\//.test(after))) return 'ssh-remote';
  // user@host straight after the // of a URL.
  const token = text.slice(Math.max(0, start - LOOKBACK), start).split(/[\s"'<>(]/).pop();
  if (URL_USERINFO.test(token)) return 'url-userinfo';
  // SQL LIKE patterns such as '%@host'.
  if (/^[%_]+$/.test(local)) return 'pattern';
  const labels = domain.split('.');
  const top = labels[labels.length - 1];
  // Code tokens: a camelCase "top-level domain" (options.instructionFiles), a receiver such as
  // self.weights after a matrix-multiply @, or a method call (key.transpose(...)).
  if (/^\p{Ll}+\p{Lu}/u.test(top)) return 'code-token';
  if (labels.length === 2 && /^(?:self|this|cls|super)$/.test(labels[0])) return 'code-token';
  if (after.startsWith('(')) return 'code-token';
  // Retina asset names (logo@2x.png) and version specs (pkg@1.0.0-rc.beta).
  if (/^\d+(?:\.\d+)?x$/i.test(labels[0])) return 'asset-name';
  if (/^\d+$/.test(labels[0]) && labels.length >= 3 && /^\d/.test(labels[1])) return 'version';
  // Single-letter placeholders such as a@b.com.
  if (local.length === 1 && labels.length === 2 && labels[0].length === 1) return 'placeholder';
  return null;
}

// Why a +digits match is not a phone number, or null when it is one.
function e164NotPhone(value) {
  if (/^\+\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  if (/^\+\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return 'ip-address';
  return null;
}

function detect(text) {
  const spans = [];
  for (const match of text.matchAll(WHATSAPP)) spans.push({ rule: 'PDG-WHATSAPP', start: match.index, end: match.index + match[0].length });
  for (const match of text.matchAll(EMAIL)) {
    if (emailNotAddress(text, match)) continue;
    spans.push({ rule: 'PDG-EMAIL', start: match.index, end: match.index + match[0].length, value: match[0] });
  }
  for (const match of text.matchAll(E164)) {
    if (e164NotPhone(match[0])) continue;
    spans.push({ rule: 'PDG-PHONE-E164', start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(SG)) spans.push({ rule: 'PDG-PHONE-SG', start: match.index, end: match.index + match[0].length });
  // One finding per place: a number inside a WhatsApp link or an E.164 match is not reported again.
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  let reach = -1;
  for (const span of spans) {
    if (span.start < reach) continue;
    kept.push(span);
    reach = span.end;
  }
  return kept;
}

// A piece of outside text (a config string, an argument, a path) as it may be shown: withheld
// when it carries anything the guard would report.
function shown(value) {
  const text = String(value);
  return detect(normalise(text).text).length ? '(withheld: it contains personal data)' : text;
}

// ---------------------------------------------------------------------------------------------
// Config.

function readConfig(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { throw new GuardError(`the config file ${shown(file)} could not be read; run the installer or add it`); }
  return parseConfig(raw, shown(file));
}

function parseConfig(raw, name) {
  let config;
  // JSON.parse errors quote the input, so the message is never shown.
  try { config = JSON.parse(raw.replace(/^﻿/, '')); }
  catch { throw new GuardError(`the config file ${name} is not valid JSON`); }
  return validateConfig(config, name);
}

function validateConfig(config, file = 'config') {
  const problem = (text) => { throw new GuardError(`${file}: ${text}`); };
  // Reasons and paths are printed in every report, so they must not carry personal data.
  const printable = (value, what) => { if (detect(normalise(value).text).length) problem(`${what} contains personal data; reword it`); };
  if (!config || typeof config !== 'object' || Array.isArray(config)) problem('must be a JSON object');
  if (config.schema !== CONFIG_SCHEMA) problem(`schema must be ${CONFIG_SCHEMA}`);
  const scope = config.scope;
  const scopeKeys = ['file_content', 'paths', 'commit_messages', 'branch_names', 'pull_request_text'];
  if (!scope || typeof scope !== 'object') problem('scope is required');
  for (const key of scopeKeys) if (typeof scope[key] !== 'boolean') problem(`scope.${key} must be true or false`);
  for (const key of Object.keys(scope)) if (!scopeKeys.includes(key)) problem(`scope.${shown(key)} is not a known scope`);
  if (!['excluded', 'included'].includes(config.identity)) problem('identity must be "excluded" or "included" (the owner\'s explicit choice for author and committer addresses)');
  if (config.identity === 'excluded' && !nonEmpty(config.identity_reason)) problem('identity_reason is required when identity is "excluded"');
  if (typeof config.identity_reason === 'string') printable(config.identity_reason, 'identity_reason');
  const allow = config.allow === undefined ? [] : config.allow;
  if (!Array.isArray(allow)) problem('allow must be a list');
  const allowed = new Set();
  for (const entry of allow) {
    if (!entry || typeof entry.value !== 'string' || !nonEmpty(entry.reason)) problem('each allow entry needs a value and a reason');
    printable(entry.reason, 'an allow reason');
    const value = entry.value.trim().toLowerCase();
    const match = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(value);
    if (!match || !ROLE_LOCAL_PARTS.has(match[1])) problem('allow entries must be plain public role addresses (for example security@ or noreply@); use an inline allow marker with a reason for anything else');
    allowed.add(value);
  }
  const notScanned = config.not_scanned === undefined ? [] : config.not_scanned;
  if (!Array.isArray(notScanned)) problem('not_scanned must be a list');
  for (const entry of notScanned) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim() || !nonEmpty(entry.reason)) problem('each not_scanned entry needs a path and a reason');
    printable(entry.path, 'a not_scanned path');
    printable(entry.reason, 'a not_scanned reason');
  }
  if (!['validate', 'personal-data', 'none'].includes(config.required_check)) problem('required_check must be "validate", "personal-data" or "none" (record the decision)');
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    identity: config.identity,
    identityReason: config.identity_reason || '',
    allowed,
    notScanned: notScanned.map((entry) => ({ path: entry.path.trim(), reason: entry.reason.trim(), pattern: globPattern(entry.path.trim()) })),
    requiredCheck: config.required_check,
  });
}

function nonEmpty(value) { return typeof value === 'string' && value.trim().length >= 3; }

// The config as committed at a base commit, or null when that commit has none.
function configAt(git, commit, relative) {
  const bytes = git.run(['cat-file', 'blob', `${commit}:${relative}`], { allowFailure: true });
  return bytes === null ? null : parseConfig(bytes.toString('utf8'), "the base commit's config");
}

// A change can carry its own config. What the change switches off does not apply to its own
// check: the base commit's scope and identity choice stay in force until the change is merged.
// Allow and not_scanned entries the change adds do apply, and every run names them.
function withBaseConfig(head, base, note) {
  if (!base) {
    note('the base commit has no guard config (first adoption), so the config in the change was used');
    return head;
  }
  const scope = {};
  const kept = [];
  for (const [key, on] of Object.entries(head.scope)) {
    scope[key] = on || base.scope[key];
    if (!on && base.scope[key]) kept.push(key.replace(/_/g, ' '));
  }
  let { identity, identityReason } = head;
  if (base.identity === 'included' && identity !== 'included') {
    identity = 'included';
    identityReason = '';
    kept.push('author and committer addresses');
  }
  if (kept.length) note(`the change switches off ${kept.join(', ')}; the base commit's setting was used for this check`);
  const added = [...head.allowed].filter((value) => !base.allowed.has(value)).length;
  if (added) note(`the change adds ${added} allowed role address(es) to the config`);
  for (const entry of head.notScanned) {
    if (!base.notScanned.some((old) => old.path === entry.path)) note(`the change adds ${entry.path} to not_scanned: ${entry.reason}`);
  }
  if (head.requiredCheck !== base.requiredCheck) note(`the change sets required_check to ${head.requiredCheck} (was ${base.requiredCheck})`);
  return Object.freeze({ ...head, scope: Object.freeze(scope), identity, identityReason });
}

// not_scanned paths: exact paths, * within one folder, ** across folders.
function globPattern(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') { source += '.*'; index += 1; }
    else if (char === '*') source += '[^/]*';
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

// ---------------------------------------------------------------------------------------------
// Content decoding: text, OOXML and PDF. Anything else binary is unscannable.

const OOXML_EXTENSIONS = new Set(['.docx', '.docm', '.dotx', '.xlsx', '.xlsm', '.xltx', '.pptx', '.pptm', '.potx']);

// Returns { parts: [{ label, text }], unscannable: [reason] }.
function decodeContent(filePath, bytes) {
  if (bytes.length > MAX_BLOB_BYTES) return { parts: [], unscannable: ['larger than the 25 MB scan limit'] };
  const ext = path.posix.extname(filePath).toLowerCase();
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    if (OOXML_EXTENSIONS.has(ext)) return decodeOoxml(bytes);
    return { parts: [], unscannable: ['zip archive'] };
  }
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return decodePdf(bytes);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))) {
    return { parts: [], unscannable: ['legacy Office binary'] };
  }
  const text = decodeText(bytes);
  if (text === null) return { parts: [], unscannable: ['binary file'] };
  if (text.startsWith('version https://git-lfs.github.com/spec/v1')) return { parts: [], unscannable: ['Git LFS pointer (content is stored outside git)'] };
  return { parts: [{ label: null, text }], unscannable: [] };
}

// Control characters other than tab, line breaks and form feed, or replacement characters, in
// decoded UTF-16: the bytes only started like a byte order mark.
const NOT_TEXT = /[\u0000-\u0008\u000E-\u001F\uFFFD]/;

function decodeText(bytes) {
  let utf16 = null;
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) utf16 = bytes.subarray(2, bytes.length - (bytes.length % 2)).toString('utf16le');
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    utf16 = Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2))).swap16().toString('utf16le');
  }
  if (utf16 !== null) return NOT_TEXT.test(utf16) ? null : utf16;
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return null;
  return bytes.toString('utf8').replace(/^﻿/, '');
}

function readZip(bytes) {
  // The end record is the one whose comment runs exactly to the end of the file; a signature
  // inside the comment is not it.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0) throw new GuardError('zip end record missing');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || offset === 0xFFFFFFFF) throw new GuardError('zip64 archive');
  const entries = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new GuardError('zip directory damaged');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new GuardError('encrypted zip entry');
    if (bytes.readUInt32LE(local) !== 0x04034b50) throw new GuardError('zip entry damaged');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + compressed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_INFLATED_BYTES });
    else throw new GuardError('unsupported zip compression');
    total += data.length;
    if (total > MAX_INFLATED_BYTES) throw new GuardError('zip content over the scan limit');
    entries.push({ name, data });
  }
  return entries;
}

const XML_BREAK = /<\/(?:w:p|a:p|si|c|row|p|text:p|Relationship)>|<(?:w:br|w:tab|w:cr|a:br)\b[^>]*\/?>|<Relationship\b/g;

function xmlEntities(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (whole, hex, dec, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
  });
}

// Splits XML into its text and its markup. Text runs are joined with nothing between them, so a
// value split across runs is matched whole, and paragraph-like ends become line breaks. CDATA is
// text. Tags (with their attribute values, such as hyperlink targets), comments and processing
// instructions are the markup, one per line. The result is only scanned, never rendered.
function xmlText(xml) {
  const source = xml.replace(XML_BREAK, '\n');
  let body = '';
  const markup = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) { body += source.slice(index); break; }
    body += source.slice(index, open);
    let close;
    if (source.startsWith('<![CDATA[', open)) {
      close = source.indexOf(']]>', open);
      body += source.slice(open + 9, close < 0 ? source.length : close);
      index = close < 0 ? source.length : close + 3;
      continue;
    }
    if (source.startsWith('<!--', open)) {
      close = source.indexOf('-->', open);
      markup.push(source.slice(open + 4, close < 0 ? source.length : close));
      index = close < 0 ? source.length : close + 3;
      continue;
    }
    // A tag ends at the first > outside a quoted attribute value.
    let quote = null;
    close = open + 1;
    while (close < source.length && (quote || source[close] !== '>')) {
      if (quote && source[close] === quote) quote = null;
      else if (!quote && (source[close] === '"' || source[close] === "'")) quote = source[close];
      close += 1;
    }
    markup.push(source.slice(open + 1, close));
    index = close + 1;
  }
  return { body: xmlEntities(body), markup: xmlEntities(markup.join('\n')) };
}

function decodeOoxml(bytes) {
  let entries;
  try { entries = readZip(bytes); }
  catch (error) { return { parts: [], unscannable: [error instanceof GuardError ? error.message : 'zip could not be read'] }; }
  const parts = [];
  const unscannable = [];
  // Entries are read by what they hold, not by their names: XML parts as text and markup, other
  // text (an embedded .txt, .csv or .htm) as is, and anything else (images, thumbnails, embedded
  // objects) is unscannable.
  entries.forEach((entry, index) => {
    const label = detect(normalise(entry.name).text).length ? `entry #${index + 1}` : entry.name;
    const text = decodeText(entry.data);
    if (text === null || NOT_TEXT.test(text.slice(0, 8000))) {
      unscannable.push(`embedded binary ${label}`);
    } else if (/^\s*<(?:\?xml|[\w:]+[\s>/])/.test(text) && !/\.(?:html?|mht|txt|csv)$/i.test(entry.name)) {
      const { body, markup } = xmlText(text);
      parts.push({ label, text: body });
      parts.push({ label: `${label} markup`, text: markup });
    } else {
      parts.push({ label, text });
    }
  });
  return { parts, unscannable };
}

const PDF_IMAGE_FILTERS = new Set(['DCTDecode', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode']);

const TEXT_LINE_OPERATORS = new Set(['Td', 'TD', 'T*', 'Tm', 'BT', 'ET', "'", '"']);

// A PDF string's bytes as text: UTF-16BE when it starts with a byte order mark, else Latin-1.
function pdfString(bytes) {
  if (bytes.length >= 2 && bytes.charCodeAt(0) === 0xFE && bytes.charCodeAt(1) === 0xFF) {
    const body = Buffer.from(bytes.slice(2, bytes.length - (bytes.length % 2)), 'latin1');
    return body.swap16().toString('utf16le');
  }
  return bytes;
}

function pdfStrings(content) {
  // Literal strings ( ... ) with escapes, and hex strings < ... >, in drawing order. Pieces of
  // one TJ array are joined with nothing between them.
  const pieces = [];
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (char === '(') {
      let depth = 1; let text = ''; index += 1;
      while (index < content.length && depth > 0) {
        const c = content[index];
        if (c === '\\') {
          const next = content[index + 1];
          const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
          if (next in escapes) { text += escapes[next]; index += 2; continue; }
          const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1, index + 4));
          if (octal) { text += String.fromCharCode(parseInt(octal[0], 8)); index += 1 + octal[0].length; continue; }
          index += 2; continue;
        }
        if (c === '(') depth += 1;
        if (c === ')') { depth -= 1; if (depth === 0) { index += 1; break; } }
        text += c; index += 1;
      }
      pieces.push(pdfString(text));
    } else if (char === '<' && content[index + 1] !== '<') {
      const end = content.indexOf('>', index);
      if (end < 0) break;
      const hex = content.slice(index + 1, end).replace(/\s+/g, '');
      if (/^[0-9a-f]*$/i.test(hex)) pieces.push(pdfString(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('latin1')));
      index = end + 1;
    } else if (/[A-Za-z'"*]/.test(char)) {
      // Operators that move to a new line or end a text object end the current line of text.
      const word = /^[A-Za-z'"*]+/.exec(content.slice(index, index + 8))[0];
      if (TEXT_LINE_OPERATORS.has(word)) pieces.push('\n');
      index += word.length;
    } else {
      index += 1;
    }
  }
  return pieces.join('');
}

// The dictionary written straight before a stream keyword, found by balancing << and >>.
function dictionaryBefore(latin, at) {
  let end = at;
  while (end > 0 && /\s/.test(latin[end - 1])) end -= 1;
  if (latin.slice(end - 2, end) !== '>>') return '';
  let depth = 0;
  for (let index = end - 2; index >= 1; index -= 1) {
    if (latin[index] === '>' && latin[index + 1] === '>') { depth += 1; index -= 1; }
    else if (latin[index - 1] === '<' && latin[index] === '<') {
      depth -= 1;
      if (depth === 0) return latin.slice(index - 1, end);
      index -= 1;
    }
  }
  return '';
}

// Glyph IDs in fonts with an Identity encoding cannot be read back as text without the font's
// own mapping, which this guard does not apply.
const PDF_IDENTITY_FONT = /\/Encoding\s*\/Identity-[HV]\b/;

function pdfFilters(dict) {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/[\w.]+)/.exec(dict);
  return filter ? [...filter[1].matchAll(/\/([\w.]+)/g)].map((item) => item[1]) : [];
}

function pdfDecode(raw, filters) {
  let data = raw;
  for (const name of filters) {
    if (name === 'ASCIIHexDecode' || name === 'AHx') {
      const hex = data.toString('latin1').split('>')[0].replace(/\s+/g, '');
      if (!/^[0-9a-f]*$/i.test(hex)) return null;
      data = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
    } else if (name === 'FlateDecode' || name === 'Fl') {
      try { data = zlib.inflateSync(data, { maxOutputLength: MAX_INFLATED_BYTES }); }
      catch {
        try { data = zlib.inflateSync(data.subarray(0, data.length - 1), { maxOutputLength: MAX_INFLATED_BYTES }); }
        catch { return null; }
      }
    } else {
      return null;
    }
  }
  return data;
}

function decodePdf(bytes) {
  const latin = bytes.toString('latin1');
  if (/\/Encrypt\b/.test(latin)) return { parts: [], unscannable: ['encrypted PDF'] };
  const parts = [];
  const unscannable = [];
  let imageStreams = 0;
  let streams = 0;
  let identityFonts = false;
  const outside = [];
  let last = 0;
  const STREAM = /stream\r?\n/g;
  let match;
  while ((match = STREAM.exec(latin))) {
    // Balanced first; when that fails (a hex string right before >>), everything since the obj keyword.
    const objectStart = latin.lastIndexOf(' obj', match.index);
    const dict = dictionaryBefore(latin, match.index) || (objectStart >= 0 ? latin.slice(objectStart, match.index) : '');
    const dataStart = match.index + match[0].length;
    const end = latin.indexOf('endstream', dataStart);
    if (end < 0) { unscannable.push('PDF stream without an end'); break; }
    outside.push(latin.slice(last, match.index));
    last = end + 'endstream'.length;
    STREAM.lastIndex = last;
    if (!dict) { unscannable.push('PDF stream whose dictionary could not be read'); continue; }
    const filters = pdfFilters(dict);
    if (filters.some((name) => PDF_IMAGE_FILTERS.has(name)) || /\/Subtype\s*\/Image\b/.test(dict)) { imageStreams += 1; continue; }
    const data = pdfDecode(bytes.subarray(dataStart, end), filters);
    if (data === null) { unscannable.push(`PDF stream with ${filters.join('+')} that could not be decoded`); continue; }
    const content = data.toString('latin1');
    if (PDF_IDENTITY_FONT.test(content)) identityFonts = true;
    streams += 1;
    // A page content stream is read as its drawn text; any other stream (metadata, form data) as is.
    parts.push({ label: `stream ${streams}`, text: /\bBT\b/.test(content) ? pdfStrings(content) : content });
  }
  outside.push(latin.slice(last));
  const objects = outside.join('\n');
  if (PDF_IDENTITY_FONT.test(objects)) identityFonts = true;
  parts.push({ label: 'objects', text: `${pdfStrings(objects)}\n${objects}` });
  if (imageStreams) unscannable.push(`${imageStreams} PDF image stream(s)`);
  if (identityFonts) unscannable.push('PDF text in fonts with an Identity encoding (glyph IDs, not readable text)');
  return { parts, unscannable };
}

// ---------------------------------------------------------------------------------------------
// Line-level scanning.

function splitLines(text) { return text.split(/\r\n|\n|\r/); }

function lineCounts(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

// Lines of `lines` that are new: a line counts as introduced when it occurs more often than in
// every earlier version (the parent, and for a merge every other parent too). The later
// occurrences are the ones reported.
function introducedLines(lines, previousVersions) {
  if (!previousVersions.length) return lines.map((_, index) => index);
  const limits = new Map();
  for (const previous of previousVersions) {
    for (const [line, count] of lineCounts(previous)) limits.set(line, Math.max(limits.get(line) || 0, count));
  }
  const seen = new Map();
  const introduced = [];
  lines.forEach((line, index) => {
    const count = (seen.get(line) || 0) + 1;
    seen.set(line, count);
    if (count > (limits.get(line) || 0)) introduced.push(index);
  });
  return introduced;
}

// ---------------------------------------------------------------------------------------------
// Git access.

class GitReader {
  #repo; #spawn;

  constructor(repo, { spawn = spawnSync } = {}) {
    this.#repo = repo;
    this.#spawn = spawn;
  }

  // Runs git; a failure names the subcommand and exit code only, never git's own error text
  // (which can quote paths or content).
  run(args, { input, allowFailure = false } = {}) {
    const result = this.#spawn('git', args, {
      cwd: this.#repo, input: input === undefined ? undefined : Buffer.from(input, 'utf8'), encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    if (result.error) throw new GuardError(`git ${args[0]} could not start`);
    if (result.status !== 0) {
      if (allowFailure) return null;
      throw new GuardError(`git ${args[0]} failed (exit ${result.status})`);
    }
    return result.stdout;
  }

  text(args, options) {
    const out = this.run(args, options);
    return out === null ? null : out.toString('utf8');
  }

  commitExists(rev) { return this.run(['cat-file', '-e', `${rev}^{commit}`], { allowFailure: true }) !== null; }

  resolve(rev) {
    const out = this.text(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFailure: true });
    return out === null ? null : out.trim();
  }

  objectType(sha) {
    const out = this.text(['cat-file', '-t', sha], { allowFailure: true });
    return out === null ? null : out.trim();
  }

  emptyTree() { return this.text(['hash-object', '-t', 'tree', '--stdin'], { input: '' }).trim(); }

  revList(args) {
    const out = this.text(['rev-list', '--topo-order', '--reverse', ...args, '--']);
    return out.split('\n').filter(Boolean);
  }

  parents(commit) {
    const line = this.text(['rev-list', '--parents', '-n', '1', commit, '--']).trim().split(' ');
    return line.slice(1);
  }

  // Raw changes: [{ status, oldMode, newMode, oldSha, newSha, path, oldPath }].
  diffTree(args) { return parseRaw(this.run(args)); }

  // sha -> Buffer for every blob asked for; a missing blob is an error.
  blobs(shas) {
    const wanted = [...new Set(shas)];
    const found = new Map();
    if (!wanted.length) return found;
    const out = this.run(['cat-file', '--batch'], { input: `${wanted.join('\n')}\n` });
    let at = 0;
    for (const sha of wanted) {
      const newline = out.indexOf(10, at);
      const header = out.subarray(at, newline).toString('utf8').split(' ');
      if (header[1] === 'missing' || header.length < 3) throw new GuardError('a blob in the change could not be read');
      const size = Number(header[2]);
      const start = newline + 1;
      found.set(sha, out.subarray(start, start + size));
      at = start + size + 1;
    }
    return found;
  }

  catFile(type, sha) { return this.run(['cat-file', type, sha]); }
}

function parseRaw(buffer) {
  const fields = buffer.toString('utf8').split('\0');
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const meta = fields[index];
    if (!meta) { index += 1; continue; }
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/.exec(meta);
    if (!match) throw new GuardError('git diff output could not be read');
    const [, oldMode, newMode, oldSha, newSha, status] = match;
    if (status === 'R' || status === 'C') {
      changes.push({ status, oldMode, newMode, oldSha, newSha, oldPath: fields[index + 1], path: fields[index + 2] });
      index += 3;
    } else {
      changes.push({ status, oldMode, newMode, oldSha, newSha, oldPath: fields[index + 1], path: fields[index + 1] });
      index += 2;
    }
  }
  return changes;
}

// The message part of a commit or tag object, its identity lines (name, address and date), and
// for a tag the object it points to.
function splitObject(buffer) {
  const text = buffer.toString('utf8');
  const blank = text.indexOf('\n\n');
  const headers = blank < 0 ? text : text.slice(0, blank);
  const message = blank < 0 ? '' : text.slice(blank + 2);
  const identities = [];
  let target = null;
  for (const line of headers.split('\n')) {
    const match = /^(author|committer|tagger) (.*)$/.exec(line);
    if (match) identities.push({ field: match[1], line: match[2] });
    const object = /^object ([0-9a-f]+)$/.exec(line);
    if (object) target = object[1];
  }
  return { message, identities, target };
}

// ---------------------------------------------------------------------------------------------
// The scan: one owner for the findings, notes and counts of a run.

class PersonalDataGuard {
  #config; #git; #findings = []; #notes = []; #allowMarkers = 0; #listedGaps = new Map();
  #counts = { commits: 0, files: 0, messages: 0, texts: 0 };
  #pathIds = new Map();

  constructor({ config, git }) {
    this.#config = config;
    this.#git = git;
  }

  get findings() { return this.#findings; }

  note(text) { this.#notes.push(text); }

  // Scans lines of one text. `place` describes where it came from without its content; `only` is
  // the set of line indexes to check (null: all).
  scanText(place, text, only = null) {
    const lines = splitLines(text);
    const indexes = only || lines.map((_, index) => index);
    for (const index of indexes) {
      const original = lines[index];
      if (original === undefined || original === '') continue;
      const { text: folded, map } = normalise(original);
      const spans = detect(folded);
      if (!spans.length) continue;
      const marker = ALLOW_MARKER.exec(folded);
      for (const span of spans) {
        if (span.rule === 'PDG-EMAIL' && this.#config.allowed.has(span.value.toLowerCase())) continue;
        const column = (map ? map[span.start] : span.start) + 1;
        if (marker) {
          if (nonEmpty(marker[1].replace(/^[\s:-]+/, ''))) { this.#allowMarkers += 1; continue; }
          this.#add(place, index + 1, column, 'PDG-ALLOW-NO-REASON');
          continue;
        }
        this.#add(place, index + 1, column, span.rule);
      }
    }
    this.#counts.texts += 1;
  }

  #add(place, line, column, rule) {
    this.#findings.push({ place, line, column, rule, class: RULES[rule].class });
  }

  // A path is shown in output only when it carries nothing the guard would report.
  placeForPath(filePath, prefix = '') {
    if (!detect(normalise(filePath).text).length) return `${prefix}${filePath}`;
    if (!this.#pathIds.has(filePath)) this.#pathIds.set(filePath, this.#pathIds.size + 1);
    return `${prefix}path #${this.#pathIds.get(filePath)} (name withheld)`;
  }

  scanPath(filePath, prefix) {
    if (!this.#config.scope.paths) return;
    const { text } = normalise(filePath);
    for (const span of detect(text)) this.#add(this.placeForPath(filePath, prefix), 1, span.start + 1, span.rule);
  }

  scanRefName(ref, label) {
    if (!this.#config.scope.branch_names || !ref) return;
    const { text } = normalise(ref);
    for (const span of detect(text)) this.#add(label, 1, span.start + 1, span.rule);
  }

  scanMessage(place, message) {
    if (!this.#config.scope.commit_messages) return;
    this.#counts.messages += 1;
    this.scanText(place, message);
  }

  scanIdentities(place, identities) {
    if (this.#config.identity !== 'included') return;
    for (const identity of identities) {
      const { text } = normalise(identity.line);
      for (const span of detect(text)) {
        if (span.rule === 'PDG-EMAIL' && this.#config.allowed.has(span.value.toLowerCase())) continue;
        this.#add(`${place} ${identity.field}`, 1, 1, span.rule);
      }
    }
  }

  #listed(filePath) { return this.#config.notScanned.find((entry) => entry.pattern.test(filePath)); }

  // One file version. previous: earlier versions (Buffers) of the same file to diff against.
  scanFile(filePath, bytes, previous, prefix = '') {
    if (!this.#config.scope.file_content) return;
    this.#counts.files += 1;
    const place = this.placeForPath(filePath, prefix);
    const decoded = decodeContent(filePath, bytes);
    const before = previous.map((buffer) => decodeContent(filePath, buffer));
    decoded.parts.forEach((part, index) => {
      const lines = splitLines(part.text);
      const earlier = before.map((version) => {
        const match = version.parts.find((other) => other.label === part.label) || version.parts[index];
        return match ? splitLines(match.text) : [];
      });
      const label = part.label ? `${place}!${part.label}` : place;
      this.scanText(label, part.text, introducedLines(lines, earlier));
    });
    if (decoded.unscannable.length) {
      const listed = this.#listed(filePath);
      if (listed) this.#listedGaps.set(place, `${place}: ${decoded.unscannable.join('; ')} (listed: ${listed.reason})`);
      else this.#add(place, 0, 0, 'PDG-UNSCANNABLE');
    }
  }

  // Every change in one diff: new and renamed paths, and introduced content.
  scanChanges(changes, blobReader, prefix, otherParentChanges = null) {
    const wanted = [];
    for (const change of changes) {
      if (change.status === 'D') continue;
      if (change.newMode === '160000') {
        const place = this.placeForPath(change.path, prefix);
        if (this.#listed(change.path)) this.#listedGaps.set(place, `${place}: submodule (listed)`);
        else this.#add(place, 0, 0, 'PDG-UNSCANNABLE');
        continue;
      }
      if (ZERO_SHA.test(change.newSha)) continue;
      wanted.push(change.newSha);
      if (!ZERO_SHA.test(change.oldSha) && change.oldMode !== '160000') wanted.push(change.oldSha);
    }
    if (otherParentChanges) for (const changesOfParent of otherParentChanges) for (const change of changesOfParent.values()) if (!ZERO_SHA.test(change.oldSha) && change.oldMode !== '160000') wanted.push(change.oldSha);
    const blobs = blobReader(wanted);
    for (const change of changes) {
      if (change.status === 'D' || change.newMode === '160000' || ZERO_SHA.test(change.newSha)) continue;
      if (otherParentChanges && otherParentChanges.some((byPath) => !byPath.has(change.path))) continue;
      if (['A', 'R', 'C'].includes(change.status)) this.scanPath(change.path, prefix);
      const previous = [];
      if (!ZERO_SHA.test(change.oldSha) && change.oldMode !== '160000') previous.push(blobs.get(change.oldSha));
      if (otherParentChanges) {
        for (const byPath of otherParentChanges) {
          const other = byPath.get(change.path);
          if (other && !ZERO_SHA.test(other.oldSha) && other.oldMode !== '160000') previous.push(blobs.get(other.oldSha));
        }
      }
      this.scanFile(change.path, blobs.get(change.newSha), previous, prefix);
    }
  }

  scanCommit(commit) {
    const git = this.#git;
    this.#counts.commits += 1;
    const short = commit.slice(0, 12);
    const prefix = `commit ${short} `;
    const { message, identities } = splitObject(git.catFile('commit', commit));
    this.scanMessage(`commit ${short} message`, message);
    this.scanIdentities(`commit ${short}`, identities);
    const parents = git.parents(commit);
    const base = ['diff-tree', '-r', '-z', '--raw', '--no-abbrev', '--no-commit-id', '-M', '--no-ext-diff', '--no-textconv'];
    if (!parents.length) {
      this.scanChanges(git.diffTree([...base, '--root', commit]), (shas) => git.blobs(shas), prefix);
      return;
    }
    const changes = git.diffTree([...base, parents[0], commit]);
    let others = null;
    if (parents.length > 1) {
      others = parents.slice(1).map((parent) => new Map(git.diffTree([...base, '--no-renames', parent, commit]).map((change) => [change.path, change])));
    }
    this.scanChanges(changes, (shas) => git.blobs(shas), prefix, others);
  }

  scanCommits(commits) {
    const seen = new Set();
    for (const commit of commits) {
      if (seen.has(commit)) continue;
      seen.add(commit);
      this.scanCommit(commit);
    }
  }

  scanStaged() {
    const git = this.#git;
    const head = git.resolve('HEAD') || git.emptyTree();
    const changes = git.diffTree(['diff-index', '--cached', '-z', '--raw', '--no-abbrev', '-M', head]);
    this.scanChanges(changes, (shas) => git.blobs(shas), 'staged ');
  }

  scanTree(rev) {
    const git = this.#git;
    const commit = git.resolve(rev);
    if (!commit) throw new GuardError('the revision to scan was not found');
    const entries = git.run(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean);
    const changes = entries.map((entry) => {
      const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(entry);
      if (!match) throw new GuardError('git ls-tree output could not be read');
      return { status: 'A', oldMode: '000000', newMode: match[1], oldSha: '0'.repeat(match[3].length), newSha: match[3], path: match[4] };
    });
    const batch = 500;
    for (let index = 0; index < changes.length; index += batch) this.scanChanges(changes.slice(index, index + batch), (shas) => git.blobs(shas), '');
  }

  // Scans an annotated tag (and any tag it points to) and returns the commit it ends at. A tag of
  // a tree or a blob cannot be checked as a change, so it stops the scan.
  peelTag(sha) {
    let current = sha;
    for (let depth = 0; depth < 10; depth += 1) {
      const type = this.#git.objectType(current);
      if (type === 'commit') return current;
      if (type !== 'tag') throw new GuardError('a pushed tag points to something other than a commit, which this guard cannot check');
      const label = `tag ${current.slice(0, 12)}`;
      const { message, identities, target } = splitObject(this.#git.catFile('tag', current));
      this.scanMessage(`${label} message`, message);
      this.scanIdentities(label, identities);
      if (!target) throw new GuardError('a pushed tag could not be read');
      current = target;
    }
    throw new GuardError('a pushed tag points through too many other tags');
  }

  useBaseConfig(base) { this.#config = withBaseConfig(this.#config, base, (text) => this.note(text)); }

  scanPullRequest(title, body) {
    if (!this.#config.scope.pull_request_text) return;
    if (typeof title !== 'string') throw new GuardError('the pull request title was not given');
    if (typeof body !== 'string') throw new GuardError('the pull request body was not given');
    this.scanText('pull request title', title);
    this.scanText('pull request body', body);
  }

  report({ mode, where }) {
    const lines = [];
    const scope = this.#config.scope;
    const declared = [
      scope.file_content && 'file content', scope.paths && 'paths', scope.commit_messages && 'commit and tag messages',
      scope.branch_names && 'branch and tag names', scope.pull_request_text && 'pull request title and body',
    ].filter(Boolean);
    const off = Object.entries(scope).filter(([, on]) => !on).map(([key]) => key.replace(/_/g, ' '));
    lines.push(`personal-data-guard v${GUARD_VERSION} (${mode})`);
    lines.push(`Scope: ${declared.join(', ') || 'nothing'}${off.length ? `; switched off in the config: ${off.join(', ')}` : ''}.`);
    lines.push(this.#config.identity === 'included'
      ? 'Author, committer and tagger addresses: scanned.'
      : `Author, committer and tagger addresses: not scanned (owner's choice: ${this.#config.identityReason}).`);
    lines.push(`Checked: ${this.#counts.commits} commit(s), ${this.#counts.files} file version(s), ${this.#counts.messages} message(s).`);
    lines.push('Not scanned:');
    for (const gap of FIXED_GAPS) lines.push(`  - ${gap}`);
    for (const entry of this.#config.notScanned) lines.push(`  - config lists ${entry.path}: ${entry.reason}`);
    for (const gap of this.#listedGaps.values()) lines.push(`  - ${gap}`);
    for (const note of this.#notes) lines.push(`Note: ${note}`);
    lines.push(`Allow markers used: ${this.#allowMarkers}.`);
    if (this.#findings.length) {
      lines.push(`Found ${this.#findings.length} item(s) (place, class, rule; values are never shown):`);
      for (const finding of this.#findings) {
        const at = finding.line ? `:${finding.line}:${finding.column}` : '';
        lines.push(`  ${finding.place}${at}  ${finding.class}  ${finding.rule}`);
      }
      lines.push(...remedy(where));
      lines.push('Result: BLOCKED');
    } else {
      lines.push('Result: PASS');
    }
    return `${lines.join('\n')}\n`;
  }
}

function remedy(where) {
  if (where === 'local') {
    return [
      'Next: remove the value (or replace it with a reserved fake such as name@example.com) and try again.',
      'A synthetic test value can be built at runtime instead of written literally. A public role address can',
      'go in the config allow list; anything else needs an inline "personal-data-guard: allow <reason>" marker.',
    ];
  }
  if (where === 'tree') {
    return [
      'These files are already committed. If they were pushed to a public repository, the data is public.',
      'Do not rewrite history to hide it. Remove it in a new commit and tell the owner (see the incident steps',
      'in the safety-gates playbook).',
    ];
  }
  return [
    'These commits are already on GitHub. If the repository is public, the data is public now.',
    'Do not squash, rebase or force-push to hide it: rewriting history does not remove it from GitHub.',
    'Next: remove it in a new commit, record the commit SHAs above, and tell the owner. Only the owner can',
    'ask GitHub Support to purge cached views and pull request references.',
  ];
}

// ---------------------------------------------------------------------------------------------
// Modes.

function parseArgs(argv) {
  const options = { repo: process.cwd(), config: null, positional: [] , not: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo' || arg === '--config' || arg === '--not') {
      const value = argv[index + 1];
      if (value === undefined) throw new GuardError(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new GuardError(`unknown option ${shown(arg)}`);
    } else {
      options.positional.push(arg);
    }
  }
  return options;
}

// The message file as written. Comment lines are checked too: the comment character is
// configurable and --cleanup=verbatim keeps them. Below the scissors line that `git commit -v`
// adds, removed and unchanged diff lines are skipped, because they are not new content.
function commitMessageText(message) {
  const kept = [];
  let diff = false;
  for (const line of message.split(/\r?\n/)) {
    if (/^. -+ >8 -+$/.test(line)) { diff = true; continue; }
    if (diff && (line.startsWith('-') || line.startsWith(' '))) { kept.push(''); continue; }
    kept.push(line);
  }
  return kept.join('\n');
}

function commitArg(git, value, what) {
  if (typeof value !== 'string' || !value || value.startsWith('-')) throw new GuardError(`${what} is missing`);
  const sha = git.resolve(value);
  if (!sha) throw new GuardError(`${what} is not a commit in this clone (a shallow clone or a missing fetch)`);
  return sha;
}

// Commits the push sends. Commits already on this remote's tracking refs are not sent again;
// another remote's refs prove nothing about this one, and a push to a URL has no tracking refs.
function prePushCommits(git, input, guard, remote) {
  if (typeof remote !== 'string' || !remote) throw new GuardError('pre-push needs the remote name or URL (git passes it as the first argument)');
  const commits = [];
  const named = git.text(['config', '--get', `remote.${remote}.url`], { allowFailure: true }) !== null;
  const remotes = named ? git.text(['for-each-ref', '--format=%(objectname)', `refs/remotes/${remote}/`]).split('\n').filter(Boolean) : [];
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4 || !SHA.test(parts[1]) || !SHA.test(parts[3])) throw new GuardError('pre-push input could not be read');
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    if (ZERO_SHA.test(localSha)) { guard.note('a ref deletion has no content to check'); continue; }
    guard.scanRefName(remoteRef.replace(/^refs\/(?:heads|tags)\//, ''), 'pushed ref name');
    let tip = localSha;
    const type = git.objectType(localSha);
    if (type === 'tag') tip = guard.peelTag(localSha);
    else if (type !== 'commit') throw new GuardError(`the pushed object for ${localRef.startsWith('refs/tags/') ? 'a tag' : 'a branch'} is not a commit`);
    const exclude = remotes.map((sha) => `^${sha}`);
    if (!ZERO_SHA.test(remoteSha) && git.commitExists(remoteSha)) exclude.push(`^${remoteSha}`);
    commits.push(...git.revList([tip, ...exclude]));
  }
  return commits;
}

// useBase(commit): compare the config with the one committed at the change's base (see
// withBaseConfig), before anything is scanned.
function ciEvent(git, guard, env, useBase) {
  const name = env.GITHUB_EVENT_NAME;
  let event;
  try { event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH || '', 'utf8')); }
  catch { throw new GuardError('the GitHub event file could not be read'); }
  if (name === 'pull_request' || name === 'pull_request_target') {
    const pr = event.pull_request || {};
    const base = commitArg(git, pr.base && pr.base.sha, 'the pull request base commit');
    const head = commitArg(git, pr.head && pr.head.sha, 'the pull request head commit');
    useBase(base);
    guard.scanRefName(pr.head && pr.head.ref, 'pull request branch name');
    guard.scanPullRequest(pr.title, pr.body === null ? '' : pr.body);
    guard.scanCommits(git.revList([head, `^${base}`]));
    return;
  }
  if (name === 'push') {
    const ref = String(event.ref || '');
    const after = String(event.after || '');
    const before = String(event.before || '');
    if (!SHA.test(after) || !SHA.test(before)) throw new GuardError('the push event has no before and after commits');
    if (ZERO_SHA.test(after) || event.deleted) { guard.note('a deleted ref has no content to check'); return; }
    const defaultBranch = event.repository && event.repository.default_branch;
    if (!defaultBranch) throw new GuardError('the push event does not name the default branch');
    const isDefault = ref === `refs/heads/${defaultBranch}`;
    // The base: the commit before the push when this clone has it, else the default branch.
    let base = null;
    if (!ZERO_SHA.test(before) && git.commitExists(before)) base = before;
    else if (isDefault && !ZERO_SHA.test(before)) throw new GuardError('the previous default-branch commit is not in this clone');
    else if (!isDefault) base = commitArg(git, `refs/remotes/origin/${defaultBranch}`, 'the default branch');
    useBase(base);
    guard.scanRefName(ref.replace(/^refs\/(?:heads|tags)\//, ''), 'pushed ref name');
    const tip = git.objectType(after) === 'tag' ? guard.peelTag(after) : after;
    const head = commitArg(git, tip, 'the pushed commit');
    if (base === null) {
      guard.note('first push of the default branch: every commit was checked');
      guard.scanCommits(git.revList([head]));
      return;
    }
    if (base !== before && !ZERO_SHA.test(before)) guard.note('the commit before this push is not in this clone (history was replaced); every commit not on the default branch was checked');
    guard.scanCommits(git.revList([head, `^${base}`]));
    return;
  }
  throw new GuardError(`the ${shown(name || 'unknown')} event is not supported (pull_request and push are)`);
}

function explain(config) {
  const lines = [`personal-data-guard v${GUARD_VERSION}: what it checks`, 'Rules:'];
  for (const [id, rule] of Object.entries(RULES)) lines.push(`  ${id}  ${rule.class}: ${rule.text}`);
  lines.push('Before matching, Unicode spaces become spaces, Unicode dashes become hyphens, zero-width and direction');
  lines.push('marks are removed, full-width characters become their ASCII forms, and percent-encoded or HTML-entity');
  lines.push('forms of @ + - . ( ) and space are decoded.');
  lines.push('Not reported: reserved fake domains (example.com, .net, .org and .example, .test, .invalid, .localhost,');
  lines.push('.local, .internal), git@host:path remotes, user@host in URLs, @scope/package names, decorators, code');
  lines.push('tokens (self.x, camelCase names), asset names (logo@2x.png), version specs, SQL patterns and');
  lines.push('single-letter placeholders such as a@b.com; numbers inside longer digit or hex runs, dates, IP addresses');
  lines.push('and timestamps.');
  lines.push('Word, Excel and PowerPoint files (.docx, .xlsx, .pptx) and PDF text are read; other binary content (images,');
  lines.push('thumbnails, embedded objects) is unscannable and blocks unless the config lists its path with a reason.');
  lines.push('In ci and range modes, a change cannot switch off scope or identity checks for itself: the base commit\'s');
  lines.push('settings apply until it is merged, and allow or not_scanned entries it adds are named in the report.');
  if (config) {
    lines.push(`Config: identity ${config.identity}; ${config.allowed.size} allowed role address(es); ${config.notScanned.length} not_scanned entr(ies); required check: ${config.requiredCheck}.`);
  }
  lines.push('Output never contains a matched value, part of one, or a hash of one.');
  return `${lines.join('\n')}\n`;
}

function main(argv, { env = process.env, stdin = () => fs.readFileSync(0, 'utf8'), out = process.stdout, err = process.stderr, spawn = spawnSync } = {}) {
  let options;
  try {
    options = parseArgs(argv);
    const [mode, ...rest] = options.positional;
    const repo = path.resolve(options.repo);
    const configPath = options.config ? path.resolve(options.config) : path.join(repo, DEFAULT_CONFIG);
    if (mode === 'explain') {
      let config = null;
      if (fs.existsSync(configPath)) config = readConfig(configPath);
      out.write(explain(config));
      return 0;
    }
    if (!mode) throw new GuardError('a mode is required (staged, message, pre-push, range, ci, pr, tree or explain)');
    const config = readConfig(configPath);
    const git = new GitReader(repo, { spawn });
    if (git.text(['rev-parse', '--is-inside-work-tree'], { allowFailure: true }) === null && mode !== 'pr' && mode !== 'message') {
      throw new GuardError('this is not a git repository');
    }
    const guard = new PersonalDataGuard({ config, git });
    const relativeConfig = path.relative(repo, configPath).split(path.sep).join('/');
    const useBase = (commit) => {
      if (relativeConfig.startsWith('../') || path.isAbsolute(relativeConfig)) {
        guard.note('the config is outside the repository, so it was not compared with the base commit\'s config');
        return;
      }
      let base = null;
      if (commit) {
        try { base = configAt(git, commit, relativeConfig); }
        catch { guard.note('the base commit\'s config could not be read, so the config in the change was used'); return; }
      }
      guard.useBaseConfig(base);
    };
    let where = 'local';
    if (mode === 'staged') {
      guard.scanStaged();
    } else if (mode === 'message') {
      if (!rest[0]) throw new GuardError('message needs the commit message file');
      let message;
      try { message = fs.readFileSync(path.resolve(rest[0]), 'utf8'); }
      catch { throw new GuardError('the commit message file could not be read'); }
      guard.scanMessage('commit message', commitMessageText(message));
    } else if (mode === 'pre-push') {
      guard.scanCommits(prePushCommits(git, stdin(), guard, rest[0]));
    } else if (mode === 'range') {
      where = 'remote';
      const spec = rest[0];
      if (!spec) throw new GuardError('range needs <base>..<head> or <head> --not <ref>');
      if (spec.includes('..')) {
        if (options.not) throw new GuardError('use either <base>..<head> or <head> --not <ref>');
        const pieces = spec.split('..');
        if (pieces.length !== 2 || spec.includes('...')) throw new GuardError('range needs exactly <base>..<head> (two dots, both ends named)');
        const base = commitArg(git, pieces[0], 'the range base');
        const head = commitArg(git, pieces[1], 'the range head');
        useBase(base);
        guard.scanCommits(git.revList([head, `^${base}`]));
      } else {
        if (!options.not) throw new GuardError('range <head> needs --not <ref>');
        const head = commitArg(git, spec, 'the range head');
        const not = commitArg(git, options.not, 'the --not ref');
        useBase(not);
        guard.scanCommits(git.revList([head, `^${not}`]));
      }
    } else if (mode === 'ci') {
      where = 'remote';
      ciEvent(git, guard, env, useBase);
    } else if (mode === 'pr') {
      where = 'remote';
      guard.scanPullRequest(env.PDG_PR_TITLE, env.PDG_PR_BODY);
    } else if (mode === 'tree') {
      where = 'tree';
      guard.scanTree(rest[0] || 'HEAD');
    } else {
      throw new GuardError(`unknown mode ${shown(mode)}`);
    }
    const report = guard.report({ mode, where });
    (guard.findings.length ? err : out).write(report);
    return guard.findings.length ? 1 : 0;
  } catch (error) {
    // Only this guard's own messages are shown; anything else is named by type, because a
    // runtime message can quote the data being read.
    const reason = error instanceof GuardError ? error.message : `internal error (${error && error.name ? error.name : 'unknown'})`;
    err.write(`personal-data-guard: could not scan: ${reason}\nResult: COULD NOT SCAN (treated as a failure)\n`);
    return 2;
  }
}

module.exports = Object.freeze({
  CONFIG_SCHEMA,
  GUARD_VERSION,
  RULES,
  GuardError,
  PersonalDataGuard,
  decodeContent,
  detect,
  introducedLines,
  main,
  normalise,
  validateConfig,
});

if (require.main === module) process.exitCode = main(process.argv.slice(2));
