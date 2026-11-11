#!/usr/bin/env node
'use strict';

// The controller rules are repo/CONTROLLER.md plus the pages its Pages section lists. The map at
// repo/contracts/agent-rules/controller-enforcement-map.json says, for each rule, what enforces it
// (a hook, a script, a CI check or the programme reconciler, each with the test that proves it, and
// one line on which part of the rule they cover) or that it is instruction-only and why. The map lives outside the rules files, so they gain no bytes.
//
// A rule is one non-empty line under a `##` or `###` heading of a controller file: a bullet or a
// paragraph. A fenced block or a `####` line inside a section also counts as rule lines, so it
// needs a row too; that fails closed. A map row finds its rule by `rule`, a phrase that must appear in exactly one rule line
// of its `file`. This check fails when:
//   - a rule line has no row, or more than one row;
//   - a row's phrase matches no rule line, or more than one;
//   - a row has both or neither of `enforced_by` and `instruction_only`, or an enforced row has no
//     `covers` line;
//   - an enforcer names an unknown kind, a path that is not a file inside the repository, a test
//     that is not, or a test that never names the enforcer's file (with its extension).
// It reads files only and writes nothing.
//
// Usage: node repo/scripts/check-controller-enforcement-map.cjs [--root <dir>]

const fs = require('node:fs');
const path = require('node:path');
const { CORE, PAGES_DIR, listedPages } = require('./sync-controller-pages.cjs');

const MAP = 'repo/contracts/agent-rules/controller-enforcement-map.json';
const SCHEMA = 'toolkit-controller-enforcement-map/v1';
const KINDS = Object.freeze(['hook', 'script', 'ci', 'reconciler']);
const ROW_KEYS = Object.freeze(['file', 'rule', 'covers', 'enforced_by', 'instruction_only']);
const ENFORCER_KEYS = Object.freeze(['kind', 'path', 'test']);

const normalise = text => text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
const full = (root, rel) => path.join(root, ...rel.split('/'));
const short = text => (text.length > 80 ? `${text.slice(0, 77)}...` : text);
const isText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The controller files in the order the core lists them.
function controllerFiles(root) {
  const { errors, entries } = listedPages(normalise(fs.readFileSync(full(root, CORE), 'utf8')));
  if (errors.length) return { errors, files: [] };
  return { errors: [], files: [CORE, ...entries.map(entry => `${PAGES_DIR}/${entry.file}`)] };
}

// Every non-empty line under a `##` or `###` heading. The title and the text before the first such
// heading are not rules.
function ruleLines(text) {
  const rules = [];
  let heading = null;
  normalise(text).split('\n').forEach((line, index) => {
    if (/^#{2,3} /.test(line)) { heading = line.replace(/^#+ /, ''); return; }
    if (/^# /.test(line) || heading === null || line.trim() === '') return;
    rules.push({ heading, line: index + 1, text: line });
  });
  return rules;
}

// A repository-relative path to a regular file inside root: no absolute path, no `..`, no folder.
function isRepoFile(root, rel) {
  if (!isText(rel) || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(part => part === '..' || part === '.' || part === '')) return false;
  const target = path.resolve(full(root, rel));
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

function checkEnforcer(root, where, enforcer, errors) {
  if (!isRecord(enforcer)) { errors.push(`${where}: each enforcer must be an object`); return; }
  for (const key of Object.keys(enforcer)) if (!ENFORCER_KEYS.includes(key)) errors.push(`${where}: unknown enforcer key "${key}"`);
  if (!KINDS.includes(enforcer.kind)) errors.push(`${where}: kind must be one of ${KINDS.join(', ')}`);
  const pathOk = isRepoFile(root, enforcer.path);
  if (!pathOk) errors.push(`${where}: enforcer ${enforcer.path || '(none)'} is not a file inside the repository`);
  if (!isRepoFile(root, enforcer.test)) { errors.push(`${where}: test ${enforcer.test || '(none)'} is not a file inside the repository`); return; }
  if (pathOk) {
    const name = path.basename(enforcer.path);
    if (!fs.readFileSync(full(root, enforcer.test), 'utf8').includes(name)) errors.push(`${where}: test ${enforcer.test} never names ${name}`);
  }
}

// Returns { errors, rules, rows }. No errors means every rule has exactly one valid row.
function check(root = path.resolve(__dirname, '..', '..')) {
  const errors = [];
  const { errors: pageErrors, files } = controllerFiles(root);
  if (pageErrors.length) return { errors: pageErrors.map(error => `controller pages: ${error}`), rules: 0, rows: 0 };
  let map;
  try { map = JSON.parse(fs.readFileSync(full(root, MAP), 'utf8')); } catch (error) { return { errors: [`${MAP}: cannot be read as JSON (${error.message})`], rules: 0, rows: 0 }; }
  if (!isRecord(map) || map.schema !== SCHEMA || !Array.isArray(map.rows)) return { errors: [`${MAP}: needs "schema": "${SCHEMA}" and a "rows" list`], rules: 0, rows: 0 };

  const rules = files.flatMap(file => ruleLines(fs.readFileSync(full(root, file), 'utf8')).map(rule => ({ ...rule, file, rows: [] })));
  map.rows.forEach((row, index) => {
    const where = `${MAP} row ${index + 1}${isRecord(row) && isText(row.rule) ? ` ("${short(row.rule)}")` : ''}`;
    if (!isRecord(row)) { errors.push(`${where}: must be an object`); return; }
    for (const key of Object.keys(row)) if (!ROW_KEYS.includes(key)) errors.push(`${where}: unknown key "${key}"`);
    if (!files.includes(row.file)) { errors.push(`${where}: file must be one of ${files.join(', ')}`); return; }
    if (!isText(row.rule)) { errors.push(`${where}: needs a "rule" phrase`); return; }
    const matches = rules.filter(rule => rule.file === row.file && rule.text.includes(row.rule));
    if (matches.length === 0) errors.push(`${where}: matches no rule in ${row.file}`);
    else if (matches.length > 1) errors.push(`${where}: matches ${matches.length} rules in ${row.file} (lines ${matches.map(rule => rule.line).join(', ')}); use a longer phrase`);
    else matches[0].rows.push(index + 1);
    const enforced = row.enforced_by !== undefined, instructed = row.instruction_only !== undefined;
    if (enforced === instructed) errors.push(`${where}: needs exactly one of "enforced_by" and "instruction_only"`);
    if (instructed && !isText(row.instruction_only)) errors.push(`${where}: "instruction_only" must say why in one line`);
    if (instructed && row.covers !== undefined) errors.push(`${where}: an instruction-only row has no "covers" line`);
    if (enforced && !isText(row.covers)) errors.push(`${where}: an enforced row needs a "covers" line saying which part of the rule its enforcers act on`);
    if (enforced) {
      if (!Array.isArray(row.enforced_by) || row.enforced_by.length === 0) errors.push(`${where}: "enforced_by" must list at least one enforcer`);
      else row.enforced_by.forEach((enforcer, at) => checkEnforcer(root, `${where} enforcer ${at + 1}`, enforcer, errors));
    }
  });
  for (const rule of rules) {
    const label = `${rule.file}:${rule.line} (${rule.heading}): "${short(rule.text)}"`;
    if (rule.rows.length === 0) errors.push(`rule with no map row: ${label}`);
    if (rule.rows.length > 1) errors.push(`rule with ${rule.rows.length} map rows (${rule.rows.join(', ')}): ${label}`);
  }
  return { errors, rules: rules.length, rows: map.rows.length };
}

function run(argv = process.argv.slice(2)) {
  let root = path.resolve(__dirname, '..', '..');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' && argv[index + 1]) root = path.resolve(argv[(index += 1)]);
    else { process.stderr.write('Usage: node repo/scripts/check-controller-enforcement-map.cjs [--root <dir>]\n'); return 2; }
  }
  const result = check(root);
  if (result.errors.length) {
    process.stderr.write(`Controller enforcement map check failed:\n${result.errors.map(error => `- ${error}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write(`Controller enforcement map check passed: ${result.rules} rules, ${result.rows} rows.\n`);
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = Object.freeze({ KINDS, MAP, SCHEMA, check, ruleLines, run });
