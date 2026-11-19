'use strict';

// The instruction copies older Toolkit setups wrote into a repository, for tests of the leftover scan,
// the cleanup and the session-start preflight. The templates that held them are retired, so they are
// built here the way the sync built those templates: the curated-source comment as it last shipped
// (playbook-history.json), then one Toolkit block at today's version.
const fs = require('node:fs');
const path = require('node:path');
const { renderBlock } = require('../../scripts/toolkit-managed-block.cjs');
const { TOOLKIT_VERSION } = require('../../scripts/toolkit-version.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GOVERNED_SOURCE = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const BOOTSTRAP_SOURCE = 'repo/contracts/agent-rules/repo-local/antigravity-bootstrap.template.md';
// The Antigravity bootstrap body, as it last shipped.
const BOOTSTRAP_BODY = [
  '# Agent Toolkit Antigravity Bootstrap',
  '',
  'Root `AGENTS.md` is the canonical repo instruction file.',
  '',
  '**If root `AGENTS.md` is already loaded, do not duplicate or re-import it.**',
  '',
  '**If root `AGENTS.md` is not loaded, read root `AGENTS.md` before repo edits.**',
  '',
  'Do not add extra `.agents/rules` files.',
].join('\n');

const read = relPath => fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const header = () => JSON.parse(read('repo/contracts/agent-rules/playbook-history.json')).agents_header;
const copy = (source, name, body) => `${header()}\n\n${renderBlock({ source, name, version: TOOLKIT_VERSION, body })}\n`;

// AGENTS.md holding only the governed rules block under the curated header.
function managedAgentsCopy() { return copy(GOVERNED_SOURCE, 'TOOLKIT-GOVERNED-RULES', read(GOVERNED_SOURCE).trimEnd()); }

// .agents/rules/00-agent-toolkit-bootstrap.md as the Antigravity bootstrap wrote it.
function antigravityBootstrapCopy() { return copy(BOOTSTRAP_SOURCE, 'ANTIGRAVITY.BOOTSTRAP', BOOTSTRAP_BODY); }

module.exports = { antigravityBootstrapCopy, managedAgentsCopy };
