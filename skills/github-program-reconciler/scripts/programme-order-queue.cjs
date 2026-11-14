'use strict';

// Stored holder orders: the cloud sweep runs the controller's holder orders from the evidence store,
// so a controller with no shell no longer needs a session on a computer to run them.
//
// The controller commits an order (toolkit.programme-holder-order.v1) to the private store's branch at
// `<store path>orders/pending/<order_id>.json`, or `<order_id>.dry-run.json` for a rehearsal, then
// starts the Programme Sweep workflow. At the start of its pass, while it holds the sweep lease, the
// cloud sweep reads each pending order and runs it with `run-order`'s own rules: validation, expiry,
// the holder and epoch fence, the closed list of writes, and the log in the parent's private part
// that lets a re-run continue without repeating a finished write. It then writes a result file under
// `orders/done/` (ran, or rehearsed) or `orders/refused/` (refused or stopped), removes the pending
// file, and the same pass redraws the pages.
//
// Who may author: whoever can commit to the private store's branch, as for every state document. The
// order must still name the parent's current holder and epoch, so a stale or foreign order runs
// nothing. Never two writers: orders run only inside the cloud pass's lease. An order whose run met a
// passing GitHub failure stays pending for the next run, until its own expiry refuses it.
const state = require('./programme-state.cjs');

const secretShaped = text => state.SECRET_SHAPES.some(([, pattern]) => pattern.test(String(text || '')));
const RESULT_SCHEMA = 'toolkit.programme-order-result.v1';
const MAX_ORDERS_PER_PASS = 10;
const MAX_ORDER_BYTES = 64 * 1024;
const DRY_SUFFIX = '.dry-run.json';
const ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
// Codes that mean "try again next run": the order stays pending. Anything else is final.
const RETRY = code => /^GH_/.test(code || '') || ['STATE_CONFLICT', 'STATE_READBACK_MISMATCH', 'PASS_STOPPED', 'TOKEN_ROUTE_REFUSED'].includes(code);
// Codes that end the pass itself, as everywhere else in the reconciler (programme-state STOPS_PASS):
// they are raised again and the order stays pending. A code-less error is a bug, never an order's
// fault, so it is raised too. STALE_WRITER is the exception: inside an order it means the parent
// changed holder or epoch after the order's fence check, so that one order is refused, not the pass.
const RAISE = new Set(['PASS_LOCK_LOST', 'PASS_STOPPED', 'SWEEP_STOP']);
const raises = error => !error?.code || RAISE.has(error.code);

// The order id and mode a pending file name carries, or null for a name that is not an order.
function parseName(name) {
  const text = String(name || '');
  const dryRun = text.endsWith(DRY_SUFFIX);
  const id = dryRun ? text.slice(0, -DRY_SUFFIX.length) : text.endsWith('.json') ? text.slice(0, -5) : null;
  return id && ORDER_ID.test(id) ? { id, dryRun } : null;
}

class OrderQueue {
  // `store` is the private StateStore; `runOrder({ orderValue, session, dryRun })` runs one order
  // with run-order's rules and returns its report.
  constructor({ store, runOrder, session, runId = null, now = () => new Date().toISOString() }) {
    Object.assign(this, { store, runOrder, session, runId, now });
    this.transport = store.transport;
    this.dir = `${store.store.path}orders/`;
  }

  contents(file) { return this.store.encodedContents(file); }

  // The pending files, oldest name first. A folder that does not exist is an empty queue.
  pending() {
    const dir = `${this.dir}pending`;
    const response = this.transport.request('GET', `${this.contents(dir)}?ref=${encodeURIComponent(this.store.store.branch)}`);
    if (response.status === 404) return [];
    if (response.status !== 200 || !Array.isArray(response.json)) throw new state.ProgrammeError('GH_FAILED', `Listing ${dir} failed (${response.status}).`, { status: response.status });
    return response.json.filter(entry => entry?.type === 'file' && String(entry.name).endsWith('.json'))
      .map(entry => ({ name: String(entry.name), sha: entry.sha, path: `${dir}/${entry.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  readText(file) {
    const response = this.transport.request('GET', `${this.contents(file)}?ref=${encodeURIComponent(this.store.store.branch)}`);
    if (response.status !== 200) throw new state.ProgrammeError('GH_FAILED', `Reading ${file} failed (${response.status}).`);
    if (response.json?.encoding !== 'base64') return null;
    const bytes = Buffer.from(response.json.content, 'base64');
    return bytes.length > MAX_ORDER_BYTES ? null : bytes.toString('utf8').replace(/^﻿/, '');
  }

  // Writes the result file (replacing one a crashed run left) and reads it back.
  writeResult(folder, name, doc) {
    const file = `${this.dir}${folder}/${name}`;
    let text = `${JSON.stringify(doc, null, 2)}\n`;
    // Text shaped like a secret never reaches the store: the result keeps only its codes and counts.
    if (secretShaped(text)) {
      const { detail: _detail, results: _results, order: _order, ...kept } = doc;
      text = `${JSON.stringify({ ...kept, order: null, redacted: true }, null, 2)}\n`;
    }
    const existing = this.transport.request('GET', `${this.contents(file)}?ref=${encodeURIComponent(this.store.store.branch)}`);
    const sha = existing.status === 200 ? existing.json?.sha : null;
    const response = this.transport.request('PUT', this.contents(file), {
      message: `programme order: ${folder} ${name}`, content: Buffer.from(text, 'utf8').toString('base64'), branch: this.store.store.branch, ...(sha ? { sha } : {}),
    });
    if (![200, 201].includes(response.status)) throw new state.ProgrammeError('GH_FAILED', `Writing ${file} failed (${response.status}).`);
    const commit = response.json?.commit?.sha;
    const back = commit ? this.transport.request('GET', `${this.contents(file)}?ref=${encodeURIComponent(commit)}`) : null;
    if (!back || back.status !== 200 || Buffer.from(back.json?.content || '', 'base64').toString('utf8') !== text) {
      throw new state.ProgrammeError('STATE_READBACK_MISMATCH', `${file} did not read back as written.`);
    }
  }

  remove(entry) {
    const response = this.transport.request('DELETE', this.contents(entry.path), { message: `programme order: take ${entry.name} off the queue`, sha: entry.sha, branch: this.store.store.branch });
    if (response.status !== 200 && response.status !== 404) throw new state.ProgrammeError('GH_FAILED', `Removing ${entry.path} failed (${response.status}).`);
  }

  // One order: { order_id, mode, outcome, code? }. `outcome` is DONE, READY, WOULD_STOP (a dry run),
  // REFUSED, STOPPED or PENDING (left for the next run).
  runOne(entry) {
    const named = parseName(entry.name);
    const mode = named?.dryRun ? 'dry-run' : 'apply';
    const base = { order_id: named?.id || entry.name, mode };
    const refuse = (code, detail, report = null, order = null) => this.settle(entry, 'refused', { ...base, outcome: report ? 'STOPPED' : 'REFUSED', code, detail: String(detail).slice(0, 300), ...(report ? { digest: report.digest, results: report.results } : {}), order });
    if (!named) return refuse('ORDER_INVALID', 'The file name must be <order_id>.json or <order_id>.dry-run.json.');
    const text = this.readText(entry.path);
    if (text === null) return refuse('ORDER_INVALID', `The order file must be UTF-8 JSON of at most ${MAX_ORDER_BYTES} bytes.`);
    let order;
    try { order = JSON.parse(text); } catch { return refuse('ORDER_INVALID', 'The order file is not valid JSON.'); }
    if (!order || typeof order !== 'object' || order.order_id !== named.id) return refuse('ORDER_INVALID', 'The file name must match the order\'s order_id.', null, order);
    let report;
    try { report = this.runOrder({ orderValue: order, session: this.session, dryRun: named.dryRun }); }
    catch (error) {
      if (raises(error)) throw error;
      if (RETRY(error.code)) return { ...base, outcome: 'PENDING', code: error.code };
      return refuse(error.code || 'FAIL', error.message, null, order);
    }
    if (report.outcome === 'STOPPED') {
      const code = report.results?.at(-1)?.code || 'FAIL';
      if (RETRY(code) || code === 'PASS_LOCK_LOST') return { ...base, outcome: 'PENDING', code };
      return refuse(code, report.next_action || 'A write was refused.', report, order);
    }
    return this.settle(entry, 'done', { ...base, outcome: report.outcome, digest: report.digest, results: report.results, order });
  }

  settle(entry, folder, result) {
    const { order = null, ...summary } = result;
    this.writeResult(folder, entry.name, { schema: RESULT_SCHEMA, ...summary, run: this.runId, finished_at: this.now(), order });
    this.remove(entry);
    return { order_id: summary.order_id, mode: summary.mode, outcome: summary.outcome, ...(summary.code ? { code: summary.code } : {}) };
  }

  // Every pending order this pass takes, oldest first; the rest wait for the next run.
  run() {
    let entries;
    // A queue that cannot be listed costs this run its orders, never its refresh: the orders keep
    // their place, and the summary warns with the code.
    try { entries = this.pending(); }
    catch (error) {
      if (raises(error)) throw error;
      return { done: 0, refused: 0, pending: 0, retrying: 0, unreadable: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'FAIL', results: [] };
    }
    const results = [];
    for (const entry of entries.slice(0, MAX_ORDERS_PER_PASS)) {
      // One order's failure never stops the pass: it stays pending, and its expiry ends it in time.
      try { results.push(this.runOne(entry)); }
      catch (error) {
        if (raises(error)) throw error;
        results.push({ order_id: parseName(entry.name)?.id || entry.name, mode: parseName(entry.name)?.dryRun ? 'dry-run' : 'apply', outcome: 'PENDING', code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || '') ? error.code : 'FAIL' });
      }
    }
    const count = outcome => results.filter(item => item.outcome === outcome).length;
    return {
      done: results.filter(item => ['DONE', 'READY', 'WOULD_STOP'].includes(item.outcome)).length,
      refused: count('REFUSED') + count('STOPPED'),
      pending: count('PENDING') + Math.max(0, entries.length - MAX_ORDERS_PER_PASS),
      // Orders that met a failure this run and wait for the next one: the summary warns each run, so
      // a lasting failure is seen before the order's own expiry hides its cause.
      retrying: count('PENDING'),
      results,
    };
  }
}

module.exports = { OrderQueue, parseName, RESULT_SCHEMA, MAX_ORDERS_PER_PASS, MAX_ORDER_BYTES };
