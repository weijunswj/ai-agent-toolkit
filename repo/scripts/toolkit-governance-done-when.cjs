'use strict';

// The DONE WHEN backfill in the governance summary, which setup shows right after its turn-on merges
// and refresh governance shows each time. Like the instruction-copies cleanup, it is a dry run first:
// the summary's row lists the open task pages whose DONE WHEN rows are plain or numbered list items,
// and the owner's own words (convert done-when rows) run the backfill on them
// (programme-done-when-backfill.cjs, with its page copy, change and read-back checks). Once a dry run
// finds nothing to convert, or a backfill converts every page, this computer notes the repository as
// done and stops reading for it: from then on the programme sweep's DONE_WHEN_ROWS_MISSING finding
// covers new pages.
//
// The file holds only repository ids, times and fixed words, never page text.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { userStateDirectory } = require('./toolkit-user-state.cjs');

const SCHEMA = 'toolkit.governance-done-when.v1';
const BASENAME = 'governance-done-when.v1.json';
const MAX_ENTRIES = 64;
const SAY = 'convert done-when rows';

const list = numbers => numbers.map(number => `#${number}`).join(', ');

class DoneWhenBackfillStep {
  #file; #backfill;

  // `backfill(root, { apply })` is programme.cjs ownerDoneWhenBackfill, or null where none runs
  // (tests, offline): then the summary shows no row.
  constructor({ registryOptions = {}, backfill = null } = {}) {
    this.#file = path.join(userStateDirectory(registryOptions), BASENAME);
    this.#backfill = backfill;
  }

  // The summary's fact for a governed repository: null when there is nothing to show (no backfill
  // here, or this repository noted done), { unread: true } when the dry run failed, else
  // { pages, missing } as issue numbers.
  facts(state) {
    if (!this.#backfill || !state?.repository_id || !state.root || this.#done(state.repository_id)) return null;
    let plan;
    try { plan = this.#backfill(state.root, { apply: false }); } catch { return { unread: true }; }
    const facts = { pages: plan.pages.map(page => page.issue), missing: plan.missing.map(page => page.issue) };
    if (!facts.pages.length) this.#note(state.repository_id);
    return facts;
  }

  // The owner's word: the backfill on every page the dry run lists, read afresh. { ok, lines }.
  apply(state) {
    if (!this.#backfill || !state?.root) return { ok: false, lines: ['The DONE WHEN rows cannot be converted from here. Nothing was written.'] };
    let result;
    try { result = this.#backfill(state.root, { apply: true }); }
    catch (error) { return { ok: false, lines: [`The DONE WHEN rows were not converted (${error.code || 'unavailable'}). Nothing was written; say ${SAY} again in a moment.`] }; }
    const done = (result.results || []).filter(entry => entry.outcome === 'DONE');
    const refused = (result.results || []).filter(entry => entry.outcome !== 'DONE');
    if (!refused.length) this.#note(state.repository_id);
    return { ok: !refused.length, lines: [
      done.length ? `Converted the DONE WHEN rows on ${done.length} task page(s): ${list(done.map(entry => entry.issue))}. Each page was saved to the private store first and read back after.` : 'No task page had DONE WHEN rows to convert. Nothing was written.',
      ...refused.map(entry => `#${entry.issue} was not changed (${entry.code}): ${entry.detail}`),
      ...(result.missing?.length ? [`Still without checkbox rows, for the controller to write: ${list(result.missing.map(page => page.issue))}.`] : []),
    ] };
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
      if (parsed?.schema === SCHEMA && parsed.repositories && typeof parsed.repositories === 'object') return parsed;
    } catch { /* none yet, or unreadable: start empty */ }
    return { schema: SCHEMA, repositories: {} };
  }

  #done(repositoryId) { return Boolean(this.#read().repositories[repositoryId]); }

  // A note that cannot be written only means the next summary reads the pages again.
  #note(repositoryId) {
    try {
      const value = this.#read();
      value.repositories[repositoryId] = { at: new Date().toISOString() };
      const entries = Object.entries(value.repositories).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_ENTRIES);
      fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      const temp = `${this.#file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try { fs.writeFileSync(temp, `${JSON.stringify({ schema: SCHEMA, repositories: Object.fromEntries(entries) }, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temp, this.#file); }
      finally { fs.rmSync(temp, { force: true }); }
    } catch { /* read again next time */ }
  }
}

module.exports = Object.freeze({ DoneWhenBackfillStep, SAY });
