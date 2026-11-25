'use strict';

// One controller takeover, as one command: `programme.cjs takeover`. The dry run reads and reports;
// `--apply` posts the takeover record on the parent, checks it, claims the parent with it and reads
// both back. After the parent is created (`init-parent --apply`) this is the only way its epoch moves.
//
// The stop proof has one anchor: the old controller's last own write. It is the newest of
// - a commit in the programme's store path by any account but a bot, except lease, pass history,
//   journal, handover, page copy and controller settings commits and commits a refresh made
//   (REFRESH_MARK). A commit it does not know counts as the controller's, so an older copy fails
//   towards holding;
// - a comment by this account on the parent, except generated ones and other sessions' takeover records;
// - a merge to the default branch by this account.
// It is proven when the record's own GitHub time is at least QUIET_MS after that write and the same
// three reads after the record show nothing newer. The owner's own words that the old controller
// stopped replace the wait, never the second read.
//
// Comments and merges are read for this account only, so it must be the account the old controller's
// state commits and takeover record came from.
//
// The number of requests is fixed: no task document is read, however many tasks there are.
const state = require('./programme-state.cjs');
const { isArchiveComment } = require('./decision-tags.cjs');
const { INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER } = require('./decision-trace-audit.cjs');
const { FACTS } = require('./closing-comments.cjs');

const { ProgrammeError } = state;
const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCHEMA = 'toolkit.takeover.v1';
const QUIET_MS = 10 * 60 * 1000;
const PAGE = 100;
// Pages read back to find a source's last own write, and to find the record numbers in use.
const OWN_PAGES = 3;
const NUMBER_PAGES = 10;
const CLAIM_TRIES = 8;
const RENUMBER_TRIES = 5;
const TEXT_LIMIT = 300;
const LOG_LIMIT = 20;
const WRITER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const UNUSED = 'NOT USED: ';
const REPAIR_MARKER = '<!-- toolkit-parent-repair:';
// A commit of the programme's store path that is not the controller's own write.
const REFRESH_COMMIT = new RegExp(`^programme[ -]state: .*${escapeRegExp(state.REFRESH_MARK)}$`);
const STATE_COMMIT = /^programme[ -]state: /;
const OTHER_COMMITS = [/^programme sweep: /, /^programme journal: /, /^programme handover: /, /^programme page copy: /,
  /^programme state: checkpoint$/, /^programme state: \S+ r\d+ sidecar$/, /^programme state: prune \S+ sidecar$/];
const IP_ADDRESS = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const FENCE_LOST = 'EPOCH_MOVED';
// Refusals after the record that mean it can never carry a claim: the record is marked NOT USED.
const VOIDS_RECORD = new Set(['OLD_WRITER_ACTIVE', FENCE_LOST, 'ACCOUNT_MISMATCH', 'TAKEOVER_UNVERIFIED', 'STORE_UNREACHABLE']);
// Why governance does not let a takeover write here; a dry run still reports and prints the record line.
const GOVERNANCE_CODES = new Set(['GITHUB_GOVERNANCE_OFF', 'GOVERNANCE_STATE_UNAVAILABLE', 'BINDING_DISABLED', 'BINDING_MISSING', 'BINDING_INVALID']);
const STORE_CODES = new Set(['STATE_STORE_UNVERIFIED', 'STORE_NOT_PRIVATE']);

const usage = message => new ProgrammeError('USAGE', message);
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase() && String(a || '') !== '';
const ms = text => Date.parse(text || '');
const iso = value => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
const short = sha => String(sha || '').slice(0, 7);
const isBot = user => user?.type === 'Bot' || /\[bot\]$/.test(user?.login || '');
// An account that can write here: only its comments hold record numbers.
const trusted = row => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(row.author_association);
const firstLine = text => String(text || '').split(/\r?\n/)[0];

// ---- the caller's words ---------------------------------------------------------------------

// Text that goes into a public record: one line, no secret, path, address, host or session ID.
function recordText(flag, value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  const refuse = why => new ProgrammeError('RECORD_TEXT_REFUSED', `${flag} goes into a public record, so it may not hold ${why}. Nothing was read or written.`);
  if (!/\p{L}/u.test(text)) throw usage(`${flag} needs words.`);
  if (text.length > TEXT_LIMIT) throw usage(`${flag} is at most ${TEXT_LIMIT} characters.`);
  const errors = [];
  state.screenSecrets(errors, text, flag);
  if (errors.length) throw refuse('text shaped like a secret');
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Co}<>]/u.test(text)) throw refuse('control or markup characters');
  if (text.includes('://') || text.includes('@') || IP_ADDRESS.test(text) || state.HOST_LIKE.test(text)) throw refuse('an address or a mention');
  if (text.includes('\\') || require('./programme-handover.cjs').DEVICE_PATH.test(text) || /(?:^|\s)\//.test(text)) throw refuse('a path');
  if (state.SESSION_ID_SHAPE.test(text)) throw refuse('a session ID');
  return text;
}

// The command's own words, checked before anything is read.
function takeoverInput(args) {
  for (const flag of ['session', 'surface', 'next']) {
    if (typeof args[flag] !== 'string') throw usage('takeover needs --session <the new controller\'s stable writer name>, --surface "<harness and host evidence>" and --next "<next action>".');
  }
  if (!WRITER_NAME.test(args.session) || state.SESSION_ID_SHAPE.test(args.session)) {
    throw usage('--session takes the new controller\'s stable writer name (3 to 80 letters, digits, dots, hyphens or underscores), not a host session id: the record names it.');
  }
  const surface = recordText('--surface', args.surface);
  if (surface.includes(';')) throw usage('--surface may not hold a semicolon: the record separates its parts with them.');
  const ownerStop = args['owner-stop'] === undefined ? null : recordText('--owner-stop', args['owner-stop']).replace(/"/g, '\'');
  return { session: args.session, surface, next: recordText('--next', args.next).replace(/[.;]+$/, ''), ownerStop };
}

// ---- the record line ------------------------------------------------------------------------

function recordLine({ id = null, input, toolkit, epoch = null, appointment = false, old }) {
  return `${id ? `${id} ` : ''}TAKEOVER: controller ${input.session} on ${input.surface}; Toolkit main ${toolkit.main}; CONTROLLER.md blob ${toolkit.controller_blob};`
    + `${epoch === null ? '' : ` epoch ${epoch} to ${epoch + 1}${appointment ? ', appointment' : ''};`} ${old}; next: ${input.next}.`;
}

// A record line as this command posts it, or null: { id, controller, from, to, unused }.
function parseRecord(body, prefix) {
  const line = firstLine(body);
  const match = new RegExp(`^(${escapeRegExp(UNUSED)})?(${escapeRegExp(prefix)}\\d+) TAKEOVER: controller (\\S+) on [^;]+; Toolkit main [0-9a-f]{40}; CONTROLLER\\.md blob [0-9a-f]{40}; epoch (\\d+) to (\\d+)(?:, appointment)?; `).exec(line);
  return match ? { unused: Boolean(match[1]), id: match[2], controller: match[3], from: Number(match[4]), to: Number(match[5]) } : null;
}

// The next writer name in a series: `desk-controller-3` gives `desk-controller-4`.
function nextName(name, taken) {
  const [, stem, digits] = /^(.*?)(?:-(\d{1,4}))?$/.exec(name);
  for (let n = digits ? Number(digits) + 1 : 2; ; n += 1) if (!taken.includes(`${stem}-${n}`)) return `${stem}-${n}`;
}

// ---- one takeover ---------------------------------------------------------------------------

class TakeoverRun {
  // `versions` is called once for the report; it returns null or { line, ... } to show beside it.
  // `attention` is called with the parent document and returns the attention line to report.
  constructor({ store, transport, binding, repository, writer, input, now = () => new Date().toISOString(), versions = () => null, attention = () => null }) {
    Object.assign(this, { store, transport, binding, repository, writer, input, now, versions, attention });
    this.parent = binding.parent_issue;
    this.prefix = binding.writer_prefix;
    this.githubMs = null;
    this.comments = [];
  }

  get(path) {
    const response = this.transport.request('GET', path);
    const date = ms(response.headers?.date);
    if (Number.isFinite(date)) this.githubMs = date;
    return response;
  }

  // GitHub's clock, from its newest answer.
  clock() { return this.githubMs ?? ms(this.now()); }

  // ---- reads --------------------------------------------------------------------------------

  // A list of rows, newest first, page by page until `enough(rows)` or the pages run out.
  // { rows, floor }: floor is the oldest row's time when older rows were left unread, else null.
  list(path, { pages, at, enough }) {
    const rows = [];
    for (let page = 1; page <= pages; page += 1) {
      const response = this.get(`${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE}&page=${page}`);
      if (response.status !== 200 || !Array.isArray(response.json)) throw new ProgrammeError('GH_FAILED', `Reading ${path.split('?')[0]} failed (HTTP ${response.status}).`, { status: response.status });
      rows.push(...response.json);
      if (response.json.length < PAGE) return { rows, floor: null };
      if (enough(rows)) break;
    }
    return { rows, floor: at(rows.at(-1)) || null };
  }

  // One source of the stop proof: { name, read, newest: { key, at, what, url } | null, floor }.
  source(name, reader) {
    try { return { name, read: true, ...reader() }; }
    catch (error) {
      if (!error.code) throw error;
      return { name, read: false, newest: null, floor: null, reason: error.details?.status ? `HTTP ${error.details.status}` : error.code };
    }
  }

  stateCommits() {
    let newest = null;
    let floor = null;
    let author = null;
    for (const place of this.store.historyPlaces()) {
      const path = file => `repos/${place.repository}/commits?sha=${encodeURIComponent(place.branch)}&path=${encodeURIComponent(file)}`;
      // Files beside the state documents that a successor (its settings) or any gate (a handover file)
      // also saves with the evidence store command, under a message of its own.
      const excluded = new Set();
      const beside = same(place.repository, this.binding.store.repository) ? [`state/${this.binding.repository}/controller-settings.json`, `${place.path}/handover`] : [];
      for (const file of beside) {
        for (const row of this.list(path(file), { pages: 1, at: row => row?.commit?.committer?.date, enough: () => true }).rows) excluded.add(row.sha);
      }
      const own = row => !isBot(row?.author) && !excluded.has(row.sha) && !REFRESH_COMMIT.test(firstLine(row.commit?.message))
        && !OTHER_COMMITS.some(pattern => pattern.test(firstLine(row.commit?.message)));
      const { rows, floor: at } = this.list(path(place.path), { pages: OWN_PAGES, at: row => row?.commit?.committer?.date, enough: found => found.some(own) });
      const row = rows.find(own);
      if (row) {
        const entry = { key: row.sha, at: row.commit.committer.date, what: `state commit ${short(row.sha)}`, url: `https://github.com/${place.repository}/commit/${row.sha}` };
        if (!newest || ms(entry.at) > ms(newest.at)) newest = entry;
      } else if (at && (!floor || ms(at) > ms(floor))) floor = at;
      // Only the holder writes state documents, so this is the old controller's account.
      author = author || rows.find(entry => own(entry) && STATE_COMMIT.test(firstLine(entry.commit?.message)) && entry.author?.login)?.author.login || null;
    }
    return { newest, floor, author };
  }

  // The repository's comments, newest first. The same read shows the numbers in use.
  newestComments({ pages, enough }) {
    const listed = this.list(`repos/${this.repository}/issues/comments?sort=created&direction=desc`, { pages, at: row => row?.created_at, enough });
    this.comments = listed.rows;
    return listed;
  }

  onParent(row) { return new RegExp(`/repos/${escapeRegExp(this.repository)}/issues/${this.parent}$`, 'i').test(String(row?.issue_url || '')); }

  // A comment by this account on the parent that the old controller could have written: not a generated
  // one, and not a successor's takeover record for this same epoch.
  ownComment(row, fence, login) {
    if (!this.onParent(row) || !same(row.user?.login, login)) return false;
    const body = String(row.body || '');
    if (isArchiveComment(body) || [INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER, FACTS, REPAIR_MARKER].some(marker => body.includes(marker))) return false;
    const record = parseRecord(body, this.prefix);
    return !(record && record.from === fence.epoch && record.controller !== fence.holder_session);
  }

  parentComments(fence, login) {
    const own = row => this.ownComment(row, fence, login);
    const { rows, floor } = this.newestComments({ pages: OWN_PAGES, enough: found => found.some(own) });
    const row = rows.find(own);
    return row ? { newest: { key: String(row.id), at: row.created_at, what: `comment ${row.id}`, url: this.commentUrl(row) }, floor: null } : { newest: null, floor };
  }

  merges(branch, login) {
    const ref = `refs/heads/${branch}`;
    const own = row => row?.activity_type === 'pr_merge' && row.ref === ref && same(row.actor?.login, login);
    const { rows, floor } = this.list(`repos/${this.repository}/activity?activity_type=pr_merge&ref=${encodeURIComponent(ref)}&actor=${encodeURIComponent(login)}`,
      { pages: 1, at: row => row?.timestamp, enough: () => true });
    const row = rows.find(own);
    return row ? { newest: { key: String(row.id ?? row.after), at: row.timestamp, what: `merge ${short(row.after)}`, url: `https://github.com/${this.repository}/commit/${row.after}` }, floor: null } : { newest: null, floor };
  }

  // The old controller's last own write, from the three sources.
  readStop({ fence, login, branch }) {
    const sources = [this.source('state commits', () => this.stateCommits()), this.source('parent comments', () => this.parentComments(fence, login)), this.source('merges', () => this.merges(branch, login))];
    const last = sources.filter(entry => entry.newest).sort((a, b) => ms(b.newest.at) - ms(a.newest.at))[0] || null;
    // With no own write found, nothing is newer than the point each source was read back to.
    const floor = sources.map(entry => entry.floor).filter(Boolean).sort((a, b) => ms(b) - ms(a))[0] || null;
    const since = last && (!floor || ms(last.newest.at) >= ms(floor)) ? last.newest.at : floor;
    return { sources, last: last ? { source: last.name, ...last.newest } : null, since, unread: sources.filter(entry => !entry.read).map(entry => `${entry.name} (${entry.reason})`) };
  }

  // Whether the stop stands at `at` (GitHub's time of the record, or now before there is one).
  stopHold(stop, at) {
    if (this.input.ownerStop) return null;
    if (stop.unread.length) {
      return new ProgrammeError('STOP_UNREADABLE', `The old controller's last write could not be read from: ${stop.unread.join(', ')}. That is no proof that it stopped. Run takeover again, or pass the owner's own words that it stopped with --owner-stop.`);
    }
    if (stop.since && !(at - ms(stop.since) >= QUIET_MS)) {
      const what = stop.last && stop.last.at === stop.since ? `the old controller's last own write is ${stop.last.what} at ${stop.last.at} (${stop.last.url})` : `its writes could be read back only to ${stop.since}`;
      return new ProgrammeError('OLD_WRITER_ACTIVE', `The old controller has not been quiet for ${QUIET_MS / 60000} minutes: ${what}. It will be at ${iso(ms(stop.since) + QUIET_MS)}. Run takeover again then, or pass the owner's own words that it stopped with --owner-stop.`);
    }
    return null;
  }

  // The three reads again, after the record: nothing newer than the first reads showed.
  checkStopAgain(facts, record) {
    const again = this.readStop(facts);
    for (const entry of again.sources) {
      const before = facts.stop.sources.find(source => source.name === entry.name);
      if (!entry.read) {
        // Unread both times is what the owner's words carry; a source that was read must be read again.
        if (this.input.ownerStop && !before.read) continue;
        throw new ProgrammeError('STOP_UNREADABLE', `${entry.name} could not be read again after the record (${entry.reason}), so nothing shows the old controller stopped. No claim was made. Controller: run takeover --apply again; it claims with this record when the stop still stands.`);
      }
      const newest = entry.newest;
      if (newest && newest.key !== before.newest?.key && (before.read || ms(newest.at) >= ms(record.created_at))) {
        throw new ProgrammeError('OLD_WRITER_ACTIVE', `The old controller wrote again: ${newest.what} at ${newest.at} (${newest.url}). No claim was made.`);
      }
    }
  }

  commentUrl(row) { return row.html_url || `https://github.com/${this.repository}/issues/${this.parent}#issuecomment-${row.id}`; }

  // The old holder's own takeover record: who posted it, and its name, only when that record already
  // names it in public.
  heldRecord(parentDoc) {
    const taken = Array.isArray(parentDoc.private?.takeovers) ? parentDoc.private.takeovers.at(-1) : null;
    const holder = parentDoc.fence.holder_session;
    if (!taken?.comment_id || !holder) return { name: null, author: null };
    const comment = this.get(`repos/${this.repository}/issues/comments/${taken.comment_id}`);
    if (comment.status !== 200) return { name: null, author: null };
    const named = new RegExp(`(?<![A-Za-z0-9._-])${escapeRegExp(holder)}(?![A-Za-z0-9_-])`).test(String(comment.json?.body || ''));
    return { name: named && !state.SESSION_ID_SHAPE.test(holder) ? holder : null, author: comment.json?.user?.login || null };
  }

  // The latest cloud sweep run on the default branch: a fact to report, never a hold.
  sweep(branch) {
    try {
      const response = this.get(`repos/${this.repository}/actions/workflows/toolkit-programme-sweep.yml/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
      if (response.status === 404) return { status: 'no cloud sweep here' };
      const run = response.json?.workflow_runs?.[0];
      if (response.status !== 200) return { status: `not read (HTTP ${response.status})` };
      return run ? { status: run.conclusion || run.status, at: run.created_at || null, url: run.html_url || null } : { status: 'no run yet' };
    } catch (error) {
      if (!error.code) throw error;
      return { status: `not read (${error.code})` };
    }
  }

  // Everything the takeover is decided from, and every reason it may not go on.
  facts() {
    const holds = [];
    const hold = (code, message) => holds.push(new ProgrammeError(code, message));
    const user = this.get('user');
    const login = user.status === 200 ? String(user.json?.login || '') : '';
    const repo = this.get(`repos/${this.repository}`);
    const access = repo.json?.permissions || {};
    const permission = access.admin ? 'admin' : access.maintain ? 'maintain' : access.push ? 'push' : 'read';
    const branch = repo.json?.default_branch || 'main';
    const facts = { login, permission, branch, holds, stop: null, oldName: null, fence: null, attention: null, appointment: false,
      toolkit: readToolkit(path => this.get(path)), sweep: this.sweep(branch), versions: this.versions() };
    if (this.writer.prefix !== this.prefix) hold('ROLE_REFUSED', `A lane controller (${this.writer.prefix}) never holds the parent document.`);
    if (!login || permission === 'read') {
      hold('ACCOUNT_MISMATCH', login ? `The signed-in account ${login} cannot write to ${this.repository}, so it cannot take over as controller. Sign in with the repository's own account.` : 'The signed-in GitHub account could not be read.');
    }
    if (!facts.toolkit.main || !facts.toolkit.controller_blob) hold('TOOLKIT_UNREADABLE', `Toolkit main or its CONTROLLER.md could not be read (${facts.toolkit.reason}), so the record cannot name what this controller is bound to.`);
    const { doc } = this.store.read('parent', this.parent);
    if (!doc) {
      hold('STATE_MISSING', `No parent state document for #${this.parent} yet. The appointed controller creates and holds it with init-parent --apply --controller; there is nothing to take over.`);
      return facts;
    }
    facts.attention = this.attention(doc);
    facts.fence = { ...doc.fence };
    facts.appointment = !doc.fence.holder_session;
    const retired = Array.isArray(doc.private?.retired_holders) ? doc.private.retired_holders : [];
    if (state.isHolder(doc, this.writer)) {
      const taken = Array.isArray(doc.private?.takeovers) ? doc.private.takeovers.at(-1) : null;
      hold('ALREADY_HOLDER', `This name already holds #${this.parent} at epoch ${doc.fence.epoch}${taken ? ` (record comment ${taken.comment_id})` : ''}. If this session itself just took over, that takeover is done: read it with show --parent. Another controller session never shares a name; it takes a new one, for example ${nextName(this.writer.session, [...retired, doc.fence.holder_session])}.`);
      return facts;
    }
    if (retired.includes(this.writer.session)) { hold('STALE_WRITER', state.parentRefusal(doc)); return facts; }
    if (facts.appointment || holds.length) return facts;
    const held = this.heldRecord(doc);
    facts.oldName = held.name;
    facts.stop = this.readStop(facts);
    const other = [held.author, facts.stop.sources[0].author].find(account => account && !same(account, login));
    if (other) {
      hold('ACCOUNT_MISMATCH', `The controller that holds #${this.parent} writes as ${other}, and this command runs as ${login}. Its comments and merges are read only for the account it runs as, so nothing would show that controller stopped. Sign in as ${other}.`);
      return facts;
    }
    const refused = this.stopHold(facts.stop, this.clock());
    if (refused) holds.push(refused);
    return facts;
  }

  // The stop proof as the record says it.
  oldWriter(facts) {
    if (facts.appointment) return 'no previous writer holds the parent';
    const { last, since, unread } = facts.stop;
    const name = facts.oldName ? `old writer ${facts.oldName}` : 'old writer';
    const seen = last && last.at === since ? `its last own write is ${last.what} at ${last.at}` : since ? `no own write of it since ${since}` : 'no own write of it found';
    const said = this.input.ownerStop ? `the owner said "${this.input.ownerStop}"; ` : '';
    return `${name} stopped: ${said}${seen}${this.input.ownerStop ? '' : `, ${QUIET_MS / 60000} minutes or more before this record`}${unread.length ? `; not read: ${unread.map(entry => entry.replace(/ \(.*$/, '')).join(', ')}` : ''}`;
  }

  // ---- the record ---------------------------------------------------------------------------

  // The next free record number: one more than the highest the newest comments mention. Only accounts
  // that can write here count, so a stranger's comment never picks it.
  nextNumber(rows, exceptId = null) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(this.prefix)}(\\d{1,9})(?!\\d)`, 'g');
    const used = rows.filter(row => trusted(row) && row.id !== exceptId).flatMap(row => [...String(row.body || '').matchAll(pattern)].map(match => Number(match[1])));
    return used.length ? Math.max(...used) + 1 : null;
  }

  recordId(number) { return `${this.prefix}${String(number).padStart(3, '0')}`; }

  // Read straight before posting.
  freeNumber() {
    const { rows, floor } = this.newestComments({ pages: NUMBER_PAGES, enough: found => this.nextNumber(found) !== null });
    const number = this.nextNumber(rows) ?? (floor ? null : 1);
    if (number === null) throw new ProgrammeError('RECORD_NUMBER_UNREADABLE', `No ${this.prefix} record is among the newest ${rows.length} comments of ${this.repository}, so the next record number is not known. Nothing was written.`);
    return number;
  }

  lineFor(facts, number) {
    const line = recordLine({ id: this.recordId(number), input: this.input, toolkit: facts.toolkit, epoch: facts.fence.epoch, appointment: facts.appointment, old: this.oldWriter(facts) });
    const errors = [];
    state.screenSecrets(errors, line, 'The record');
    if (errors.length) throw new ProgrammeError('RECORD_TEXT_REFUSED', 'The record would hold text shaped like a secret, so nothing was posted.');
    return line;
  }

  // This run's own record from a run that stopped before its claim: same account, name and epoch.
  // Fresh when the stop stood at its own time; { record, stale } with the others, which are marked once a
  // record stands.
  unusedRecord(facts) {
    const mine = (this.comments || []).filter(row => this.onParent(row) && same(row.user?.login, facts.login)).filter(row => {
      const record = parseRecord(row.body, this.prefix);
      return record && !record.unused && record.controller === this.writer.session && record.from === facts.fence.epoch && record.to === record.from + 1;
    });
    const fresh = row => facts.appointment || (this.input.ownerStop
      ? firstLine(row.body).includes(`the owner said "${this.input.ownerStop}"`) && !(facts.stop.last && ms(facts.stop.last.at) >= ms(row.created_at))
      : this.stopHold(facts.stop, ms(row.created_at)) === null);
    const found = mine.find(fresh) || null;
    return { record: found ? { id: found.id, line: firstLine(found.body), resumed: true } : null, stale: mine.filter(row => row !== found) };
  }

  post(facts) {
    const line = this.lineFor(facts, this.freeNumber());
    const known = new Set(this.comments.map(row => row.id));
    let answer;
    try { answer = this.transport.request('POST', `repos/${this.repository}/issues/${this.parent}/comments`, { body: line }); }
    catch (error) { if (!error.code) throw error; answer = { status: 0, json: null }; }
    if (answer.status === 201 && answer.json?.id) return { id: answer.json.id, line, resumed: false };
    if (answer.status >= 400 && answer.status < 500) throw new ProgrammeError('GH_FAILED', `The takeover record could not be posted on #${this.parent} (HTTP ${answer.status}). Nothing was written.`, { status: answer.status });
    // A lost answer: the comment may be there. Never posted twice.
    this.newestComments({ pages: 1, enough: () => true });
    const landed = this.comments.find(row => !known.has(row.id) && this.onParent(row) && same(row.user?.login, facts.login) && firstLine(row.body) === line);
    if (landed) return { id: landed.id, line, resumed: false };
    throw new ProgrammeError('RECORD_UNCERTAIN', `GitHub gave no answer to the takeover record on #${this.parent}, and it is not listed yet. No claim was made. Controller: run takeover --apply again; it uses the record if it did land.`);
  }

  // The record as GitHub holds it: on the parent, by this account, exactly as posted.
  verify(facts, record) {
    const comment = this.get(`repos/${this.repository}/issues/comments/${record.id}`);
    const refuse = why => new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record (comment ${record.id}) was not verified: ${why}. No claim was made.`);
    if (comment.status !== 200 || !comment.json) throw Object.assign(refuse(`it could not be read (HTTP ${comment.status})`), { unread: true });
    if (!this.onParent(comment.json)) throw refuse(`it is not on #${this.parent}`);
    if (!same(comment.json.user?.login, facts.login)) throw new ProgrammeError('ACCOUNT_MISMATCH', `The takeover record (comment ${record.id}) was not posted by ${facts.login}, the account that claims. No claim was made.`);
    if (String(comment.json.body || '').trim() !== record.line) throw refuse('it does not read back as posted');
    if (!Number.isFinite(ms(comment.json.created_at))) throw refuse('it has no time');
    return { ...record, record_id: parseRecord(record.line, this.prefix)?.id, created_at: comment.json.created_at, login: comment.json.user.login, url: this.commentUrl(comment.json) };
  }

  edit(id, body) {
    try { return this.transport.request('PATCH', `repos/${this.repository}/issues/comments/${id}`, { body }).status; }
    catch (error) { if (!error.code) throw error; return 0; }
  }

  // An earlier comment with the same number keeps it: this record moves to the next free one.
  settleNumber(facts, record) {
    let current = record;
    for (let attempt = 0; attempt < RENUMBER_TRIES; attempt += 1) {
      // GitHub's list can lag the comment just posted: it is read once more when ours is not there yet.
      for (let read = 0; read < 2; read += 1) {
        this.newestComments({ pages: 1, enough: () => true });
        if (this.comments.some(row => row.id === current.id)) break;
      }
      const taken = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(current.record_id)}(?!\\d)`);
      if (!this.comments.some(row => row.id < current.id && trusted(row) && taken.test(String(row.body || '')))) return current;
      const line = current.line.replace(current.record_id, this.recordId(this.nextNumber(this.comments, current.id)));
      const status = this.edit(current.id, line);
      if (status !== 200) throw new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record's number ${current.record_id} is already in use and could not be changed (HTTP ${status}). No claim was made.`);
      current = { ...this.verify(facts, { ...current, line }), renumbered_from: record.record_id };
    }
    throw new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record's number kept clashing after ${RENUMBER_TRIES} tries. No claim was made.`);
  }

  markUnused(id, body) { return this.edit(id, `${UNUSED}${firstLine(body)}`) === 200; }

  // ---- the claim ----------------------------------------------------------------------------

  isOurs(doc, facts, record) {
    const taken = Array.isArray(doc.private?.takeovers) ? doc.private.takeovers.at(-1) : null;
    return doc.fence.epoch === facts.fence.epoch + 1 && state.isHolder(doc, this.writer) && taken?.comment_id === record.id;
  }

  // The fence this takeover names, or EPOCH_MOVED.
  requireFence(doc, facts) {
    const { epoch, holder_session: session, holder_prefix: prefix } = facts.fence;
    if (doc.fence.epoch === epoch && doc.fence.holder_session === session && doc.fence.holder_prefix === prefix) return;
    throw new ProgrammeError(FENCE_LOST, `#${this.parent} moved to epoch ${doc.fence.epoch} while this takeover ran (it named epoch ${epoch}). No claim was made. ${state.parentRefusal(doc)}`);
  }

  claimed(doc, facts, record) {
    const next = state.claimDocument(doc, this.writer, { takeover: true });
    const list = key => (Array.isArray(next.private[key]) ? next.private[key] : []);
    next.private = { ...next.private, ...(facts.fence.holder_session ? { retired_holders: [...list('retired_holders'), facts.fence.holder_session].slice(-LOG_LIMIT) } : {}),
      takeovers: [...list('takeovers'), { comment_id: record.id, from_epoch: facts.fence.epoch }].slice(-LOG_LIMIT) };
    return next;
  }

  // One compare-and-swap that moves the epoch. Each try reads the parent, then the old controller's
  // writes again, then writes over exactly the version read, so a write in between is a conflict: a
  // sweep's is merged by reading again, the old controller's refuses. A lost answer is settled by
  // reading the fence before anything is sent again.
  claim(facts, record) {
    let lost = null;
    for (let attempt = 0; attempt < CLAIM_TRIES; attempt += 1) {
      let read;
      try { read = this.store.read('parent', this.parent); }
      catch (error) {
        if (!lost) throw error;
        throw new ProgrammeError('CLAIM_UNCERTAIN', `The claim of #${this.parent} got no answer (${lost.code}) and the parent could not be read (${error.code}). It may have landed. Controller: read show --parent; if it is not held by ${this.writer.session}, run takeover --apply again, which uses this same record (comment ${record.id}).`);
      }
      if (!read.doc) throw new ProgrammeError('STATE_MISSING', `The parent state document of #${this.parent} is gone. No claim was made.`);
      if (this.isOurs(read.doc, facts, record)) return { commit: lost ? null : this.store.lastCommit || null };
      this.requireFence(read.doc, facts);
      if (lost && lost.times > 1) throw new ProgrammeError('GH_FAILED', `The claim of #${this.parent} failed twice (${lost.message}); the parent is unchanged. Controller: run takeover --apply again; it uses this same record (comment ${record.id}).`);
      if (!facts.appointment) this.checkStopAgain(facts, record);
      try {
        this.store.write('parent', this.parent, this.claimed(read.doc, facts, record), { sha: read.sha, previous: read.doc, writer: this.writer });
        return { commit: this.store.lastCommit || null };
      } catch (error) {
        if (!error.code) throw error;
        if (error.code === 'STATE_CONFLICT') continue;
        if (STORE_CODES.has(error.code) || (error.details?.status >= 400 && error.details.status < 500)) throw new ProgrammeError('STORE_UNREACHABLE', `The store refused the claim of #${this.parent}: ${error.message} No claim was made.`);
        if (!['GH_FAILED', 'STATE_READBACK_MISMATCH'].includes(error.code)) throw error;
        lost = { code: error.code, message: error.message, times: (lost?.times || 0) + 1 };
      }
    }
    if (lost) throw new ProgrammeError('CLAIM_UNCERTAIN', `The claim of #${this.parent} got no answer (${lost.code}) and the parent kept moving. It may have landed. Controller: read show --parent; if it is not held by ${this.writer.session}, run takeover --apply again, which uses this same record (comment ${record.id}).`);
    throw new ProgrammeError('STATE_CONFLICT', `#${this.parent} kept moving while this takeover claimed it (a sweep is writing). No claim was made. Controller: run takeover --apply again; it uses this same record (comment ${record.id}).`);
  }

  // ---- the two modes ------------------------------------------------------------------------

  report(mode, facts) {
    const { fence, stop } = facts;
    return {
      schema: SCHEMA, mode, ready: !facts.holds.length, repository: { name: this.repository, default_branch: facts.branch },
      governance: { state: 'ENABLED' }, account: { login: facts.login || null, permission: facts.permission },
      toolkit: { main: facts.toolkit.main, controller_blob: facts.toolkit.controller_blob }, versions: facts.versions, sweep: facts.sweep, attention: facts.attention,
      parent: { issue: this.parent, epoch: fence?.epoch ?? null, held: Boolean(fence?.holder_session), holder_prefix: fence?.holder_prefix ?? null, holder: facts.oldName,
        next_epoch: fence ? fence.epoch + 1 : null },
      stop: !fence || facts.appointment ? null : { proven: Boolean(stop) && !this.stopHold(stop, this.clock()), by: this.input.ownerStop ? 'owner' : 'quiet',
        last_write: stop?.last || null, quiet_at: stop?.since ? iso(ms(stop.since) + QUIET_MS) : null, sources: stop?.sources.map(({ name, read, reason }) => ({ name, read, ...(reason ? { reason } : {}) })) || [] },
      record: null, holds: facts.holds.map(error => ({ code: error.code, detail: error.message })), done_line: null,
    };
  }

  dryRun() {
    const facts = this.facts();
    const result = this.report('dry-run', facts);
    if (facts.holds.every(error => error.code === 'OLD_WRITER_ACTIVE')) {
      try { result.record = { line: this.lineFor(facts, this.freeNumber()), ready: result.ready, carrier: `comment on #${this.parent}` }; }
      catch (error) {
        if (!error.code) throw error;
        result.ready = false;
        result.holds.push({ code: error.code, detail: error.message });
      }
      if (result.record && !facts.appointment) {
        const unused = this.comments.find(row => { const record = this.onParent(row) && parseRecord(row.body, this.prefix); return record && !record.unused && record.controller === this.writer.session && record.from === facts.fence.epoch; });
        if (unused) result.record.unused = { comment_id: unused.id, url: this.commentUrl(unused) };
      }
    }
    return result;
  }

  apply() {
    const facts = this.facts();
    if (facts.holds.length) throw facts.holds[0];
    if (facts.appointment) this.newestComments({ pages: 1, enough: () => true });
    const unused = this.unusedRecord(facts);
    let record = unused.record || this.post(facts);
    for (const row of unused.stale) this.markUnused(row.id, row.body);
    let claim;
    try {
      record = this.verify(facts, record);
      // The record's own GitHub time is what the quiet time is measured to.
      const refused = facts.appointment ? null : this.stopHold(facts.stop, ms(record.created_at));
      if (refused) throw refused;
      record = this.settleNumber(facts, record);
      claim = this.claim(facts, record);
    } catch (error) {
      if (VOIDS_RECORD.has(error.code) && !error.unread) {
        error.message += this.markUnused(record.id, record.line) ? ` The record (comment ${record.id}) is marked NOT USED.` : ` The record (comment ${record.id}) could not be marked NOT USED; edit it by hand.`;
      }
      throw error;
    }
    const back = this.store.read('parent', this.parent).doc;
    if (!back || !this.isOurs(back, facts, record)) throw new ProgrammeError(FENCE_LOST, `The claim of #${this.parent} landed, but the parent now reads epoch ${back?.fence?.epoch ?? 'unknown'}: another takeover followed it. Stop and report to the owner.`);
    const result = this.report('apply', facts);
    result.parent = { ...result.parent, epoch: back.fence.epoch, next_epoch: null, taken_from: facts.fence.epoch };
    result.record = { record_id: record.record_id, line: record.line, comment_id: record.id, url: record.url, created_at: record.created_at, author: record.login, resumed: record.resumed, ...(record.renumbered_from ? { renumbered_from: record.renumbered_from } : {}) };
    result.claim = { commit: claim.commit, acting: { prefix: this.writer.prefix, session: this.writer.session } };
    result.next_action = 'Controller: run reconcile (a dry run); it settles earlier intents by readback. Then continue.';
    result.done_line = this.doneLine(facts, result);
    return result;
  }

  doneLine(facts, result) {
    const handover = require('./programme-handover.cjs').handoverUrl(this.binding.store, this.parent);
    return [`Takeover done: ${this.writer.session} holds #${this.parent} at epoch ${result.parent.epoch} (was ${facts.fence.epoch}${facts.oldName ? `, ${facts.oldName}` : ''})`,
      `record ${result.record.record_id} ${result.record.url}`, `Toolkit main ${short(facts.toolkit.main)}, Controller blob ${short(facts.toolkit.controller_blob)}`,
      ...(facts.versions?.line ? [facts.versions.line] : []), `sweep: ${facts.sweep.status}`, `handover file ${handover}`, `next: ${this.input.next}`].join('; ') + '.';
  }
}

// The commit of Toolkit's default branch and the Controller's blob there, which the record names.
function readToolkit(get) {
  const { TOOLKIT_REPOSITORY } = require('../../../repo/scripts/toolkit-cloud-workflows-render.cjs');
  try {
    const head = get(`repos/${TOOLKIT_REPOSITORY}/commits/main`);
    const main = /^[0-9a-f]{40}$/.test(head.json?.sha || '') && head.status === 200 ? head.json.sha : null;
    if (!main) return { main: null, controller_blob: null, reason: `HTTP ${head.status}` };
    const file = get(`repos/${TOOLKIT_REPOSITORY}/contents/repo/CONTROLLER.md?ref=${main}`);
    const blob = /^[0-9a-f]{40}$/.test(file.json?.sha || '') && file.status === 200 ? file.json.sha : null;
    return { main, controller_blob: blob, ...(blob ? {} : { reason: `HTTP ${file.status}` }) };
  } catch (error) {
    if (!error.code) throw error;
    return { main: null, controller_blob: null, reason: error.code };
  }
}

// ---- the command ----------------------------------------------------------------------------

// The programme a takeover acts on, or, for a dry run where governance or the store keeps it shut, why.
function openTakeover(args, deps, openContext) {
  const input = takeoverInput(args);
  try { return { ...openContext(args, deps), input }; }
  catch (error) {
    const closed = STORE_CODES.has(error.code) ? new ProgrammeError('STORE_UNREACHABLE', error.message) : GOVERNANCE_CODES.has(error.code) ? error : null;
    if (!closed) throw error;
    if (args.apply) throw closed;
    return { closed, input, transport: deps.transport || new state.GitHubTransport({ ghPath: state.resolveExecutable('gh') }) };
  }
}

// A dry run without a programme to read: what can still be said, and the line for the evidence store.
function closedReport({ closed, input, transport }) {
  const store = closed.code === 'STORE_UNREACHABLE';
  const toolkit = readToolkit(path => transport.request('GET', path));
  const old = input.ownerStop ? `old writer stopped: the owner said "${input.ownerStop}"` : 'old writer: not read (no programme state)';
  const line = toolkit.controller_blob ? recordLine({ input, toolkit, old }) : null;
  const holds = [{ code: closed.code, detail: closed.message }, ...(line ? [] : [{ code: 'TOOLKIT_UNREADABLE', detail: `Toolkit main or its CONTROLLER.md could not be read (${toolkit.reason}).` }])];
  return { schema: SCHEMA, mode: 'dry-run', ready: false, repository: null, governance: { state: store ? 'ENABLED' : closed.details?.governance || 'UNREADABLE' }, account: null,
    toolkit: { main: toolkit.main, controller_blob: toolkit.controller_blob }, versions: null, sweep: null, attention: null, parent: null, stop: null,
    record: line && !store ? { line, ready: false, carrier: 'evidence store' } : null, holds, done_line: null };
}

function takeover(args, context, { attention } = {}) {
  if (context.closed) return closedReport(context);
  const run = new TakeoverRun({ store: context.store, transport: context.transport, binding: context.binding, repository: context.repository, writer: context.writer, input: context.input, now: context.now, attention });
  return args.apply ? run.apply() : run.dryRun();
}

function formatTakeover(result) {
  if (result.done_line) return `${result.done_line}\n${result.next_action}\n`;
  const { parent, stop, record } = result;
  const lines = [`Takeover dry run${result.repository ? ` of ${result.repository.name} (default branch ${result.repository.default_branch})` : ''}: ${result.ready ? 'ready' : 'not ready'}. Nothing was written.`,
    `Governance: ${result.governance.state}`,
    ...(result.account ? [`Account: ${result.account.login || 'not read'} (${result.account.permission})`] : []),
    `Toolkit main ${result.toolkit.main || 'not read'}; CONTROLLER.md blob ${result.toolkit.controller_blob || 'not read'}`,
    ...(result.versions?.line ? [result.versions.line] : []),
    ...(result.sweep ? [`Cloud sweep: ${result.sweep.status}${result.sweep.url ? ` (${result.sweep.url})` : ''}`] : []),
    ...(parent?.epoch === null || !parent ? [] : [`Parent #${parent.issue}: epoch ${parent.epoch}, ${parent.held ? `held by ${parent.holder || `a ${parent.holder_prefix} controller no earlier record names`}` : 'held by nobody'}; a takeover makes it epoch ${parent.next_epoch}`]),
    ...(stop?.last_write ? [`Old controller's last own write: ${stop.last_write.what} at ${stop.last_write.at} (${stop.last_write.url})`] : []),
    ...(stop ? [`Stop: ${stop.proven ? `proven (${stop.by === 'owner' ? 'the owner\'s words' : 'quiet for 10 minutes'})` : `not proven yet${stop.quiet_at ? `; quiet for 10 minutes at ${stop.quiet_at}` : ''}`}`] : []),
    ...result.holds.map(entry => `Hold ${entry.code}: ${entry.detail}`),
    ...(record ? ['', `Record (${record.carrier}${record.unused ? `; an unused one is already there: ${record.unused.url}` : ''}):`, record.line] : [])];
  return `${lines.join('\n')}\n`;
}

module.exports = Object.freeze({ SCHEMA, QUIET_MS, TakeoverRun, takeoverInput, recordLine, parseRecord, nextName, openTakeover, takeover, formatTakeover });
