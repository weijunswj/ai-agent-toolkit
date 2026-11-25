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
// A record is only ever marked NOT USED, and "No claim was made" only ever said after a record, when the
// claim cannot have landed: SentClaim knows what this run sent, and `stopped` is the one place that
// decides. What an earlier run sent is never known, so a record this run resumed is marked only when a
// read shows that another claim left its epoch, or after a later claim of this name is confirmed.
//
// The number of requests is fixed: no task document is read, however many tasks there are.
const fs = require('node:fs');
const path = require('node:path');
const state = require('./programme-state.cjs');
const { isArchiveComment } = require('./decision-tags.cjs');
const { INDEX_COMMENT_MARKER } = require('./decision-trace-audit.cjs');
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
// Comments Toolkit writes, as it writes them: a comment that only quotes one of these is a person's.
const GENERATED_COMMENTS = [new RegExp(`^(?:[^\\r\\n]+\\r?\\n---\\r?\\n)?${escapeRegExp(INDEX_COMMENT_MARKER)}\\r?\\n`),
  new RegExp(`\\n\\r?\\n${escapeRegExp(FACTS)}\\s*$`), /^<!-- toolkit-parent-repair:\d+:\d+ -->\r?\n/];
// A commit of the programme's store path that is not the controller's own write.
const REFRESH_COMMIT = new RegExp(`^programme[ -]state: .*${escapeRegExp(state.REFRESH_MARK)}$`);
const STATE_COMMIT = /^programme[ -]state: /;
const OTHER_COMMITS = [/^programme sweep: /, /^programme journal: /, /^programme handover: /, /^programme page copy: /,
  /^programme state: checkpoint$/, /^programme state: \S+ r\d+ sidecar$/, /^programme state: prune \S+ sidecar$/];
// What a public record may not hold, each with no word boundary to hide behind (an underscore is a word
// character). First the hosts' session IDs: a UUID (Claude Code, its desktop app's `local_` form, Codex),
// with any dash or none, and the prefixed IDs of Claude's cloud sessions and Projects.
const SESSION_ID = new RegExp([/[0-9a-f]{8}(?:[-_\u2010-\u2015][0-9a-f]{4}){3}[-_\u2010-\u2015][0-9a-f]{12}/, /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/,
  /[a-z]{2,12}_0\d[a-z0-9]{4,}/, /(?:session|cse)_(?=[a-z]*\d)[a-z0-9]{16,}/].map(shape => shape.source).join('|'), 'i');
// IPv4, IPv6 (and a MAC address), a dotted host name, a one-name local host, localhost, a host with a port.
const ADDRESS = new RegExp([/\d{1,3}(?:\.\d{1,3}){3}/, /::|(?:[0-9a-f]{1,4}:){4,}[0-9a-f]{1,4}/, /[\w-]+\.[\w-]+\.[a-z]{2,}/,
  /[\w-]+\.(?:local|localdomain|lan|home|internal|intranet|corp|private)(?!\w)/, /localhost/,
  /(?<![\w.-])(?!\d{4}-\d{2}-\d{2}T)[\w.-]*[a-z][\w.-]*:\d{2,5}(?!\d)/].map(shape => shape.source).join('|'), 'i');
// A backslash, a slash that starts a path (a drive's too), a home (~ and the variables that name one, as any variable).
const PATH = /\\|(?<![\p{L}\p{N}])\.{0,2}\/|(?<![\p{L}\p{N}])~(?!\d)|\$\{?[a-z_]|%[a-z_][\w()]*%/iu;
const FENCE_LOST = 'EPOCH_MOVED';
// Refusals after the record that mean it can never carry a claim, when none was sent that may have
// landed: the record is marked NOT USED. One with `keep` set only says that something was not read.
const VOIDS_RECORD = new Set(['OLD_WRITER_ACTIVE', FENCE_LOST, 'ACCOUNT_MISMATCH', 'TAKEOVER_UNVERIFIED', 'STORE_UNREACHABLE']);
// Why governance does not let a takeover write here; a dry run still reports and prints the record line.
const GOVERNANCE_CODES = new Set(['GITHUB_GOVERNANCE_OFF', 'GOVERNANCE_STATE_UNAVAILABLE', 'BINDING_DISABLED', 'BINDING_MISSING', 'BINDING_INVALID']);
const STORE_CODES = new Set(['STATE_STORE_UNVERIFIED', 'STORE_NOT_PRIVATE']);

const usage = message => new ProgrammeError('USAGE', message);
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase() && String(a || '') !== '';
const ms = text => Date.parse(text || '');
const iso = value => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
const short = sha => String(sha || '').slice(0, 7);
const isGenerated = body => isArchiveComment(body) || GENERATED_COMMENTS.some(pattern => pattern.test(String(body || '')));
const isBot = user => user?.type === 'Bot' || /\[bot\]$/.test(user?.login || '');
// An account that can write here: only its comments hold record numbers.
const trusted = row => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(row.author_association);
const firstLine = text => String(text || '').split(/\r?\n/)[0];

// ---- the caller's words ---------------------------------------------------------------------

// What text for a public record holds that it may not, or null.
function privateText(text) {
  if (SESSION_ID.test(text)) return 'a session ID';
  if (text.includes('://') || text.includes('@') || ADDRESS.test(text)) return 'an address or a mention';
  return PATH.test(text) || require('./programme-handover.cjs').DEVICE_PATH.test(text) ? 'a path' : null;
}

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
  const held = privateText(text);
  if (held) throw refuse(held);
  return text;
}

// The command's own words, checked before anything is read.
function takeoverInput(args) {
  for (const flag of ['session', 'surface', 'next']) {
    if (typeof args[flag] !== 'string') throw usage('takeover needs --session <the new controller\'s stable writer name>, --surface "<harness and host evidence>" and --next "<next action>".');
  }
  if (!WRITER_NAME.test(args.session) || privateText(args.session)) {
    throw usage('--session takes the new controller\'s stable writer name (3 to 80 letters, digits, dots, hyphens or underscores), not a host session id, host name or address: the record names it.');
  }
  const surface = recordText('--surface', args.surface);
  if (surface.includes(';')) throw usage('--surface may not hold a semicolon: the record separates its parts with them.');
  const ownerStop = args['owner-stop'] === undefined ? null : recordText('--owner-stop', args['owner-stop']).replace(/"/g, '\'');
  return { session: args.session, surface, next: recordText('--next', args.next).replace(/[.;]+$/, ''), ownerStop, chat: chatCopy(args['session-copy']) };
}

// The version of the Toolkit copy this chat loaded, read from its folder; null when the chat does not
// know it, so it is never guessed from the copy that runs.
function chatCopy(folder) {
  if (folder === undefined) return null;
  const { SEMVER, VERSION_REL_PATH } = require('../../../repo/scripts/toolkit-version.cjs');
  const json = file => { try { return JSON.parse(fs.readFileSync(path.join(folder, ...file.split('/')), 'utf8')); } catch { return null; } };
  const version = json(VERSION_REL_PATH)?.version;
  const named = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].some(file => json(file)?.name === 'ai-agent-toolkit');
  if (!named || !SEMVER.test(version || '')) throw usage('--session-copy takes the folder of the Toolkit copy this chat loaded (the one that holds its skills folder), and this is not one. Leave it out when the chat does not show it. Nothing was read or written.');
  return { version };
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

// ---- what a sent claim may have done ----------------------------------------------------------

const takeoversOf = doc => (Array.isArray(doc.private?.takeovers) ? doc.private.takeovers : []);

// Where a parent document stands against one record's claim of epoch N to N + 1 (`fence` is the one
// the record names):
//   held       this claim landed and stands
//   followed   this claim landed, and another takeover followed it
//   unclaimed  the fence is still the one the record names
//   taken      another claim left epoch N, so this one never did
//   unknown    none of these shows
function claimStanding(doc, { fence, writer, recordId }) {
  const takeovers = takeoversOf(doc);
  const now = doc.fence;
  if (takeovers.some(entry => entry?.comment_id === recordId && entry.from_epoch === fence.epoch)) {
    return now.epoch === fence.epoch + 1 && state.isHolder(doc, writer) ? 'held' : 'followed';
  }
  if (now.epoch === fence.epoch && now.holder_session === fence.holder_session && now.holder_prefix === fence.holder_prefix) return 'unclaimed';
  if (now.epoch === fence.epoch + 1 || takeovers.some(entry => entry?.from_epoch === fence.epoch)) return 'taken';
  return 'unknown';
}

// The claims one run sent, and whether any of them landed or may have. `open` holds each that may have:
// sent, not refused, not read back. Only a read of the parent closes one.
class SentClaim {
  // `resumed`: the record is an earlier run's, which may have sent a claim of its own.
  constructor(resumed) {
    this.resumed = resumed;
    this.landed = null;
    this.open = [];
    this.replaced = new Set();
    this.failures = 0;
    this.why = null;
  }

  // One write over `read` that did not return. `put` is what putVerified recorded about it.
  failed(read, put, error) {
    this.why = error.message;
    if (put.verified) { this.landed = { commit: put.commit }; return; }
    if (put.refused || error.code === 'STATE_CONFLICT') return;
    this.failures += 1;
    if (!put.sent) return;
    this.replaced.add(read.sha);
    this.open.push({ revision: read.doc.revision, commit: put.commit || null, why: error.message });
  }

  // The commit GitHub answered a claim with, when that claim is not read back yet.
  accepted() { return this.open.find(entry => entry.commit)?.commit || null; }

  // The parent was read unclaimed at `revision`. A claim sent over an older one lost to that write and
  // can no longer land; over the same one, the read may be older than the claim. One GitHub accepted
  // is never closed by a read that does not show it.
  unclaimedAt(revision) { this.open = this.open.filter(entry => entry.commit || !(revision > entry.revision)); }

  // Another claim left the epoch this one names.
  beaten() { this.open = this.open.filter(entry => entry.commit); }

  describe() { return this.accepted() ? `GitHub accepted it as commit ${short(this.accepted())}` : `GitHub gave no answer that says whether it landed (${this.open.at(-1).why})`; }
}

// ---- the Toolkit versions -------------------------------------------------------------------

const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLAIN_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

// What was read of one GitHub file or variable: { status, json }, where 0 means no answer.
function readOnce(get, path) {
  try {
    const { status, json } = get(path);
    return { status, json };
  } catch (error) {
    if (!error.code) throw error;
    return { status: 0, json: null };
  }
}
const unread = status => (status ? `HTTP ${status}` : 'no answer');
const fileText = answer => (answer.status === 200 && answer.json?.encoding === 'base64' ? Buffer.from(String(answer.json.content), 'base64').toString('utf8') : null);

// What this repository's cloud sweep runs: its copy of the sweep workflow on the default branch, judged as
// the governance check judges it, and the variable that can pin it. A fact, never a hold.
function sweepOf(get, repository, branch, main) {
  const workflows = require('../../../repo/scripts/toolkit-cloud-workflows.cjs');
  if (same(repository, workflows.TOOLKIT_REPOSITORY)) return { state: 'own', text: 'runs this repository\'s own commit' };
  const [{ id, file }] = workflows.WORKFLOWS;
  const answer = readOnce(get, `repos/${repository}/contents/${file}?ref=${encodeURIComponent(branch)}`);
  const text = fileText(answer);
  if (text === null && answer.status !== 404) return { state: 'unread', text: `not read (${unread(answer.status)})` };
  // The copy that runs holds the same workflow file, so no checkout is needed to judge the repository's one.
  const source = fs.readFileSync(path.join(TOOLKIT_ROOT, ...file.split('/')), 'utf8').replace(/\r\n/g, '\n');
  const copy = workflows.copyState(text, workflows.render(id, source, '0'.repeat(40), null));
  if (copy.state === 'missing') return { state: 'missing', text: 'none in this repository' };
  if (copy.state === 'unmanaged') return { state: 'unmanaged', text: 'not a Toolkit copy' };
  if (copy.state === 'edited') return { state: 'edited', text: 'a copy edited by hand' };
  if (copy.state === 'outdated') return { state: 'outdated', text: `an outdated copy (Toolkit ${short(copy.toolkit)})` };
  const variable = readOnce(get, `repos/${repository}/actions/variables/TOOLKIT_REF`);
  if (![200, 404].includes(variable.status)) return { state: 'current', text: `follows main unless a TOOLKIT_REF variable pins it (not read: ${unread(variable.status)})` };
  const pin = variable.status === 200 ? String(variable.json?.value ?? '') : '';
  if (pin === '' || pin === 'main') return { state: 'current', text: 'follows main' };
  if (!PLAIN_REF.test(pin)) return { state: 'pinned', text: 'pinned by the TOOLKIT_REF variable at a value that is not a plain ref' };
  return { state: 'pinned', text: `pinned at ${/^[0-9a-f]{40}$/.test(pin) ? short(pin) : pin} by the TOOLKIT_REF variable`, ...(pin === main ? {} : { pin }) };
}

// The Toolkit copies behind a takeover and the one refresh to do, in one line: the copy this chat loaded
// (`chat`, null when not given), the copy that runs this, Toolkit main at commit `main`, and the sweep.
// `repository` is null where governance keeps it shut.
function versionsOf({ get, main, chat = null, repository = null, branch = 'main', git = undefined }) {
  const { TOOLKIT_VERSION, SEMVER, VERSION_REL_PATH, compareVersions } = require('../../../repo/scripts/toolkit-version.cjs');
  const { TOOLKIT_REPOSITORY } = require('../../../repo/scripts/toolkit-cloud-workflows-render.cjs');
  let mainVersion = null;
  if (main) {
    try { mainVersion = JSON.parse(fileText(readOnce(get, `repos/${TOOLKIT_REPOSITORY}/contents/${VERSION_REL_PATH}?ref=${main}`))).version; } catch { /* not read */ }
    if (!SEMVER.test(mainVersion || '')) mainVersion = null;
  }
  const byVersion = version => (mainVersion === null ? 'not compared' : compareVersions(version, mainVersion) < 0 ? 'behind' : 'current');
  const checkout = main ? require('../../../repo/scripts/toolkit-controller-check.cjs').toolkitCheckout(TOOLKIT_ROOT, main, git) : null;
  const ran = { version: TOOLKIT_VERSION, commit: checkout?.commit ?? null, state: !main ? 'not compared' : checkout ? (checkout.behind ? 'behind' : 'current') : byVersion(TOOLKIT_VERSION) };
  const loaded = chat ? { version: chat.version, state: byVersion(chat.version) } : null;
  const { pin, ...sweep } = repository ? sweepOf(get, repository, branch, main) : { state: 'unread', text: 'not read here' };
  const script = name => require('../../../repo/scripts/toolkit-user-state.cjs').managedScript(name).replace(/\\/g, '/');
  const notCompared = [...(ran.state === 'not compared' ? ['the copy that ran'] : []), ...(loaded?.state === 'not compared' ? ['this chat\'s copy'] : []),
    ...(repository && sweep.state === 'unread' ? ['the sweep'] : []), ...(sweep.text.includes('(not read: ') ? ['the sweep\'s pin'] : [])];
  const pinnedAt = pin || (sweep.state === 'pinned' && !sweep.text.startsWith('pinned at ') ? 'a value that is not a plain ref' : null);
  const refresh = ran.state === 'behind' ? `run ${checkout?.command || `node "${script('toolkit-local-bridge.cjs')}" --repo-update-now --write`}, then reread CONTROLLER.md and the global rules`
    : loaded?.state === 'behind' ? 'say `refresh toolkit`, then go on in a fresh chat'
      : sweep.state === 'outdated' ? `run node "${script('toolkit-cloud-workflows.cjs')}" --repo <target checkout> --refresh-pr`
        : ['edited', 'unmanaged', 'missing'].includes(sweep.state) ? 'refresh the repository rules (say `refresh governance`)'
          : pinnedAt ? `ask the owner whether the TOOLKIT_REF variable still pins ${repository} at ${pinnedAt}`
            : notCompared.length ? `none (not compared: ${notCompared.join(', ')})` : 'none';
  const at = commit => (commit ? ` (${short(commit)})` : '');
  return { line: `versions: this chat ${loaded ? loaded.version : 'not given'}, ran ${ran.version}${at(ran.commit)}, Toolkit main ${mainVersion || 'not read'}${at(main)}, sweep ${sweep.text}; refresh: ${refresh}`,
    refresh, chat: loaded, ran, main: { version: mainVersion, commit: main }, sweep };
}

// ---- one takeover ---------------------------------------------------------------------------

class TakeoverRun {
  // `git` reads the copy this runs from (the host's own git when not given). `attention` is called with
  // the parent document and returns the attention line to report.
  constructor({ store, transport, binding, repository, writer, input, now = () => new Date().toISOString(), git = undefined, attention = () => null }) {
    Object.assign(this, { store, transport, binding, repository, writer, input, now, git, attention });
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
    let head = null;
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
      // The parent document was just read from here, so a list with no commit at all was not read.
      if (!rows.length) throw new ProgrammeError('GH_FAILED', `${place.repository} lists no commit under ${place.path}.`);
      // The documents' own place comes first: its newest commit shows them as they stand.
      head = head || rows[0].sha;
      const row = rows.find(own);
      if (row) {
        const entry = { key: row.sha, at: row.commit.committer.date, what: `state commit ${short(row.sha)}`, url: `https://github.com/${place.repository}/commit/${row.sha}` };
        if (!newest || ms(entry.at) > ms(newest.at)) newest = entry;
      } else if (at && (!floor || ms(at) > ms(floor))) floor = at;
      // Only the holder writes state documents, so this is the old controller's account.
      author = author || rows.find(entry => own(entry) && STATE_COMMIT.test(firstLine(entry.commit?.message)) && entry.author?.login)?.author.login || null;
    }
    return { newest, floor, author, head };
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
    if (isGenerated(body)) return false;
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

  // The three reads again, after the record: `refused` when they show anything newer than the first
  // reads did. `head` is the newest state commit, whoever made it: it may be this claim's own.
  stopAgain(facts, record) {
    const again = this.readStop(facts);
    const head = again.sources[0].head || null;
    for (const entry of again.sources) {
      const before = facts.stop.sources.find(source => source.name === entry.name);
      if (!entry.read) {
        // Unread both times is what the owner's words carry; a source that was read must be read again.
        if (this.input.ownerStop && !before.read) continue;
        return { head, refused: new ProgrammeError('STOP_UNREADABLE', `${entry.name} could not be read again after the record (${entry.reason}), so nothing shows the old controller stopped. Controller: run takeover --apply again; it claims with this record when the stop still stands.`) };
      }
      const newest = entry.newest;
      if (newest && newest.key !== before.newest?.key && (before.read || ms(newest.at) >= ms(record.created_at))) {
        return { head, refused: new ProgrammeError('OLD_WRITER_ACTIVE', `The old controller wrote again: ${newest.what} at ${newest.at} (${newest.url}).`) };
      }
    }
    return { head, refused: null };
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
    return { name: named && !privateText(holder) ? holder : null, author: comment.json?.user?.login || null };
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
    const get = path => this.get(path);
    const toolkit = readToolkit(get);
    const facts = { login, permission, branch, holds, stop: null, oldName: null, fence: null, attention: null, appointment: false, toolkit, sweep: this.sweep(branch),
      versions: versionsOf({ get, main: toolkit.main, chat: this.input.chat, repository: this.repository, branch, git: this.git }) };
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
    // One with other text in it can never be verified, so it is an older record from here on.
    const found = mine.find(row => String(row.body).trim() === firstLine(row.body).trim() && fresh(row)) || null;
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
    const refuse = why => new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record (comment ${record.id}) was not verified: ${why}.`);
    if (comment.status !== 200 || !comment.json) throw Object.assign(refuse(`it could not be read (HTTP ${comment.status})`), { keep: true });
    if (!this.onParent(comment.json)) throw refuse(`it is not on #${this.parent}`);
    if (!same(comment.json.user?.login, facts.login)) throw new ProgrammeError('ACCOUNT_MISMATCH', `The takeover record (comment ${record.id}) was not posted by ${facts.login}, the account that claims.`);
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
      // A generated comment index lists a record; it never takes its number.
      if (!this.comments.some(row => row.id < current.id && trusted(row) && !isGenerated(row.body) && taken.test(String(row.body || '')))) return current;
      const line = current.line.replace(current.record_id, this.recordId(this.nextNumber(this.comments, current.id)));
      const status = this.edit(current.id, line);
      if (status !== 200) throw new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record's number ${current.record_id} is already in use and could not be changed (HTTP ${status}).`);
      current = { ...this.verify(facts, { ...current, line }), renumbered_from: record.record_id };
    }
    throw new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record's number kept clashing after ${RENUMBER_TRIES} tries.`);
  }

  // The whole comment stays under the mark.
  markUnused(id) {
    try {
      const comment = this.get(`repos/${this.repository}/issues/comments/${id}`);
      const body = String(comment.json?.body || '');
      if (comment.status !== 200 || !body) return false;
      return body.startsWith(UNUSED) || this.edit(id, `${UNUSED}${body}`) === 200;
    } catch (error) {
      if (!error.code) throw error;
      return false;
    }
  }

  // ---- the claim ----------------------------------------------------------------------------

  claimed(doc, facts, record) {
    const next = state.claimDocument(doc, this.writer, { takeover: true });
    const list = key => (Array.isArray(next.private[key]) ? next.private[key] : []);
    next.private = { ...next.private, ...(facts.fence.holder_session ? { retired_holders: [...list('retired_holders'), facts.fence.holder_session].slice(-LOG_LIMIT) } : {}),
      takeovers: [...list('takeovers'), { comment_id: record.id, from_epoch: facts.fence.epoch }].slice(-LOG_LIMIT) };
    return next;
  }

  standing(doc, facts, record) { return claimStanding(doc, { fence: facts.fence, writer: this.writer, recordId: record.id }); }

  // The parent now; a claim GitHub accepted is read at its own commit, which no older version hides.
  readParent(sent) {
    const read = this.parentAt(sent.accepted()) || this.store.read('parent', this.parent);
    if (!read.doc) throw new ProgrammeError('STATE_MISSING', `The parent state document of #${this.parent} is gone.`);
    return read;
  }

  // The parent as one commit holds it, or null when that cannot be read.
  parentAt(commit) {
    if (!commit) return null;
    try {
      const read = this.store.readAt('parent', this.parent, commit);
      return read.doc ? { ...read, commit } : null;
    } catch (error) {
      if (!error.code) throw error;
      return null;
    }
  }

  // What one read of the parent settles: true when the claim landed and stands; EPOCH_MOVED when the
  // fence is no longer the one the record names.
  settle(read, facts, record, sent) {
    const standing = this.standing(read.doc, facts, record);
    if (standing === 'held' || standing === 'followed') sent.landed = { commit: read.commit || null, doc: read.doc };
    if (standing === 'held') return true;
    if (standing === 'followed') throw this.followed(read.doc);
    if (standing === 'unclaimed') { sent.unclaimedAt(read.doc.revision); return false; }
    if (standing === 'taken') sent.beaten();
    throw Object.assign(new ProgrammeError(FENCE_LOST, `#${this.parent} moved to epoch ${read.doc.fence.epoch} while this takeover ran (it named epoch ${facts.fence.epoch}). ${state.parentRefusal(read.doc)}`),
      { keep: standing === 'unknown' && sent.resumed, carriers: takeoversOf(read.doc).map(entry => entry?.comment_id) });
  }

  followed(doc) { return new ProgrammeError(FENCE_LOST, `#${this.parent} is now at epoch ${doc.fence.epoch}: another takeover followed this one. Stop and report to the owner.`); }

  // One compare-and-swap that moves the epoch. Each try reads the parent, then the old controller's
  // writes again, then writes over exactly the version read, so a write in between is a conflict: a
  // sweep's is merged by reading again, the old controller's refuses. An answer that did not come, or
  // a claim GitHub accepted that did not read back, is settled by reading before anything is sent again.
  claim(facts, record, sent) {
    for (let attempt = 0; attempt < CLAIM_TRIES; attempt += 1) {
      const read = this.readParent(sent);
      if (this.settle(read, facts, record, sent)) return;
      if (sent.failures > 1) throw new ProgrammeError('GH_FAILED', `The claim of #${this.parent} failed twice (${sent.why}). Controller: run takeover --apply again; it uses this same record (comment ${record.id}).`);
      const { refused, head } = facts.appointment ? { refused: null } : this.stopAgain(facts, record);
      if (refused) {
        // The newer write may be this claim, landed while the branch read still serves the version before it.
        const newest = this.parentAt(head);
        if (newest && this.settle(newest, facts, record, sent)) return;
        throw refused;
      }
      if (sent.accepted()) continue;
      this.send(read, facts, record, sent);
      if (sent.landed) return;
    }
    throw new ProgrammeError('STATE_CONFLICT', `#${this.parent} kept moving while this takeover claimed it (a sweep is writing). Controller: run takeover --apply again; it uses this same record (comment ${record.id}).`);
  }

  // Sends the claim once. It returns when the next read decides, and throws when no read can help.
  send(read, facts, record, sent) {
    const put = {};
    try {
      this.store.write('parent', this.parent, this.claimed(read.doc, facts, record), { sha: read.sha, previous: read.doc, writer: this.writer, put });
      sent.landed = { commit: this.store.lastCommit || null };
    } catch (error) {
      sent.failed(read, put, error);
      if (!error.code || sent.landed) throw error;
      if (error.code === 'STATE_CONFLICT' || (put.sent && !put.refused)) return;
      const refused = STORE_CODES.has(error.code) || (error.details?.status >= 400 && error.details.status < 500);
      // Only the store's answer to the claim itself, or a store that is not private, is final.
      const keep = !put.refused && error.code !== 'STORE_NOT_PRIVATE';
      if (refused) throw Object.assign(new ProgrammeError('STORE_UNREACHABLE', `The store ${keep ? 'could not be used for' : 'refused'} the claim of #${this.parent}: ${error.message}${keep ? ` Controller: run takeover --apply again; it uses this same record (comment ${record.id}).` : ''}`), { keep });
      if (!['GH_FAILED', 'STATE_READBACK_MISMATCH'].includes(error.code)) throw error;
    }
  }

  // The last read: the claim stands and nothing followed it.
  confirm(facts, record, sent) {
    const back = this.store.read('parent', this.parent);
    // GitHub can still serve the version the claim replaced; the claim was read at a commit that holds it.
    const doc = sent.landed.doc && sent.replaced.has(back.sha) ? sent.landed.doc : back.doc;
    const standing = doc ? this.standing(doc, facts, record) : 'unknown';
    if (standing === 'held') return doc;
    if (standing === 'followed') throw this.followed(doc);
    throw new ProgrammeError('STATE_READBACK_MISMATCH', `The last read of #${this.parent} (epoch ${doc?.fence?.epoch ?? 'unknown'}) does not show it.`);
  }

  // The one place that decides what a takeover that stopped after its record says and leaves:
  //
  //   the claim         says                                      the record
  //   landed            that it landed, and what stopped after    stands
  //   may have landed   CLAIM_UNCERTAIN, and what stopped it      stands
  //   cannot have       the refusal, and that no claim was made   NOT USED when it can never carry one; a
  //                                                               resumed one only for another's claim
  stopped(error, { facts, record, sent, stale }) {
    const { epoch } = facts.fence;
    // What stopped it, without the next step it would have named had nothing been sent.
    const cause = String(error.message).split(' Controller: ')[0];
    if (sent.landed) {
      const landed = `The claim of #${this.parent} landed: ${this.writer.session} took epoch ${epoch + 1} with this record (comment ${record.id}${sent.landed.commit ? `, commit ${short(sent.landed.commit)}` : ''}).`;
      if (error.code === FENCE_LOST) return new ProgrammeError(FENCE_LOST, `${landed} ${error.message}`);
      return Object.assign(new ProgrammeError('CLAIM_LANDED', `${landed} What came after it failed: ${cause} Controller: do not claim again; read show --parent, then continue.`), { cause: error });
    }
    if (sent.open.length) {
      return Object.assign(new ProgrammeError('CLAIM_UNCERTAIN', `The claim of #${this.parent} may have landed: ${sent.describe()}, and no read settled it. It stopped on: ${cause} Controller: read show --parent; if ${this.writer.session} does not hold it at epoch ${epoch + 1}, run takeover --apply again, which uses this same record (comment ${record.id}) while it is fresh.`), { cause: error });
    }
    if (!error.code) return error;
    error.message += sent.resumed || stale.length ? ' This run made no claim.' : ' No claim was made.';
    if (VOIDS_RECORD.has(error.code) && !error.keep && (!sent.resumed || error.code === FENCE_LOST)) {
      error.message += this.markUnused(record.id) ? ` The record (comment ${record.id}) is marked NOT USED.`
        : ` The record (comment ${record.id}) could not be marked NOT USED. Controller: run takeover --apply again; mark it by hand only if you will not.`;
      // Another claim left this epoch, so no older record of this name carried one either.
      if (error.code === FENCE_LOST) for (const row of stale) if (!error.carriers?.includes(row.id)) this.markUnused(row.id);
    }
    return error;
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
    const sent = new SentClaim(record.resumed);
    try {
      record = this.verify(facts, record);
      // The record's own GitHub time is what the quiet time is measured to.
      const refused = facts.appointment ? null : this.stopHold(facts.stop, ms(record.created_at));
      if (refused) throw refused;
      record = this.settleNumber(facts, record);
      this.claim(facts, record, sent);
      const back = this.confirm(facts, record, sent);
      // Only now is it known that no earlier record of this name carried a claim from this epoch.
      for (const row of unused.stale) this.markUnused(row.id);
      return this.done(facts, record, back, sent);
    } catch (error) {
      throw this.stopped(error, { facts, record, sent, stale: unused.stale });
    }
  }

  done(facts, record, back, sent) {
    const result = this.report('apply', facts);
    result.parent = { ...result.parent, epoch: back.fence.epoch, next_epoch: null, taken_from: facts.fence.epoch };
    result.record = { record_id: record.record_id, line: record.line, comment_id: record.id, url: record.url, created_at: record.created_at, author: record.login, resumed: record.resumed, ...(record.renumbered_from ? { renumbered_from: record.renumbered_from } : {}) };
    result.claim = { commit: sent.landed.commit, acting: { prefix: this.writer.prefix, session: this.writer.session } };
    result.next_action = 'Controller: run reconcile (a dry run); it settles earlier intents by readback. Then continue.';
    result.done_line = this.doneLine(facts, result);
    return result;
  }

  doneLine(facts, result) {
    const handover = require('./programme-handover.cjs').handoverUrl(this.binding.store, this.parent);
    return [`Takeover done: ${this.writer.session} holds #${this.parent} at epoch ${result.parent.epoch} (was ${facts.fence.epoch}${facts.oldName ? `, ${facts.oldName}` : ''})`,
      `record ${result.record.record_id} ${result.record.url}`, `Toolkit main ${short(facts.toolkit.main)}, Controller blob ${short(facts.toolkit.controller_blob)}`,
      facts.versions.line, `latest sweep run: ${facts.sweep.status}`, `handover file ${handover}`, `next: ${this.input.next}`].join('; ') + '.';
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
function closedReport({ closed, input, transport }, git) {
  const store = closed.code === 'STORE_UNREACHABLE';
  const get = path => transport.request('GET', path);
  const toolkit = readToolkit(get);
  const old = input.ownerStop ? `old writer stopped: the owner said "${input.ownerStop}"` : 'old writer: not read (no programme state)';
  const line = toolkit.controller_blob ? recordLine({ input, toolkit, old }) : null;
  const holds = [{ code: closed.code, detail: closed.message }, ...(line ? [] : [{ code: 'TOOLKIT_UNREADABLE', detail: `Toolkit main or its CONTROLLER.md could not be read (${toolkit.reason}).` }])];
  return { schema: SCHEMA, mode: 'dry-run', ready: false, repository: null, governance: { state: store ? 'ENABLED' : closed.details?.governance || 'UNREADABLE' }, account: null,
    toolkit: { main: toolkit.main, controller_blob: toolkit.controller_blob }, versions: versionsOf({ get, main: toolkit.main, chat: input.chat, git }), sweep: null, attention: null, parent: null, stop: null,
    record: line && !store ? { line, ready: false, carrier: 'evidence store' } : null, holds, done_line: null };
}

function takeover(args, context, { attention, git } = {}) {
  if (context.closed) return closedReport(context, git);
  const run = new TakeoverRun({ store: context.store, transport: context.transport, binding: context.binding, repository: context.repository, writer: context.writer, input: context.input, now: context.now, git, attention });
  return args.apply ? run.apply() : run.dryRun();
}

function formatTakeover(result) {
  if (result.done_line) return `${result.done_line}\n${result.next_action}\n`;
  const { parent, stop, record } = result;
  const lines = [`Takeover dry run${result.repository ? ` of ${result.repository.name} (default branch ${result.repository.default_branch})` : ''}: ${result.ready ? 'ready' : 'not ready'}. Nothing was written.`,
    `Governance: ${result.governance.state}`,
    ...(result.account ? [`Account: ${result.account.login || 'not read'} (${result.account.permission})`] : []),
    `Toolkit main ${result.toolkit.main || 'not read'}; CONTROLLER.md blob ${result.toolkit.controller_blob || 'not read'}`,
    `Versions: ${result.versions.line.slice('versions: '.length)}`,
    ...(result.sweep ? [`Latest sweep run: ${result.sweep.status}${result.sweep.url ? ` (${result.sweep.url})` : ''}`] : []),
    ...(parent?.epoch === null || !parent ? [] : [`Parent #${parent.issue}: epoch ${parent.epoch}, ${parent.held ? `held by ${parent.holder || `a ${parent.holder_prefix} controller no earlier record names`}` : 'held by nobody'}; a takeover makes it epoch ${parent.next_epoch}`]),
    ...(stop?.last_write ? [`Old controller's last own write: ${stop.last_write.what} at ${stop.last_write.at} (${stop.last_write.url})`] : []),
    ...(stop ? [`Stop: ${stop.proven ? `proven (${stop.by === 'owner' ? 'the owner\'s words' : 'quiet for 10 minutes'})` : `not proven yet${stop.quiet_at ? `; quiet for 10 minutes at ${stop.quiet_at}` : ''}`}`] : []),
    ...result.holds.map(entry => `Hold ${entry.code}: ${entry.detail}`),
    ...(record ? ['', `Record (${record.carrier}${record.unused ? `; an unused one is already there: ${record.unused.url}` : ''}):`, record.line] : [])];
  return `${lines.join('\n')}\n`;
}

module.exports = Object.freeze({ SCHEMA, QUIET_MS, TakeoverRun, takeoverInput, versionsOf, recordLine, parseRecord, claimStanding, nextName, openTakeover, takeover, formatTakeover });
