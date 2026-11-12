'use strict';

const state = require('./programme-state.cjs');
const { ProgrammeSweep, OVERLAP_MS } = require('./programme-sweep.cjs');
const copy = value => structuredClone(value);
const FACT_FINDINGS = Object.freeze(['PR_DISCOVERY_INCOMPLETE', 'COMPLETED_PR_MISSING', 'ISSUE_MISSING', 'NATIVE_PARENT_MISSING',
  'NATIVE_PARENT_WRONG', 'DUPLICATE_HIERARCHY', 'NATIVE_PARENT_UNEXPECTED', 'DEPENDENCY_IMPLIES_PARENT', 'READY_TO_CLOSE', 'PR_HEAD_MOVED',
  'CHECKS_GREEN_AT_HEAD', 'CHECKS_PENDING', 'CHECKS_RED', 'CHECKS_UNKNOWN', 'CHILD_STATE_CONFLICT', 'CLOSED_WITHOUT_ACCEPTANCE', 'CHILD_REOPENED']);

// External reconciliation keeps its existing executor and guards. Its intents were committed in
// the pass batch. Settling an intent is left to the next pass's independent recovery readback;
// no second parent commit is needed merely to clear an already-observed effect.
class SweepEffectStore {
  constructor({ store }) { this.store = store; }
  read(...args) { return this.store.read(...args); }
  savePageCopy(...args) { return this.store.savePageCopy(...args); }
  mutate(kind, number, { writer, parentDoc, change }) {
    const current = this.store.read(kind, number);
    state.authoriseWrite(kind, current.doc, parentDoc, writer);
    const next = change(copy(current.doc), { created: false });
    if (!next) return { outcome: 'NOOP', ...current };
    if (next.pending_effects.some(effect => !current.doc.pending_effects.some(stored => stored.intent_id === effect.intent_id))) {
      throw new state.ProgrammeError('STATE_WRITE_DEFERRED', 'The effect has no committed intent; a later sweep must plan it again.');
    }
    const before = copy(current.doc), after = copy(next);
    delete before.pending_effects; delete after.pending_effects;
    if (state.canonicalText(before) !== state.canonicalText(after)) throw new state.ProgrammeError('STATE_WRITE_DEFERRED', 'A state change waits for the next sweep batch.');
    return { outcome: 'STAGED', doc: next, sha: current.sha };
  }
}

// The live adapter keeps the existing reconciler as the fact compiler and page layout owner.
// Its state store, transport, clock, fence and read cache are all explicit dependencies.
class LiveProgrammeSweep {
  constructor({ store, transport, binding, writer, version, now = () => new Date().toISOString(), requests, readCache = null, pass = null }) {
    Object.assign(this, { store, transport, binding, writer, version, now, requests, readCache });
    this.reader = new state.ProgrammeGraphReader({ transport, repository: binding.repository });
    this.mutator = new state.GitHubMutator({ transport, repository: binding.repository });
    this.compiler = new state.Reconciler({ store, reader: this.reader, mutator: this.mutator, binding, writer,
      toolkitVersion: version, now, refreshFacts: true, readCache, pass });
    this.issues = new Map(); this.comments = new Map(); this.prs = new Map(); this.histories = new Map();
    this.findings = []; this.prLists = new Map(); this.links = new Map(); this.prepared = new Set(); this.pageWrites = 0;
    this.effects = []; this.subIssues = new Map();
    if (pass?.progress?.interrupted) this.findings.push({ code: 'PASS_STOPPED', issue: binding.parent_issue, diagnostics: pass.progress.interrupted });
  }
  load() {
    const base = this.store.readSnapshot();
    const parent = base.documents.get(`parent:${this.binding.parent_issue}`)?.doc;
    if (!parent) throw new state.ProgrammeError('PARENT_STATE_MISSING', 'The programme parent has no saved state.');
    if (parent.repository !== this.binding.repository || parent.parent_issue !== this.binding.parent_issue) throw new state.ProgrammeError('STATE_INVALID', 'The saved parent belongs to another programme.');
    state.authoriseWrite('parent', parent, null, this.writer);
    const children = new Map([...base.documents].filter(([key]) => key.startsWith('child:')).map(([, entry]) => [entry.doc.issue, entry.doc]));
    return { parent, children, base };
  }
  guard() {
    const parent = this.store.read('parent', this.binding.parent_issue).doc;
    state.authoriseWrite('parent', parent, null, this.writer);
  }
  paged(endpoint) {
    const all = [];
    for (let page = 1; page <= 50; page++) {
      const response = this.transport.request('GET', `${endpoint}&per_page=100&page=${page}`);
      if (response.status !== 200 || !Array.isArray(response.json)) throw new state.ProgrammeError('SWEEP_DISCOVERY_INCOMPLETE', 'GitHub inventory could not be read completely.');
      all.push(...response.json);
      if (response.json.length < 100) return all;
    }
    throw new state.ProgrammeError('SWEEP_DISCOVERY_INCOMPLETE', 'GitHub inventory exceeded its page limit.');
  }
  discover(parent, progress) {
    this.requests.phaseAt('discovery');
    const since = progress.last_started_at ? `&since=${encodeURIComponent(new Date(Date.parse(progress.last_started_at) - OVERLAP_MS).toISOString())}` : '';
    const changedRows = this.paged(`repos/${this.binding.repository}/issues?state=all${since}`);
    const changed = new Set();
    const changedPrs = new Set();
    for (const row of changedRows) {
      if (!row.pull_request) { changed.add(row.number); continue; }
      changedPrs.add(row.number);
      for (const outcome of parent.outcomes) {
        const child = this.snapshot.children.get(outcome.issue);
        if (child?.pr.number === row.number || child?.prs?.some(pr => pr.number === row.number)
          || state.referencedIssues([{ number: row.number, body: row.body, title: row.title }]).has(outcome.issue)) changed.add(outcome.issue);
      }
    }
    const outcomes = copy(parent.outcomes);
    const known = new Set([parent.parent_issue, ...outcomes.map(outcome => outcome.issue)]);
    const parents = [parent.parent_issue];
    const visited = new Set();
    // Native membership, including nested lists, is complete before it may adopt a task.
    while (parents.length) {
      const number = parents.shift();
      if (visited.has(number)) continue;
      visited.add(number);
      const rows = this.reader.subIssueRows(number);
      this.subIssues.set(number, rows.map(row => ({ number: row.number, id: row.id })));
      for (const row of rows) {
        if (!row.facts?.complete || row.facts.is_pull_request || row.facts.parent !== number) continue;
        this.issues.set(row.number, row.facts);
        const kept = this.readCache?.children.get(row.number);
        if (kept && (kept.updated_at !== row.facts.updated_at || kept.comment_count !== row.facts.comments || kept.sub_total !== row.facts.sub_issues_total)) changed.add(row.number);
        if (state.registeredParents(this.binding).includes(row.number)) continue;
        if (!known.has(row.number)) {
          known.add(row.number); changed.add(row.number);
          outcomes.push({ issue: row.number, label: row.facts.title, class: 'COMMITTED', parent: number, order: Math.max(0, ...outcomes.map(outcome => outcome.order)) + 1 });
          this.findings.push({ code: 'CHILD_ADDED', issue: row.number });
        }
        if (row.facts.sub_issues_total !== 0) parents.push(row.number);
      }
    }
    const all = outcomes.map(outcome => outcome.issue);
    for (let start = 0; start < all.length; start += 20) {
      const links = this.reader.issuePullRequestLinks(all.slice(start, start + 20), () => {});
      for (const [number, link] of links) {
        this.links.set(number, link);
        if (link.history.some(pr => changedPrs.has(pr.number))) changed.add(number);
      }
    }
    if (this.readCache) this.readCache.counts.rows = outcomes.filter(outcome => this.issues.has(outcome.issue)).length;
    return { changed: [...changed], outcomes };
  }
  prime(outcome, snapshot, parent) {
    if (this.prepared.has(outcome.issue)) return;
    const numbers = parent.sweep.queue.filter(number => !this.prepared.has(number)).slice(0, 20);
    const batch = parent.outcomes.filter(item => numbers.includes(item.issue));
    const children = new Map([...snapshot.children].map(([number, doc]) => [number, { doc }]));
    for (const status of ['open', 'closed']) if (!this.prLists.has(status)) this.prLists.set(status, this.reader.graphPullRequests(status, () => {}, parent.private?.graph_pr_watermark || null));
    const links = new Map(numbers.map(number => [number, this.links.get(number)]));
    const references = state.referencedIssues([...this.prLists.values()].flat());
    const wanted = new Set();
    for (const number of numbers) {
      const child = snapshot.children.get(number);
      for (const pr of [child?.pr?.number, ...(child?.prs || []).map(pr => pr.number), ...(links.get(number)?.history || []).map(pr => pr.number), ...(references.get(number) || [])]) if (pr && !this.prs.has(pr)) wanted.add(pr);
    }
    for (const [number, pr] of this.reader.pullRequests([...wanted])) this.prs.set(number, pr);
    const reader = Object.create(this.reader);
    reader.graphPullRequests = status => this.prLists.get(status);
    reader.issuePullRequestLinks = requested => new Map(requested.map(number => [number, this.links.get(number)]));
    const compiler = new state.Reconciler({ store: this.store, reader, mutator: this.mutator, binding: this.binding, writer: this.writer, now: this.now, refreshFacts: true });
    const current = new Map(batch.filter(item => snapshot.children.get(item.issue)?.pr.number).map(item => [item.issue, this.prs.get(snapshot.children.get(item.issue).pr.number)]));
    const graph = compiler.discoverGraph(parent, batch, children, current, this.prs, number => {
      if (!this.prs.has(number)) for (const [key, pr] of this.reader.pullRequests([number])) this.prs.set(key, pr);
      return this.prs.get(number);
    });
    for (const item of batch) { this.histories.set(item.issue, { graph, current: graph.discovery.get(item.issue)?.backfill ? this.prs.get(graph.discovery.get(item.issue).backfill.selected) : current.get(item.issue) }); this.prepared.add(item.issue); }
  }
  readTask(outcome, snapshot, parent) {
    this.requests.phaseAt('tasks');
    this.prime(outcome, snapshot, parent);
    const issue = this.issues.get(outcome.issue) || this.reader.issue(outcome.issue);
    if (!issue?.complete || issue.is_pull_request) throw new state.ProgrammeError('SWEEP_TASK_UNREADABLE', 'The task could not be read completely.');
    this.issues.set(outcome.issue, issue);
    const existing = snapshot.children.get(outcome.issue) || null;
    const history = this.histories.get(outcome.issue);
    if (!history?.graph.discovery.get(outcome.issue)?.complete) throw new state.ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The task pull request inventory could not be read completely.');
    const comments = issue.comments === 0 ? [] : this.reader.comments(outcome.issue);
    this.comments.set(outcome.issue, comments);
    const journals = existing && (existing.gate.assignment || Object.keys(existing.journals_seen || {}).length) ? this.compiler.readJournals(existing) : null;
    const observed = { issues: this.issues, comments: this.comments, additions: snapshot.parent.outcomes.some(item => item.issue === outcome.issue) ? [] : [outcome],
      prs: new Map(history.current ? [[outcome.issue, history.current]] : []), prGraph: history.graph, discovery: history.graph.discovery,
      subIssues: this.subIssues, blockedBy: new Map(), journals: new Map(journals ? [[outcome.issue, journals]] : []) };
    if (issue.blocked_by_total) observed.blockedBy.set(outcome.issue, this.reader.blockedBy(outcome.issue));
    const desired = this.compiler.desiredChild(outcome, existing, observed);
    if (desired.holds.length) throw new state.ProgrammeError('JOURNAL_HELD', 'The task journal has unresolved holds.');
    this.findings.push(...desired.findings);
    const effects = [];
    this.compiler.diffChild(outcome, existing, desired.doc, desired.checks, observed, this.findings, effects, desired.journals);
    this.effects.push(...effects.filter(effect => ['attach', 'reparent'].includes(effect.kind)));
    if (this.readCache) {
      if (this.readCache.children.has(outcome.issue)) this.readCache.counts.reread++;
      if (issue.state === 'closed' && ['DONE', 'RETIRED'].includes(desired.doc.lifecycle) && !desired.doc.pending_effects.length) {
        this.readCache.setChild(outcome.issue, { updated_at: issue.updated_at, read_at: this.now(), comment_count: issue.comments,
          sub_total: issue.sub_issues_total, comments, pr: history.current?.state === 'MERGED' ? history.current : null });
      } else this.readCache.dropChild(outcome.issue);
    }
    this.compiler.pass.tick();
    return desired.doc;
  }
  save({ parent, children, base, pagesConfirmed }) {
    if (parent.outcomes.some(outcome => ['CORE', 'HARDENING', 'LATER'].includes(outcome.class))) this.findings.push({ code: 'CLASS_LEGACY', issue: parent.parent_issue });
    for (const [number, next] of children) {
      const previous = base.children.get(number);
      if (previous && ['lifecycle', 'completed_at', 'before_close', 'closed_by_sweep'].every(key => JSON.stringify(previous[key]) === JSON.stringify(next[key]))) continue;
      const observed = this.issues.get(number);
      const fresh = this.reader.issue(number);
      if (!fresh?.complete || !observed || ['state', 'state_reason', 'closed_at', 'parent'].some(key => fresh[key] !== observed[key])) {
        children.delete(number); parent.sweep.queue = [...new Set([number, ...parent.sweep.queue])]; parent.sweep.reason = 'state conflict';
      }
    }
    if (this.compiler.pass.stopped) this.findings.push({ code: 'PASS_STOPPED', issue: parent.parent_issue, diagnostics: this.compiler.pass.stopped });
    parent.attention = state.foldAttention(parent.attention, { source: 'reconcile', complete: false, seen: this.findings, now: this.now() });
    const oneTime = new Set(this.compiler.oneTimeHolds(parent.attention, new Map([...base.children, ...children])));
    parent.attention = state.foldAttention(parent.attention, { source: 'reconcile', complete: true, seen: this.findings, now: this.now(),
      hold: (parent.attention || []).filter(entry => !FACT_FINDINGS.includes(entry.code) || !children.has(entry.issue) || oneTime.has(entry.id)).map(entry => entry.id) });
    if (pagesConfirmed && !parent.sweep.queue.length && !this.findings.some(entry => entry.code === 'PASS_STOPPED')) {
      parent.attention = state.foldAttention(parent.attention, { source: 'reconcile', complete: true, seen: [], now: this.now(),
        hold: (parent.attention || []).filter(entry => entry.code !== 'PASS_STOPPED').map(entry => entry.id) });
    }
    const completeInventory = this.prLists.size === 2 && parent.outcomes.every(outcome => this.links.get(outcome.issue)?.complete);
    if (completeInventory) {
      const listed = [...this.prLists.values()].flat();
      const references = state.referencedIssues(listed);
      const linked = new Set([...this.links.values()].flatMap(link => link.history.map(pr => pr.number)));
      for (const number of [parent.parent_issue, ...parent.outcomes.map(outcome => outcome.issue)]) for (const pr of references.get(number) || []) linked.add(pr);
      const seen = listed.filter(pr => !state.excludedGraphPr(pr) && !linked.has(pr.number)
        && (pr.state === 'OPEN' || parent.private.graph_pr_watermark && Date.parse(pr.closed_at) > Date.parse(parent.private.graph_pr_watermark)))
        .map(pr => ({ code: 'PR_WITHOUT_TASK', issue: pr.number }));
      const hold = (parent.attention || []).filter(entry => entry.code !== 'PR_WITHOUT_TASK' || !linked.has(entry.issue) && !state.excludedGraphPr(listed.find(pr => pr.number === entry.issue))).map(entry => entry.id);
      parent.attention = state.foldAttention(parent.attention, { source: 'reconcile', complete: true, seen, hold, now: this.now() });
      if (!parent.sweep.queue.length) parent.private = { ...parent.private, graph_pr_watermark: parent.sweep.last_started_at };
    }
    const observed = { issues: this.issues, comments: this.comments, subIssues: this.subIssues, prs: new Map(), prPages: new Map(), prHeads: new Map(), references: new Map() };
    const recoverHolds = [];
    const recovered = this.compiler.recover([{ kind: 'parent', number: parent.parent_issue, doc: parent }], observed, recoverHolds);
    parent.pending_effects = parent.pending_effects.filter(effect => !recovered.some(entry => entry.intent_id === effect.intent_id && entry.outcome !== 'UNKNOWN'
      && !(entry.outcome === 'NOT_DONE' && effect.kind === 'post_parent_repair')));
    if (!parent.sweep.queue.length) this.compiler.diffOrder(parent, observed, this.effects, this.findings, new Map(), new Map([...base.children, ...children]));
    for (const effect of this.effects) {
      const intent_id = state.intentId(effect.kind, effect.target);
      if (!parent.pending_effects.some(entry => entry.intent_id === intent_id)) parent.pending_effects.push({ intent_id, kind: effect.kind, target: effect.target, state: 'IN_FLIGHT' });
    }
    const initial = base.base.documents;
    const changes = [{ kind: 'parent', number: parent.parent_issue, next: parent, previous: base.parent, sha: initial.get(`parent:${parent.parent_issue}`).sha },
      ...[...children].map(([number, next]) => ({ kind: 'child', number, next, previous: base.children.get(number) || null, sha: initial.get(`child:${number}`)?.sha || null }))];
    const result = this.store.writeBatch(changes, { writer: this.writer, parentNumber: parent.parent_issue, onConflicts: (accepted, conflicts) => {
      const next = accepted.find(change => change.kind === 'parent').next;
      if (conflicts.length) { next.sweep.queue = [...new Set([...conflicts, ...next.sweep.queue])]; next.sweep.reason = 'state conflict'; }
    } });
    this.compiler.reportStoredProgress(result.documents.get(`parent:${parent.parent_issue}`).doc);
    return { parent: result.documents.get(`parent:${parent.parent_issue}`).doc, stateWrites: result.written,
      children: new Map([...result.documents].filter(([key]) => key.startsWith('child:')).map(([, entry]) => [entry.doc.issue, entry.doc])), base: result };
  }
  draw(snapshot) {
    this.requests.phaseAt('pages');
    const beforeMode = this.requests.settling;
    this.requests.settling = true;
    const parent = snapshot.parent;
    const pending = [...new Set([parent.parent_issue, ...(parent.sweep?.page_queue || parent.outcomes.map(outcome => outcome.issue))])];
    const remaining = [];
    let writes = 0;
    try {
      if (!this.pageRowsRead && pending.some(number => number !== parent.parent_issue)) {
        for (const row of this.reader.subIssueRows(parent.parent_issue)) if (row.facts?.complete) this.issues.set(row.number, row.facts);
        this.pageRowsRead = true;
      }
      for (const number of pending) {
        // Keep a fixed settlement reserve even when this redraw is at the start of a pass.
        if (this.requests.count > this.requests.cap - 16 || this.requests.nowMs() >= this.requests.deadline - 60000) { remaining.push(number); continue; }
        try {
          const before = number === parent.parent_issue ? this.reader.issue(number) : this.issues.get(number) || this.reader.issue(number);
          if (!before) { remaining.push(number); continue; }
          this.issues.set(number, before);
          const comments = this.comments.get(number) || (number === parent.parent_issue ? this.compiler.discussion(number, before, this.readCache) : before.comments === 0 ? [] : this.reader.comments(number));
          this.comments.set(number, comments);
          const blocks = this.compiler.renderAll(parent, snapshot.children, this.issues, this.comments);
          if (!blocks.has(number)) { remaining.push(number); continue; }
          const effects = [], findings = [], holds = [];
          this.compiler.diffBlocks(parent, snapshot.children, { issues: this.issues, comments: this.comments, prPages: new Map(), prs: new Map(), references: new Map(), prHeads: new Map() }, null, effects, findings, holds, [number]);
          if (holds.length || effects.some(effect => effect.kind !== 'replace_block')) { remaining.push(number); continue; }
          const effect = effects.find(effect => effect.kind === 'replace_block');
          if (!effect) continue;
          const next = this.compiler.projectBody(number, before.body, blocks.get(number), comments, this.version,
            this.compiler.navFor(parent, number, snapshot.children), number === parent.parent_issue ? state.renderCurrentBlockBody(parent, snapshot.children, this.issues, this.now()) : null,
            this.compiler.topicFor(parent, number, this.issues), undefined, { parent, relay: this.compiler.taskRelay(number, before).relay });
          if (next.overflow.length || next.refused || next.body.length >= this.compiler.threshold) { remaining.push(number); continue; }
          if (next.body === before.body) continue;
          if (next.relaid && next.moves) { this.guard(); this.store.savePageCopy(number, before); }
          const latest = this.reader.issue(number);
          if (!latest || latest.body !== before.body || latest.updated_at !== before.updated_at) { remaining.push(number); continue; }
          this.guard();
          const response = this.mutator.writeBody(number, next.body);
          const after = this.reader.issue(number);
          if (response.status < 200 || response.status >= 300 || after?.body !== next.body) { remaining.push(number); continue; }
          writes++;
        } catch (error) {
          if (['STALE_WRITER', 'PASS_LOCK_LOST', 'GH_AUTH'].includes(error.code)) throw error;
          remaining.push(number);
        }
      }
    } finally { this.requests.settling = beforeMode; }
    this.pageWrites += writes;
    return { complete: remaining.length === 0, remaining, writes };
  }
  executeEffects(snapshot) {
    if (!this.effects.length) return;
    const compiler = new state.Reconciler({ store: new SweepEffectStore({ store: this.store }), reader: this.reader,
      mutator: this.mutator, binding: this.binding, writer: this.writer, toolkitVersion: this.version, now: this.now, refreshFacts: true, pass: this.compiler.pass });
    const children = new Map([...snapshot.children].map(([number, doc]) => [number, { doc }]));
    const observed = { issues: this.issues, comments: this.comments, subIssues: this.subIssues, prs: new Map(), prPages: new Map(), references: new Map(), prHeads: new Map(), discovery: new Map() };
    try {
      const result = compiler.apply({ parent: snapshot.parent, children, observed, effects: this.effects, findings: this.findings, holds: [], resolutions: [], complete: false });
      this.effectResults = result.results; this.effectHolds = result.holds;
      for (const effect of this.effects) this.issues.delete(effect.target.issue);
    } catch (error) {
      if (!['SWEEP_STOP', 'STATE_WRITE_DEFERRED'].includes(error.code)) throw error;
      this.effectHolds = [{ code: error.code, detail: 'The remaining effects wait for another saved sweep pass.' }];
    }
  }
  run() {
    this.readCache?.beginPass();
    try {
      const report = new ProgrammeSweep({ now: this.now, requests: this.requests, canWork: () => this.requests.canWork(),
        load: () => (this.snapshot = this.load()), discover: (...args) => this.discover(...args),
        readTask: (...args) => this.readTask(...args), save: data => { const snapshot = this.save(data); this.executeEffects(snapshot); return snapshot; }, draw: snapshot => this.draw(snapshot) }).run();
      if (this.readCache) {
        this.readCache.counts.reused = Math.max(0, this.readCache.children.size - this.readCache.counts.reread);
        report.reads = { ...this.readCache.counts };
      }
      report.effects = [...this.effects, ...this.findings.filter(entry => entry.code === 'CHILD_ADDED').map(entry => ({ kind: 'add_native_children', target: { issue: entry.issue } }))];
      report.holds.push(...(this.effectHolds || [])); report.results.push(...(this.effectResults || []));
      report.store = this.binding.store;
      report.writes.github = this.mutator.mutations;
      return report;
    } finally { this.readCache?.save(); }
  }
}

module.exports = { LiveProgrammeSweep };
