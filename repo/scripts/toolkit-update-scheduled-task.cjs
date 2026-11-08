#!/usr/bin/env node
'use strict';
// `toolkit update scheduled task`: plan all local checkouts, then use the existing
// task owner and repair path. Questions are returned to the host UI, never read
// from stdin and never answered by a scheduled job.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const tasks = require('./toolkit-tasks.cjs');
const windows = require('./toolkit-windows-tasks.cjs');
const health = require('./toolkit-task-health.cjs');
const { ProgrammeJobLock } = require('./toolkit-programme-lock.cjs');
const { takeLock } = require('../../skills/github-program-reconciler/scripts/programme-lock.cjs');
const KINDS = Object.freeze(Object.keys(windows.JOBS).sort());
const approvalFile = home => path.join(tasks.userStateDir(home), 'scheduled-task-approval.json');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validRef = value => typeof value === 'string' && /^[A-Za-z0-9_.:/ -]{1,200}$/.test(value) && !tasks.looksSecret(value);
function readApproval(home) {
  try {
    const value = JSON.parse(fs.readFileSync(approvalFile(home), 'utf8'));
    if (value.schema !== 'toolkit.scheduled-task-approval.v1' || !['standing', 'no'].includes(value.decision) || !validRef(value.answer_ref) || !Number.isFinite(Date.parse(value.date)) || !/^\d+\.\d+\.\d+$/.test(value.toolkit_version) || !Array.isArray(value.kinds) || value.kinds.some(kind => typeof kind !== 'string') || new Set(value.kinds).size !== value.kinds.length) throw new Error('Invalid approval');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Scheduled task approval unreadable; no task changed'); }
}
function saveApproval(home, answer, version, now = new Date()) {
  if (!['standing', 'no'].includes(answer?.decision) || !validRef(answer.answer_ref)) throw new Error('Actual host UI answer reference required');
  const value = { schema: 'toolkit.scheduled-task-approval.v1', decision: answer.decision, date: now.toISOString(), toolkit_version: version, kinds: [...KINDS], answer_ref: answer.answer_ref };
  health.writeLocal(approvalFile(home), value); return value;
}
const approvalQuestion = () => ({ id: 'scheduled-task-approval', kind: 'approval', question_ui: 'host',
  title: 'May Toolkit update your scheduled tasks on this computer?',
  detail: 'Create, update and remove the listed fixed scheduled tasks on this computer across enrolled and discovered GitHub checkouts, including moved-checkout repair. New task kinds and hand-edited definitions ask again. Owner stops remain stopped. Cloud triggers, permission blocks and other tasks are excluded. Task kinds: TASK HEALTH, FOOTER SWEEP, PROGRAMME SWEEP and SHARD TIMINGS.',
  options: ['standing', 'no'], kinds: [...KINDS] });
function discoverCheckouts(folder, { readDir = dir => fs.readdirSync(dir, { withFileTypes: true }) } = {}) {
  if (!fs.existsSync(folder)) return [];
  if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) throw new Error('GitHub checkout folder is not a directory');
  const found = [];
  for (const item of readDir(folder)) {
    if (!item.isDirectory() || item.isSymbolicLink() || item.name.startsWith('.')) continue;
    const root = path.join(folder, item.name);
    if (fs.existsSync(path.join(root, '.git'))) found.push(root);
    else {
      let children;
      try { children = readDir(root); } catch { found.push({ root, held: true, reason: 'Checkout folder could not be read; check local folder access, then retry.' }); continue; }
      for (const child of children) {
      if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.')) continue;
      const candidate = path.join(root, child.name);
      if (fs.existsSync(path.join(candidate, '.git'))) found.push(candidate);
      }
    }
  }
  return found;
}
function healthEntryProblem(entry, definition, computerId) {
  if (!entry) return null;
  if (entry.id !== definition.id || entry.folder !== definition.folder || entry.name !== definition.name || !entry.enrolled || entry.adopted) return 'Health task enrolment identity is unproven; owner inspection required';
  if (entry.job_owner !== computerId) return 'Health task enrolment belongs to another computer; owner inspection required';
  return null;
}
class TaskUpdater {
  constructor({ home = os.homedir(), toolkitRoot = path.resolve(__dirname, '../..'), githubFolder, scheduler, now = () => new Date(), version,
    checkoutDeps = {}, discover = discoverCheckouts, desired = windows.desiredTasks, healthOwner, question, nodePath = process.execPath } = {}) {
    Object.assign(this, { home, toolkitRoot, githubFolder: githubFolder || path.join(home, 'GitHub'), scheduler: scheduler || windows.powerShellScheduler(), now, version: version || JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/toolkit-local-bridge/version.json'), 'utf8')).version, checkoutDeps, discover, desired, question, nodePath });
    this.health = healthOwner || new health.TaskHealth({ home, scheduler: this.scheduler, platform: 'win32' });
  }
  registry() { const read = tasks.readRegistry(this.home); if (read.status !== 'ok') throw new Error('Task registry unreadable; update held'); return read.tasks; }
  desiredAt(root) { return this.desired({ checkout: root, toolkitRoot: this.toolkitRoot, nodePath: this.nodePath, home: this.home, deps: this.checkoutDeps }); }
  owner(answers = []) { return new windows.WindowsTaskOwner({ home: this.home, scheduler: this.scheduler, now: this.now, repairOwned: true, preserveOwnerStops: true, allowIndependentChoice: true, taskChoice: answers }); }
  plan() {
    const entries = this.registry();
    let discovered;
    try { discovered = this.discover(this.githubFolder); }
    catch { discovered = [{ root: this.githubFolder, held: true, reason: 'GitHub checkout folder could not be read; check local folder access, then retry.' }]; }
    const roots = [...new Set([...entries.filter(e => e.host === 'windows' && e.job !== 'task-health' && !e.adopted && e.checkout).map(e => e.checkout), ...discovered.filter(row => typeof row === 'string')])];
    const plans = [], seen = new Set();
    plans.push(...discovered.filter(row => typeof row !== 'string'));
    for (const root of roots) {
      try {
        const desired = this.desiredAt(root), key = desired.repository.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        for (let index = plans.length - 1; index >= 0; index--) if (plans[index].held && plans[index].repository?.toLowerCase() === key) plans.splice(index, 1);
        const stopped = entries.some(e => e.host === 'windows' && e.job !== 'task-health' && e.repository?.toLowerCase() === key && e.stopped_by_owner);
        const plan = stopped ? { repository: desired.repository, items: [], stopped: true, next_step: 'Stopped by owner; left alone.' } : this.owner().plan(desired);
        plans.push({ root, desired, plan });
      } catch { plans.push({ root, repository: entries.find(entry => entry.host === 'windows' && entry.checkout === root)?.repository || null, held: true, reason: 'Checkout or fresh ownership could not be verified; left alone.' }); }
    }
    const cloud = entries.filter(e => e.host !== 'windows').map(e => ({ name: e.name, repository: e.repository, host: e.host, schedule: e.schedule, source: 'from record, not checked live', change: e.toolkit_version && e.toolkit_version !== this.version ? 'Coordinator: check this recorded task against current Toolkit instructions.' : 'Coordinator: verify the recorded schedule and definition; never applied here.' }));
    const first = plans.find(row => row.desired);
    const computer_task = first ? this.healthPlan(first.desired) : null;
    // Read the same validated ownership record as apply, without questions or writes.
    let ownership = { remove: [] };
    const hold = (rows, error) => { for (const row of rows) { row.held = true; row.reason = `Computer ownership could not be verified (${tasks.safeText(error.message)}); inspect the evidence store, then retry.`; } };
    let targets = [];
    // Found checkouts that are not enrolled yet are looked up in their own store too, so a
    // recorded owner elsewhere is honoured before any job is created here.
    const enrolled = new Set(entries.filter(e => e.host === 'windows' && !e.adopted && e.job !== 'task-health').map(e => e.repository?.toLowerCase()));
    const found = plans.filter(row => row.desired && row.root && !enrolled.has(row.desired.repository.toLowerCase())).map(row => ({ checkout: row.root, repository: row.desired.repository }));
    try { targets = this.health.stores(found); } catch (error) { hold(plans, error); }
    this.targets = targets;
    for (const target of targets) {
      // Each store answers only for the repositories whose own binding names it.
      const rows = plans.filter(row => row.desired && target.repositories.includes(row.desired.repository.toLowerCase()));
      if (!rows.length) continue;
      try { ownership.remove.push(...this.ownership(target, { plans: rows }, { readOnly: true }).remove); } catch (error) { hold(rows, error); }
    }
    for (const row of plans) if (row.desired && ownership.remove.includes(row.desired.repository.toLowerCase())) {
      row.plan = { ...row.plan, items: entries.filter(e => e.host === 'windows' && e.job !== 'task-health' && !e.adopted && !e.stopped_by_owner && e.repository?.toLowerCase() === row.desired.repository.toLowerCase()).map(entry => ({ definition: { ...entry }, action: 'remove' })) };
    }
    const changes = plans.flatMap(row => (row.plan?.items || []).map(item => ({ repository: row.plan.repository, task: item.definition.name, action: item.action === 'retire' ? 'remove' : item.action })));
    if (computer_task) changes.push({ repository: null, task: 'TASK HEALTH', action: computer_task.action });
    return { plans, cloud, computer_task, changes, computer: tasks.computerIdentity(this.home) ? health.computerLabel(this.home) : 'This computer has not been initialised' };
  }
  ask(question) {
    const answer = this.question?.(question);
    if (!answer) return { pending: question };
    if (!validRef(answer.answer_ref)) throw new Error('Host UI answer has no actual answer reference');
    return { answer };
  }
  approval() {
    const existing = readApproval(this.home);
    if (existing && (existing.decision === 'no' || KINDS.every(kind => existing.kinds.includes(kind)))) return { allowed: existing.decision === 'standing' };
    const answer = this.ask(approvalQuestion()); if (answer.pending) return answer;
    const saved = saveApproval(this.home, answer.answer, this.version, this.now());
    return { allowed: saved.decision === 'standing' };
  }
  ownership(target, local, { readOnly = false } = {}) {
    if (readOnly) return this.readOwnership(target, local, true);
    const lock = new ProgrammeJobLock({ home: this.home, key: target.key }).take();
    if (!lock) throw new Error('Ownership store busy; update held');
    try { return this.readOwnership(target, local, false); } finally { lock.release(); }
  }
  readOwnership(target, local, readOnly) {
    // A computer without a saved identity (tasks enrolled by an older Toolkit) has never been
    // chosen as an owner; apply creates the identity before any question or write.
    const others = target.store.list(), label = tasks.computerIdentity(this.home) ? health.computerLabel(this.home) : null;
    if (!label && !readOnly) throw new Error('Computer identity missing; update held');
    const previous = target.store.read('task-health/owners.json'), owners = previous.doc || { schema: 'toolkit.task-owners.v1', repos: {} };
    if (owners.schema !== 'toolkit.task-owners.v1' || !owners.repos || typeof owners.repos !== 'object' || Array.isArray(owners.repos) || tasks.looksSecret(JSON.stringify(owners))) throw new Error('Ownership record invalid; update held');
    for (const [repo, value] of Object.entries(owners.repos)) if (!tasks.REPOSITORY.test(repo) || !/^computer-[a-f0-9]{12}$/.test(value.computer || '') || !validRef(value.answer_ref)) throw new Error('Ownership record invalid; update held');
    let changed = false;
    const remove = [], questions = [], held = [];
    for (const row of local.plans.filter(row => row.desired && !row.plan.stopped)) {
      const repository = row.desired.repository.toLowerCase();
      const labels = [...new Set([label, ...others.filter(doc => doc.repos.some(repo => repo.repository.toLowerCase() === repository && repo.jobs.some(job => job.result !== 'stopped'))).map(doc => doc.computer)])].sort();
      let owner = owners.repos[repository];
      if (!owner && labels.length > 1 && !readOnly) {
        const question = { id: `job-owner-${digest(repository).slice(0, 12)}`, kind: 'ownership', question_ui: 'host', repository, title: `Which computer keeps the jobs for ${row.desired.repository}?`, detail: `This computer is ${label}.`, options: labels, observation: digest(labels) };
        const result = this.ask(question); if (result.pending) { questions.push(result.pending); held.push(repository); continue; }
        if (!labels.includes(result.answer.computer) || result.answer.observation !== question.observation) throw new Error('Computer choice is stale or invalid');
        owner = owners.repos[repository] = { computer: result.answer.computer, answer_ref: result.answer.answer_ref, date: this.now().toISOString() }; changed = true;
      }
      if (owner && owner.computer !== label) remove.push(repository);
    }
    if (changed) target.store.put('task-health/owners.json', owners, previous.sha);
    return { remove, questions, held };
  }
  relinquish(repository) {
    // This is ownership transfer, not moved-checkout repair. Scope is the exact
    // local enrolments; independent XML and registry comparisons precede removal.
    const lock = takeLock(path.join(tasks.userStateDir(this.home), 'tasks/apply-registry.lock'));
    if (!lock) throw new Error('Another task update is running');
    try {
      const entries = this.registry().filter(e => e.host === 'windows' && !e.adopted && !e.stopped_by_owner && e.job !== 'task-health' && e.repository?.toLowerCase() === repository);
      for (const entry of entries) {
        if (!tasks.localTaskOwner(entry.job_owner, tasks.computerIdentity(this.home)?.id)) throw new Error('Foreign local enrolment; removal held');
        const live = this.scheduler.list(entry.folder).find(task => task.name === entry.name);
        if (!live || windows.parseMarker(live.description)?.id !== entry.id || JSON.stringify(windows.enrolledDefinition(live)) !== JSON.stringify(entry.enrolled)) throw new Error('Transferred task changed; inspect and answer keep or replace first');
      }
      for (const entry of entries) {
        if (this.desiredAt(entry.checkout).repository.toLowerCase() !== repository) throw new Error('Transferred checkout origin changed; removal held');
        const current = this.registry().find(e => e.id === entry.id), live = this.scheduler.list(entry.folder).find(task => task.name === entry.name);
        if (JSON.stringify(current) !== JSON.stringify(entry) || JSON.stringify(windows.enrolledDefinition(live)) !== JSON.stringify(entry.enrolled)) throw new Error('Transferred task changed before removal');
        tasks.writeTaskBackup(this.home, entry.id, { task: live, registry: entry });
        this.scheduler.unregister(entry.folder, entry.name, entry.id, live);
        if (this.scheduler.list(entry.folder).some(task => task.name === entry.name)) throw new Error('Removal readback failed');
        tasks.updateRegistry(this.home, rows => rows.map(row => row.id === entry.id ? { ...row, stopped_by_owner: true, stopped_at: this.now().toISOString(), ownership_transferred: true } : row));
      }
      return entries.map(entry => ({ task: entry.id, action: 'remove', done: true }));
    } finally { lock.release(); }
  }
  healthDefinition(desired) {
    const source = desired.definitions.find(row => row.job === 'task-health');
    if (!source) throw new Error('Health task definition missing');
    const folder = 'TOOLKIT-HEALTH', id = windows.taskId(folder, 'task-health');
    // Computer slot is independent of repository assignments, including old poisoned rows.
    const minute = tasks.computerIdentity(this.home) ? parseInt(digest(tasks.computerIdentity(this.home).id).slice(0, 8), 16) % 9 + 1 : 1;
    const schedule = require('./toolkit-task-schedule.cjs').scheduleFor('task-health', minute);
    const definition = { ...source, folder, id, repository: null, name: windows.taskName(folder, 'task-health'), schedule, schedule_text: windows.describeSchedule(schedule), arguments: source.arguments.replace(/--task-id [a-z0-9-]+$/, `--task-id ${id}`) };
    delete definition.repo_minute;
    definition.def = windows.definitionDigest(definition);
    definition.description = `${folder}: TASK HEALTH. ${definition.purpose} [toolkit-task v1 id=${id} def=${definition.def}]`;
    return definition;
  }
  healthPlan(desired) {
    try {
      const entries = this.registry(), records = entries.filter(row => row.host === 'windows' && row.job === 'task-health' && !row.adopted);
      const definition = this.healthDefinition(desired), entry = records[0];
      if (records.length > 1) return { action: 'refused', reason: 'Multiple health tasks; owner reconciliation required' };
      if (entry?.stopped_by_owner) return { action: 'stopped by owner' };
      const problem = healthEntryProblem(entry, definition, tasks.computerIdentity(this.home)?.id);
      if (problem) return { action: 'refused', reason: problem };
      const live = this.scheduler.list(definition.folder).find(row => row.name === definition.name);
      if (live && (!entry || entry.adopted || entry.id !== definition.id || !entry.enrolled)) return { action: 'refused', reason: 'Unowned health task' };
      if (live?.state === 'Disabled' && !entry.toolkit_missing) return { action: 'refused', reason: 'Disabled by owner; left alone' };
      if (live && JSON.stringify(windows.enrolledDefinition(live)) !== JSON.stringify(entry.enrolled)) return { action: 'owner-choice-required', reason: 'Keep your changes or replace with Toolkit definition?' };
      return { action: live ? windows.verifiedDefinition(live, definition) ? 'current' : 'update' : 'create', definition };
    } catch { return { action: 'refused', reason: 'Health task could not be read; no native permission inferred' }; }
  }
  installHealth(desired) {
    const lock = takeLock(path.join(tasks.userStateDir(this.home), 'tasks/apply-registry.lock'));
    if (!lock) throw new Error('Another task update is running');
    try {
      const entries = this.registry(), records = entries.filter(e => e.host === 'windows' && e.job === 'task-health' && !e.adopted);
      if (records.length > 1) throw new Error('Multiple health tasks; owner reconciliation required');
      const entry = records[0], definition = this.healthDefinition(desired);
      if (entry?.stopped_by_owner) return { action: 'stopped by owner' };
      const { folder, id } = definition;
      const problem = healthEntryProblem(entry, definition, tasks.computerIdentity(this.home)?.id);
      if (problem) throw new Error(problem);
      const live = this.scheduler.list(folder).find(row => row.name === definition.name);
      if (live && (!entry || entry.id !== id || entry.folder !== folder || !entry.enrolled || entry.adopted)) throw new Error('Health task unowned; owner inspection required');
      if (live && JSON.stringify(windows.enrolledDefinition(live)) !== JSON.stringify(entry.enrolled)) {
        if (windows.parseMarker(live.description)?.id !== id) throw new Error('Health task marker changed; exact owner inspection required');
        const observation = digest({ id, live: windows.enrolledDefinition(live), desired: definition.def });
        const result = this.ask({ id, kind: 'task-choice', question_ui: 'host', title: "Keep your changes or replace with Toolkit's original?", options: ['keep', 'replace'], observation });
        if (result.pending) return result;
        if (result.answer.observation !== observation || !['keep', 'replace'].includes(result.answer.outcome)) throw new Error('Health task answer is stale');
        if (result.answer.outcome === 'keep') return { refused: true, task: id, action: 'owner kept changes' };
      }
      if (live?.state === 'Disabled' && !entry?.toolkit_missing) return { refused: true, task: id, action: 'disabled by owner; left alone' };
      if (live && windows.verifiedDefinition(live, definition)) {
        windows.installLauncher(this.home);
        tasks.updateRegistry(this.home, rows => {
          if (JSON.stringify(rows.find(row => row.id === id)) !== JSON.stringify(entry)) throw new Error('Health enrolment changed before write');
          return rows.map(row => { if (row.id !== id) return row; const { repo_minute, ...rest } = row; return { ...rest, repository: null, toolkit_version: this.version }; });
        });
        return { action: 'current', task: id };
      }
      // The standing approval includes recreation of this independently enrolled fixed task.
      if (live) tasks.writeTaskBackup(this.home, id, { task: live, registry: entry });
      let written = null;
      try {
        windows.installLauncher(this.home); this.scheduler.register(definition, live || null);
        const saved = this.scheduler.list(folder).find(row => row.name === definition.name);
        if (!windows.verifiedDefinition(saved, definition)) throw new Error('Health task readback failed');
        written = saved;
        tasks.updateRegistry(this.home, rows => {
          if (JSON.stringify(rows.find(row => row.id === id)) !== JSON.stringify(entry)) throw new Error('Health enrolment changed before write');
          return [...rows.filter(row => row.id !== id), { id, host: 'windows', folder, name: definition.name, repository: null, schedule: definition.schedule_text, purpose: definition.purpose, created: entry?.created || this.now().toISOString(), created_by: 'toolkit update scheduled task', model: null, effort: null, job: 'task-health', definition: definition.def, enrolled: windows.enrolledDefinition(saved), checkout: definition.checkout, toolkit_root: definition.toolkit_root, job_owner: tasks.computerIdentity(this.home).id, toolkit_version: this.version }];
        });
      } catch {
        let restoration = 'No verified replacement to restore; inspect the local task.';
        if (written && JSON.stringify(this.registry().find(row => row.id === id)) === JSON.stringify(entry)) {
          try {
            const current = this.scheduler.list(folder).find(row => row.name === definition.name);
            if (JSON.stringify(windows.enrolledDefinition(current || {})) !== JSON.stringify(windows.enrolledDefinition(written))) throw new Error('Concurrent edit');
            if (live) this.scheduler.restore(definition, live, written);
            else this.scheduler.unregister(folder, definition.name, id, written);
            const restored = this.scheduler.list(folder).find(row => row.name === definition.name);
            if (live ? JSON.stringify(windows.enrolledDefinition(restored || {})) !== JSON.stringify(windows.enrolledDefinition(live)) : Boolean(restored)) throw new Error('Restoration readback failed');
            restoration = live ? 'Previous definition restored and read back.' : 'New registration removed and read back.';
          } catch { restoration = 'Restoration held; preserve the backup and inspect the local task.'; }
        }
        throw new Error(`Health task update failed. ${restoration}`);
      }
      return { action: live ? 'update' : 'create', task: id };
    } finally { lock.release(); }
  }
  run({ apply = false } = {}) {
    const local = this.plan();
    if (!apply) return local;
    const approval = this.approval(); if (!approval.allowed) return { ...local, ...(approval.pending ? { questions: [approval.pending] } : { declined: true }) };
    tasks.computerIdentity(this.home, { create: true });
    local.computer = health.computerLabel(this.home);
    const ownership = { remove: [], questions: [], held: [] };
    const results = [];
    const holdAll = (rows, error) => {
      for (const repository of rows.filter(row => row.desired).map(row => row.desired.repository.toLowerCase())) {
        if (ownership.held.includes(repository)) continue;
        ownership.held.push(repository); results.push({ repository, refused: true, reason: tasks.safeText(error.message) });
      }
    };
    // The plan just looked up and verified the stores; apply reuses them instead of reading every checkout again.
    const targets = this.targets || [];
    for (const target of targets) {
      // Ownership for a repository is read and written only in that repository's own store.
      const rows = local.plans.filter(row => row.desired && target.repositories.includes(row.desired.repository.toLowerCase()));
      if (!rows.length) continue;
      try {
        const read = this.ownership(target, { plans: rows });
        ownership.remove.push(...read.remove); ownership.questions.push(...read.questions); ownership.held.push(...read.held);
      } catch (error) { holdAll(rows, error); }
    }
    const questions = [...ownership.questions];
    // A native write failure (for example a denied registration) stops every later write in this run,
    // including TASK HEALTH; refusals, held rows and pending questions still let later repositories continue.
    const writeFailed = result => Array.isArray(result?.items) && result.items.some(item => item.done === false);
    let stopped = null;
    for (const row of local.plans) {
      if (stopped) {
        if (row.desired && !row.plan.stopped && !row.held) results.push({ repository: row.desired.repository, refused: true, reason: 'Held: an earlier native task write failed in this run.' });
        continue;
      }
      if (!row.desired || row.plan.stopped || row.held || ownership.held?.includes(row.desired.repository.toLowerCase())) continue;
      try {
        if (ownership.remove.includes(row.desired.repository.toLowerCase())) {
          try { results.push(...this.relinquish(row.desired.repository.toLowerCase())); }
          catch (error) {
            let choices = [];
            try { choices = this.owner().plan(row.desired).items.filter(item => item.action === 'owner-choice-required'); }
            catch { /* Still present the transfer recovery question; never skip later repositories. */ }
            const answers = [];
            let pending = false;
            for (const item of choices) {
              const answer = this.ask({ id: item.choice.task, kind: 'task-choice', question_ui: 'host', title: item.choice.question, options: ['keep', 'replace'], observation: item.choice.fingerprint });
              if (answer.pending) { questions.push(answer.pending); pending = true; }
              else answers.push({ task: item.choice.task, outcome: answer.answer.outcome, observed: answer.answer.observation, answer_ref: answer.answer.answer_ref });
            }
            if (choices.length) {
              if (pending) results.push({ repository: row.desired.repository, refused: true, reason: 'Ownership transfer awaits the exact task choice.' });
              else {
                const repaired = this.owner(answers).apply(row.desired); results.push(repaired);
                if (writeFailed(repaired)) { stopped = row.desired.repository; continue; }
                if (!repaired.refused && repaired.items.every(item => item.done)) results.push(...this.relinquish(row.desired.repository.toLowerCase()));
              }
              continue;
            }
            const question = { id: `relinquish-${digest(row.desired.repository).slice(0, 12)}`, kind: 'task-choice', question_ui: 'host', title: `Keep this computer's changed tasks for ${row.desired.repository}, or replace them before transferring?`, detail: tasks.safeText(error.message), options: ['keep', 'replace'], observation: digest(this.registry().filter(e => e.job !== 'task-health' && e.repository?.toLowerCase() === row.desired.repository.toLowerCase())) };
            const answer = this.ask(question);
            // A changed or absent participant needs the ordinary guarded repair first;
            // this transfer never turns an answer into unconditional removal authority.
            if (answer.pending) questions.push(question);
            else {
              if (answer.answer.observation !== question.observation || !['keep', 'replace'].includes(answer.answer.outcome)) throw new Error('Transfer answer is stale or invalid');
              if (answer.answer.outcome === 'replace') {
                const repaired = this.owner().apply(row.desired); results.push(repaired);
                if (writeFailed(repaired)) { stopped = row.desired.repository; continue; }
                if (!repaired.refused && repaired.items.every(item => item.done)) { results.push(...this.relinquish(row.desired.repository.toLowerCase())); continue; }
              }
            }
            results.push({ repository: row.desired.repository, refused: true, reason: question.detail, next_step: 'Preserve the tasks; resolve their direct keep-or-replace plan before retrying transfer.' });
          }
          continue;
        }
        let owner = this.owner(), plan = owner.plan(row.desired), answers = [];
        let pending = false;
        for (const item of plan.items.filter(item => item.action === 'owner-choice-required')) {
          const result = this.ask({ id: item.choice.task, kind: 'task-choice', question_ui: 'host', title: item.choice.question, options: ['keep', 'replace'], observation: item.choice.fingerprint });
          if (result.pending) { questions.push(result.pending); pending = true; continue; }
          answers.push({ task: item.choice.task, outcome: result.answer.outcome, observed: result.answer.observation, answer_ref: result.answer.answer_ref });
        }
        if (pending) { results.push({ repository: row.desired.repository, refused: true, reason: 'Awaiting the owner keep-or-replace answer.' }); continue; }
        owner = this.owner(answers);
        const applied = owner.apply(row.desired); results.push(applied);
        if (writeFailed(applied)) stopped = row.desired.repository;
      } catch (error) { results.push({ repository: row.desired.repository, refused: true, reason: tasks.safeText(error.message) }); }
    }
    const first = local.plans.find(row => row.desired);
    if (first && stopped) results.push({ task: 'task-health', refused: true, reason: `Held: the native task write for ${stopped} failed in this run.` });
    else if (first) {
      // A health failure is reported with the repository results, never in place of them.
      try {
        const installed = this.installHealth(first.desired);
        if (installed.pending) questions.push(installed.pending);
        else results.push(installed);
      } catch (error) { results.push({ task: 'task-health', refused: true, reason: tasks.safeText(error.message) }); }
    }
    return { ...local, results, ...(questions.length ? { questions } : {}) };
  }
}
function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text)), err = deps.stderr || (text => process.stderr.write(text));
  try {
    if ((deps.platform || process.platform) !== 'win32') { out('not-windows: scheduled task updates apply only on Windows.\n'); return 0; }
    let answers = null; const args = [...argv];
    const index = args.indexOf('--answers'); if (index >= 0) { if (!args[index + 1]) throw new Error('Missing host answer file'); answers = JSON.parse(fs.readFileSync(args[index + 1], 'utf8')); args.splice(index, 2); }
    if (args.some(arg => !['--apply', '--json'].includes(arg))) throw new Error('Usage: toolkit-update-scheduled-task.cjs [--apply] [--json] [--answers <host-answer-file>]');
    const result = new TaskUpdater({ ...deps, question: deps.question || (answers ? question => answers[question.id] : undefined) }).run({ apply: args.includes('--apply') });
    out(JSON.stringify(result, null, 2) + '\n');
    return result.questions ? 23 : result.declined || result.results?.some(row => row.refused || row.items?.some(item => item.done === false)) || result.plans.some(row => row.held) ? 1 : 0;
  } catch (error) { err(`Scheduled task update held: ${tasks.safeText(error.message)}\n`); return 1; }
}
module.exports = { TaskUpdater, KINDS, readApproval, saveApproval, approvalQuestion, discoverCheckouts, main };
if (require.main === module) process.exitCode = main();
