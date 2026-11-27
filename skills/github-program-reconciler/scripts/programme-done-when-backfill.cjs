'use strict';

// The DONE WHEN backfill: turns the plain or numbered list rows under an open task page's DONE WHEN
// heading into unticked `- [ ]` checkbox rows (programme-child-rows doneWhenRows), so the programme
// graph's Progress count shows for every task. It keeps each row's text, never adds a row, never
// ticks one and never touches another section, a code block, a comment or a generated block.
//
// plan() only reads: the open native sub-issues of the programme's parent issues (one request per
// hundred tasks), or the one task named. apply() writes the pages plan() found, one at a time, with
// the checks the controller's other page write (mark-archive) uses: the page as it stood is saved to
// the private store and read back, the page is read again and left alone if it changed since the plan,
// and after the write it must read back exactly as written. The converted page must also count every
// converted row (rowTicks), or it is not written. One page that fails stops nothing else; the result
// names each page's outcome.
//
// Who may apply is decided by the caller: programme.cjs done-when-rows --apply is the parent holder's
// write; the governance summary applies it on the owner's own answer.

const state = require('./programme-state.cjs');
const rows = require('./programme-child-rows.cjs');

const { ProgrammeError } = state;

class DoneWhenBackfill {
  constructor({ transport, repository, parents, store }) {
    if (!Array.isArray(parents) || !parents.length) throw new ProgrammeError('BINDING_INVALID', 'The backfill needs the programme\'s parent issues.');
    Object.assign(this, { repository, parents, store });
    this.reader = new state.ProgrammeGraphReader({ transport, repository });
    this.mutator = new state.GitHubMutator({ transport, repository });
  }

  // { read, pages: [{ issue, title, rows: [{ line, from, to }], before, after }], missing: [{ issue, title, why }] }.
  // `pages` are the tasks the apply converts; `missing` the open tasks that still have no checkbox
  // row afterwards and need their controller to write them (DONE_WHEN_ROWS_MISSING).
  plan({ issue = null } = {}) {
    const tasks = issue ? [this.task(issue)] : this.parents.flatMap(parent => this.reader.subIssueRows(parent).map(row => {
      if (!row.facts) throw new ProgrammeError('GH_FAILED', `A sub-issue of #${parent} could not be read.`);
      return row.facts;
    })).filter(task => task.state === 'open' && !task.is_pull_request);
    const pages = [], missing = [];
    for (const task of [...new Map(tasks.map(task => [task.number, task])).values()].sort((a, b) => a.number - b.number)) {
      const read = rows.doneWhenRows(task.body);
      if (read.plain.length) pages.push({ issue: task.number, title: task.title, rows: read.plain, before: task.body, after: read.body });
      else if (!rows.rowTicks(task.body).done_when.total) missing.push({ issue: task.number, title: task.title, why: read.heading ? 'its DONE WHEN has no list rows' : 'no DONE WHEN section' });
    }
    return { read: tasks.length, pages, missing };
  }

  // One named task: open, an issue, and a native child of a programme parent.
  task(number) {
    const page = this.reader.issue(number);
    const refuse = why => new ProgrammeError('BACKFILL_REFUSED', `#${number} was not read for the backfill: ${why}. Nothing was written.`);
    if (!page) throw refuse('it could not be read');
    if (page.is_pull_request) throw refuse('it is a pull request');
    if (page.state !== 'open') throw refuse('it is closed, and a closed task page keeps its text');
    if (!this.parents.includes(page.parent)) throw refuse(`it is not a sub-issue of the programme parent ${this.parents.map(parent => `#${parent}`).join(', ')}`);
    return page;
  }

  // Writes each page of the plan. Returns { outcome: DONE | PARTIAL | NOOP, results: [{ issue, outcome, rows?, copy?, code?, detail? }] }.
  apply(plan) {
    const results = plan.pages.map(page => {
      try { return { issue: page.issue, ...this.write(page) }; }
      catch (error) { return { issue: page.issue, outcome: 'REFUSED', code: error.code || 'FAIL', detail: String(error.message).slice(0, 300) }; }
    });
    const failed = results.filter(result => result.outcome === 'REFUSED').length;
    return { outcome: !results.length ? 'NOOP' : failed ? 'PARTIAL' : 'DONE', results };
  }

  write(page) {
    const counted = rows.rowTicks(page.after).done_when.total - rows.rowTicks(page.before).done_when.total;
    if (counted !== page.rows.length) throw new ProgrammeError('BACKFILL_CHECK_FAILED', `the converted page would count ${counted} new row(s), not ${page.rows.length}; nothing was written`);
    const copy = this.store.savePageCopy(page.issue, page.before);
    const latest = this.reader.issue(page.issue);
    if (!latest || latest.body !== page.before) throw new ProgrammeError('BODY_MOVED', `#${page.issue} changed after it was read; nothing was written. Run the backfill again`);
    this.mutator.writeBody(page.issue, page.after);
    const after = this.reader.issue(page.issue);
    if (!after || after.body !== page.after) throw new ProgrammeError('BODY_READBACK_MISMATCH', `#${page.issue} did not read back as written. The page as it was is saved at ${copy.path} in the private store`);
    return { outcome: 'DONE', rows: page.rows.length, copy: copy.path };
  }
}

// The plan in a few plain lines, for the command line and the governance summary.
function planLines(plan) {
  const list = items => items.map(item => `#${item.issue}`).join(', ');
  return [
    plan.pages.length ? `${plan.pages.length} open task page(s) have plain or numbered DONE WHEN rows to turn into checkboxes: ${list(plan.pages)}.` : 'No open task page has plain or numbered DONE WHEN rows.',
    ...(plan.missing.length ? [`${plan.missing.length} open task page(s) have no DONE WHEN checkbox rows for the controller to write: ${list(plan.missing)}.`] : []),
  ];
}

module.exports = Object.freeze({ DoneWhenBackfill, planLines });
