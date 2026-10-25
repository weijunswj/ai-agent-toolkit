'use strict';

// Default-branch protection for a Toolkit-governed (ENABLED) github.com repository. The reconciler
// treats "CI green" as every check named in the programme binding (`required_checks` in
// .github/toolkit-programme.json) passing at the head, so the default branch must require exactly
// those checks, and a passing check must never hide a failing or pending one:
//
//   P1 required checks match: the required status checks on the default branch (every active
//      ruleset rule plus classic branch protection) are exactly the binding's `required_checks`.
//   P2 pinned source: each required check is pinned to an app, so a job of the same name in any
//      other workflow (or a commit status) cannot satisfy it.
//   P3 one producer: exactly one job across .github/workflows yields each required name. A job
//      named by an expression that could produce the name leaves P3 unverified.
//   P4 no masking: that job's workflow runs on every pull request to the default branch (no path
//      filters, no branch filter that leaves the default branch out), and its `if:` is absent or
//      exactly `always()` or `!cancelled()` (GitHub reports a skipped job as success, so any other
//      condition can pass the check without running it). A job with `needs` must run `always()` or
//      `!cancelled()` and have a step whose exit code is the declared aggregate command's: no step
//      `if`, `continue-on-error`, custom shell or working directory, `TEST_LEGS: ${{ toJSON(needs) }}`,
//      and a script of plain `node <file>.cjs` lines ending with `node repo/scripts/run-tests.cjs
//      --verify-ci`, which fails unless every needed job succeeded (see aggregateProblem). Without
//      one, or with YAML this reader does not follow (anchors, flow mappings, folded scalars),
//      P4 is unverified, never conformant.
//   P5 merge commits only: the default branch allows only merge commits (ruleset
//      `allowed_merge_methods`, the most restrictive across rulesets, else the repository settings).
//
// P1, P2 and P5 ask GitHub through the signed-in `gh` CLI (GET /repos/{slug}, the active rules for
// the default branch, classic branch protection, which needs admin, and the repository's rulesets,
// to find the one Toolkit names); P3 and P4 read the
// checked-out workflow files. `--offline` checks P3 and P4 only. Nothing here writes, except
// `ghProtectionRulesetWriter`, which only `toolkit governance migrate` calls after the owner's typed
// yes; it creates or updates the one ruleset Toolkit names and never touches any other.
//
// The workflow reader understands the YAML GitHub workflows use in practice (block mappings, block
// and inline lists, quoted scalars); a job named by an expression, a matrix job and a reusable
// workflow call produce names it does not try to predict.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const governance = require('./toolkit-governance-state.cjs');

const GH_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 1024 * 1024;
const MAX_WORKFLOW_BYTES = 512 * 1024;
const GITHUB_ACTIONS_APP_ID = 15368;
const RULESET_NAME = 'Toolkit: protected default branch';
const PR_EVENTS = Object.freeze(['pull_request', 'pull_request_target']);
// The declared aggregate command: this repository's own check that fails unless every needed job
// succeeded, reading the needs results from TEST_LEGS. Other repositories have none yet, so a job
// with `needs` there is unverified.
const AGGREGATE_LINE = /^node\s+repo\/scripts\/run-tests\.cjs\s+--verify-ci(?:\s+(?:[A-Za-z0-9_./:@%+,=-]+|"[A-Za-z0-9_./:@%+,=$ -]*"))?$/;
const AGGREGATE_ENV = 'TEST_LEGS';
const PASSES_NEEDS = /^\$\{\{\s*toJSON\(\s*needs\s*\)\s*\}\}$/;
// A plain command line: `node <file>.cjs` and literal arguments, nothing a shell would treat
// specially (no operators, redirections, substitutions, expressions or unquoted variables).
const ARGUMENT = '(?:--?[A-Za-z0-9][A-Za-z0-9-]*(?:=[A-Za-z0-9_./:@%+,-]*)?|[A-Za-z0-9_./:@%+,=][A-Za-z0-9_./:@%+,=-]*|"[A-Za-z0-9_./:@%+,=$ -]*")';
const PLAIN_LINE = new RegExp(`^node\\s+[A-Za-z0-9_][A-Za-z0-9_./-]*\\.c?js(?:\\s+${ARGUMENT})*$`);
// Shells under which the script's last command decides the step's result.
const PLAIN_SHELLS = Object.freeze(['bash', 'pwsh', 'sh']);
// Environment that changes how node or the shell starts.
const STARTUP_ENV = /^(?:PATH|BASH_ENV|ENV|NODE_[A-Z_]*)$/i;
// The only job conditions that cannot skip the job on a pull request.
const SAFE_IF = /^(?:\$\{\{\s*)?(?:always\(\)|!\s*cancelled\(\))(?:\s*\}\})?$/;

// ---- workflow files (P3, P4) ------------------------------------------------------------------

function unquote(value) {
  const text = String(value).trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))) return text.slice(1, -1);
  return text;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function inlineList(value) {
  const text = String(value).trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return null;
  return text.slice(1, -1).split(',').map(unquote).filter(Boolean);
}

// The lines of `text` as { indent, text, raw }, blank and comment-only lines dropped.
function significantLines(text) {
  return String(text).replace(/\r\n/g, '\n').split('\n').map(raw => {
    const clean = stripComment(raw).replace(/\s+$/, '');
    return { indent: clean.length - clean.trimStart().length, text: clean.trim(), raw };
  }).filter(line => line.text.length > 0);
}

// The direct children of the mapping that starts after line `start` (exclusive) at a deeper indent:
// [{ key, value, index, end }], where value is the scalar after the colon and end is exclusive.
function children(lines, start, end) {
  const first = lines.slice(start, end).find(Boolean);
  if (!first) return [];
  const indent = first.indent;
  const out = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith('- ')) continue;
    const match = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(line.text);
    if (!match) continue;
    let stop = index + 1;
    while (stop < end && lines[stop].indent > indent) stop += 1;
    out.push({ key: unquote(match[1]), value: match[2] === undefined ? '' : match[2], index, end: stop });
  }
  return out;
}

function blockList(lines, entry) {
  const inline = inlineList(entry.value);
  if (inline) return inline;
  if (entry.value && !['|', '>'].includes(entry.value.trim())) return [unquote(entry.value)];
  const nested = lines.slice(entry.index + 1, entry.end).filter(line => line.text.startsWith('- ')).map(line => unquote(line.text.slice(2)));
  if (nested.length) return nested;
  // An indentless list: the items sit at the key's own indent.
  const items = [];
  for (let index = entry.end; index < lines.length && lines[index].indent === lines[entry.index].indent && lines[index].text.startsWith('- '); index += 1) items.push(unquote(lines[index].text.slice(2)));
  return items;
}

// A scalar field's value; a block scalar (`|` or `>`) is its lines joined by `joiner`. A plain or
// quoted scalar that continues on the next lines (YAML folds them into one) is null: unreadable.
function scalarValue(lines, entry, joiner = ' ') {
  if (/^[|>][+-]?$/.test(entry.value.trim())) return lines.slice(entry.index + 1, entry.end).map(line => line.text).join(joiner).trim();
  if (entry.end > entry.index + 1) return null;
  return unquote(entry.value);
}

// A mapping field's entries as { key: value } (values may be null), or null for a flow mapping.
function mapping(lines, entry) {
  if (!entry) return {};
  if (entry.value.trim()) return null;
  return Object.fromEntries(children(lines, entry.index + 1, entry.end).map(item => [item.key, scalarValue(lines, item)]));
}

// The steps of a job as [{ run, run_style, env, if, continue_on_error, shell, working_directory, uses }]
// (comments stripped), or [] when it has none.
function readSteps(lines, stepsEntry) {
  if (!stepsEntry) return [];
  const body = lines.slice(stepsEntry.index + 1, stepsEntry.end);
  if (!body.length) return [];
  const itemIndent = body[0].indent;
  const steps = [];
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index];
    if (line.indent !== itemIndent || !line.text.startsWith('- ')) continue;
    let stop = index + 1;
    while (stop < body.length && !(body[stop].indent <= itemIndent)) stop += 1;
    // Re-indent the item's first line so its keys line up with the rest of the item.
    const item = [{ indent: itemIndent + 2, text: line.text.slice(2).trim(), raw: line.raw }, ...body.slice(index + 1, stop)];
    const fields = children(item, 0, item.length);
    const field = key => fields.find(entry => entry.key === key);
    const run = field('run');
    steps.push({
      run: run ? scalarValue(item, run, '\n') : null,
      run_style: run ? (/^\|[+-]?$/.test(run.value.trim()) ? 'literal' : /^[|>]/.test(run.value.trim()) ? 'other' : 'plain') : null,
      env: mapping(item, field('env')),
      if: field('if') ? field('if').value : null,
      continue_on_error: field('continue-on-error') ? scalarValue(item, field('continue-on-error')) : null,
      shell: field('shell') ? scalarValue(item, field('shell')) : null,
      working_directory: Boolean(field('working-directory')),
      uses: Boolean(field('uses')),
    });
    index = stop - 1;
  }
  return steps;
}

// `defaults.run` of a workflow or job: { shell, working_directory }, or null when unreadable.
function runDefaults(lines, entry) {
  if (!entry) return { shell: null, working_directory: false };
  const defaults = children(lines, entry.index + 1, entry.end);
  if (entry.value.trim()) return null;
  const run = defaults.find(item => item.key === 'run');
  if (!run) return { shell: null, working_directory: false };
  const values = mapping(lines, run);
  if (!values) return null;
  return { shell: values.shell === undefined ? null : values.shell, working_directory: 'working-directory' in values };
}

const notFalse = value => value !== null && value !== undefined && value !== 'false';

// Why `job` does not prove that it fails when a needed job did not succeed, or null when a step
// does: that step has no `if`, `continue-on-error`, `uses` or `working-directory`, runs under a
// plain shell, gets TEST_LEGS exactly `${{ toJSON(needs) }}`, and its script is plain command
// lines ending with the aggregate command, so that command's exit code is the step's. Nothing in
// the job or workflow may change how node or the shell starts.
function aggregateProblem(job, workflowContext) {
  if (notFalse(job.continue_on_error)) return 'the job has continue-on-error';
  if (!workflowContext.defaults || !job.defaults) return 'its defaults could not be read';
  if (workflowContext.defaults.working_directory || job.defaults.working_directory) return 'a working-directory default moves the command';
  if (!workflowContext.env || !job.env) return 'its environment could not be read';
  const startup = [...Object.keys(workflowContext.env), ...Object.keys(job.env), ...job.steps.flatMap(step => Object.keys(step.env || {}))].find(key => STARTUP_ENV.test(key));
  if (startup) return `${startup} is set, which changes how node or the shell starts`;
  if (job.steps.some(step => step.run === null ? false : /GITHUB_(?:ENV|PATH)/.test(step.run))) return 'a step writes GITHUB_ENV or GITHUB_PATH';
  const reasons = [];
  for (const step of job.steps) {
    if (step.run === null || step.uses) continue;
    if (!AGGREGATE_LINE.test(step.run.split('\n').filter(Boolean).at(-1) || '')) continue;
    const shell = step.shell !== null ? step.shell : job.defaults.shell !== null ? job.defaults.shell : workflowContext.defaults.shell;
    const legs = step.env && Object.prototype.hasOwnProperty.call(step.env, AGGREGATE_ENV) ? step.env[AGGREGATE_ENV] : job.env[AGGREGATE_ENV];
    if (step.if !== null) reasons.push('the aggregate step has its own `if`');
    else if (notFalse(step.continue_on_error)) reasons.push('the aggregate step has continue-on-error');
    else if (step.working_directory) reasons.push('the aggregate step sets working-directory');
    else if (!step.env) reasons.push('the aggregate step\'s env could not be read');
    else if (shell !== null && !PLAIN_SHELLS.includes(shell)) reasons.push(`the aggregate step runs under shell "${shell}"`);
    else if (step.run_style === 'other') reasons.push('the aggregate step\'s script is a folded block');
    else if (!step.run.split('\n').filter(Boolean).every(line => PLAIN_LINE.test(line))) reasons.push('the aggregate step\'s script has a line that is not a plain node command');
    else if (typeof legs !== 'string' || !PASSES_NEEDS.test(legs.trim())) reasons.push(`the aggregate step does not get ${AGGREGATE_ENV}: \${{ toJSON(needs) }}`);
    else return null;
  }
  return reasons[0] || `no step ends with the declared aggregate command (node repo/scripts/run-tests.cjs --verify-ci with ${AGGREGATE_ENV}: \${{ toJSON(needs) }})`;
}

// YAML features the reader does not follow: anchors, aliases and merge keys.
function unfollowedYaml(lines) {
  return lines.some(line => /^<<\s*:/.test(line.text) || /(?::|^-)\s+[&*][A-Za-z0-9_-]+(?:\s|$)/.test(line.text));
}

// { triggers: Map(event -> { filters: { paths, paths-ignore, branches, branches-ignore } }), jobs: [...] }
function readWorkflow(text) {
  const lines = significantLines(text);
  const top = children(lines, 0, lines.length);
  const triggers = new Map();
  const on = top.find(entry => entry.key === 'on' || entry.key === 'true');
  if (on) {
    const scalar = on.value.trim();
    const listed = inlineList(scalar);
    if (listed) for (const event of listed) triggers.set(event, { filters: {} });
    else if (scalar) triggers.set(unquote(scalar), { filters: {} });
    else {
      const childIndent = on.end > on.index + 1 ? lines[on.index + 1].indent : -1;
      const blockEvents = lines.slice(on.index + 1, on.end).filter(line => line.indent === childIndent && line.text.startsWith('- '));
      for (const line of blockEvents) triggers.set(unquote(line.text.slice(2)), { filters: {} });
      for (const event of children(lines, on.index + 1, on.end)) {
        const filters = {};
        for (const filter of children(lines, event.index + 1, event.end)) {
          if (['paths', 'paths-ignore', 'branches', 'branches-ignore'].includes(filter.key)) filters[filter.key] = blockList(lines, filter);
        }
        triggers.set(event.key, { filters });
      }
    }
  }
  const jobs = [];
  const problems = [];
  if (unfollowedYaml(lines)) problems.push('it uses YAML anchors, aliases or merge keys, which this check does not follow');
  const workflowContext = { defaults: runDefaults(lines, top.find(entry => entry.key === 'defaults')), env: mapping(lines, top.find(entry => entry.key === 'env')) };
  const jobsEntry = top.find(entry => entry.key === 'jobs');
  if (jobsEntry && jobsEntry.value.trim()) problems.push('its jobs are written as a flow mapping');
  if (jobsEntry) {
    for (const job of children(lines, jobsEntry.index + 1, jobsEntry.end)) {
      if (job.value.trim()) problems.push(`job ${job.key} is written on one line (a flow mapping)`);
      const fields = children(lines, job.index + 1, job.end);
      const field = key => fields.find(entry => entry.key === key);
      const nameField = field('name');
      const name = nameField ? unquote(nameField.value) : job.key;
      const needsField = field('needs');
      const strategy = field('strategy');
      const matrix = strategy ? children(lines, strategy.index + 1, strategy.end).some(entry => entry.key === 'matrix') : false;
      const ifField = field('if');
      const needs = needsField ? blockList(lines, needsField) : [];
      const unreadable = [];
      if (job.value.trim()) unreadable.push('the job is a flow mapping');
      if (needsField && needs.length === 0) unreadable.push('its needs could not be read');
      const ifValue = ifField ? scalarValue(lines, ifField) : null;
      if (ifField && ifValue === null) unreadable.push('its if could not be read');
      const entry = {
        key: job.key,
        name,
        dynamic_name: name.includes('${{'),
        matrix,
        reusable: Boolean(field('uses')),
        needs,
        if: ifValue,
        unreadable,
        continue_on_error: field('continue-on-error') ? scalarValue(lines, field('continue-on-error')) : null,
        defaults: runDefaults(lines, field('defaults')),
        env: mapping(lines, field('env')),
        steps: readSteps(lines, field('steps')),
      };
      entry.aggregate_problem = needs.length ? aggregateProblem(entry, workflowContext) : null;
      jobs.push(entry);
    }
  }
  return { triggers, jobs, problems };
}

// Every workflow under .github/workflows at `root`: [{ file, workflow }] or [{ file, error }].
function readWorkflows(root) {
  const directory = path.join(root, '.github', 'workflows');
  let names = [];
  try { names = fs.readdirSync(directory).filter(name => /\.ya?ml$/i.test(name)).sort(); } catch { names = []; }
  return names.map(name => {
    const file = `.github/workflows/${name}`;
    try {
      const stat = fs.statSync(path.join(directory, name));
      if (!stat.isFile() || stat.size > MAX_WORKFLOW_BYTES) return { file, error: 'unreadable' };
      return { file, workflow: readWorkflow(fs.readFileSync(path.join(directory, name), 'utf8')) };
    } catch { return { file, error: 'unreadable' }; }
  });
}

function globMatches(pattern, value) {
  const expression = String(pattern).split('**').map(part => part.split('*').map(piece => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${expression}$`).test(value);
}

// Why this workflow can skip a pull request to `defaultBranch` (null when unknown), or null when it
// cannot; { unverified } when that depends on the unknown default branch.
function maskingTrigger(workflow, defaultBranch) {
  const events = PR_EVENTS.filter(event => workflow.triggers.has(event));
  if (events.length === 0) return 'the workflow does not run on pull requests';
  for (const event of events) {
    const filters = workflow.triggers.get(event).filters;
    if (filters.paths || filters['paths-ignore']) return `its ${event} trigger has a path filter, which leaves the check pending`;
    if ((filters.branches || filters['branches-ignore']) && defaultBranch === null) return { unverified: `its ${event} trigger has a branch filter and the default branch is unknown (no GitHub read and no origin/HEAD)` };
    if (filters.branches && !filters.branches.some(pattern => globMatches(pattern, defaultBranch))) return `its ${event} branch filter leaves out ${defaultBranch}`;
    if (filters['branches-ignore'] && filters['branches-ignore'].some(pattern => globMatches(pattern, defaultBranch))) return `its ${event} trigger ignores ${defaultBranch}`;
  }
  return null;
}

// Whether an expression-named job's name could come out as `check`.
function couldProduce(name, check) {
  const expression = String(name).split(/\$\{\{[\s\S]*?\}\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*');
  return new RegExp(`^${expression}$`).test(check);
}

// P3 and P4 for each required name over read workflows.
function producerVerdict(requiredChecks, workflows, defaultBranch) {
  const p3 = [];
  const p3Unverified = [];
  const missing = [];
  const p4 = [];
  const p4Unverified = [];
  const unreadable = [
    ...workflows.filter(entry => entry.error).map(entry => `${entry.file} could not be read`),
    ...workflows.filter(entry => entry.workflow && entry.workflow.problems && entry.workflow.problems.length).map(entry => `${entry.file}: ${entry.workflow.problems.join('; ')}`),
  ];
  const neverReports = [];
  for (const check of requiredChecks) {
    const producers = [];
    for (const entry of workflows) {
      if (!entry.workflow) continue;
      for (const job of entry.workflow.jobs) {
        if (job.dynamic_name && couldProduce(job.name, check)) p3Unverified.push(`${entry.file} ${job.key} is named by an expression that could produce "${check}"`);
        else if (!job.dynamic_name && !job.matrix && !job.reusable && job.name === check) producers.push({ file: entry.file, workflow: entry.workflow, job });
      }
    }
    if (producers.length === 0) missing.push(check);
    if (producers.length !== 1) {
      p3.push(producers.length === 0
        ? `no workflow job is named "${check}"`
        : `"${check}" is produced by ${producers.length} jobs (${producers.map(item => `${item.file} ${item.job.key}`).join(', ')})`);
      continue;
    }
    const [{ file, workflow, job }] = producers;
    const trigger = maskingTrigger(workflow, defaultBranch);
    if (trigger && trigger.unverified) p4Unverified.push(`"${check}" (${file}): ${trigger.unverified}`);
    else if (trigger) { p4.push(`"${check}" (${file}): ${trigger}`); neverReports.push(check); }
    if (job.unreadable && job.unreadable.length) { p4Unverified.push(`"${check}" (${file}): ${job.unreadable.join('; ')}`); continue; }
    const safeIf = job.if !== null && SAFE_IF.test(job.if.trim());
    if (job.if !== null && !safeIf) p4.push(`"${check}" (${file}) has a job condition other than \`always()\` or \`!cancelled()\`, so it can be skipped, and a skipped job reports success`);
    else if (job.needs.length > 0) {
      if (!safeIf) p4.push(`"${check}" (${file}) waits for ${job.needs.join(', ')} without \`if: always()\`, so a failed one skips it and a skipped job reports success`);
      else if (job.aggregate_problem) p4Unverified.push(`"${check}" (${file}) runs after ${job.needs.join(', ')}, but nothing proves it fails when one of them did not succeed: ${job.aggregate_problem}`);
    }
  }
  const p3Status = p3.length ? 'drift' : (p3Unverified.length || unreadable.length) ? 'unverified' : 'ok';
  const p4Status = p4.length ? 'drift' : (p4Unverified.length || unreadable.length) ? 'unverified' : 'ok';
  return {
    P3: { status: p3Status, details: p3.length ? p3 : [...p3Unverified, ...unreadable], missing },
    P4: { status: p4Status, details: p4.length ? p4 : [...p4Unverified, ...unreadable], never_reports: neverReports },
  };
}

// ---- GitHub settings (P1, P2, P5) ---------------------------------------------------------------

function ghJson(args, spawn, input = null) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', ...args], {
      encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false,
      ...(input === null ? {} : { input }),
    });
  } catch {
    return { ok: false, reason: 'gh-unavailable' };
  }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) {
    const stderr = String(result.stderr || '') + String(result.stdout || '');
    if (/Branch not protected/i.test(stderr)) return { ok: false, reason: 'branch-not-protected' };
    if (/HTTP 403/.test(stderr) && /upgrade to github pro|make this repository public/i.test(stderr)) return { ok: false, reason: 'plan-has-no-protection' };
    return { ok: false, reason: /HTTP 404/.test(stderr) ? 'not-visible' : 'gh-request-failed' };
  }
  try { return { ok: true, value: JSON.parse(result.stdout) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

// What GitHub says protects the default branch of `slug`:
// { ok, default_branch, repository: { allow_merge_commit, allow_squash_merge, allow_rebase_merge },
//   rules: [active rules for the branch], classic: { checks: [{ context, app_id }] } | null,
//   toolkit_ruleset: { id, body } | null } or { ok: false, reason }.
function ghProtectionReader(slug, { spawn = childProcess.spawnSync } = {}) {
  const repository = ghJson([`repos/${slug}`], spawn);
  if (!repository.ok) return repository;
  const value = repository.value || {};
  const branch = typeof value.default_branch === 'string' && value.default_branch ? value.default_branch : null;
  if (!branch) return { ok: false, reason: 'gh-output-invalid' };
  const rules = ghJson([`repos/${slug}/rules/branches/${encodeURIComponent(branch)}?per_page=100`], spawn);
  if (!rules.ok) return rules;
  if (!Array.isArray(rules.value)) return { ok: false, reason: 'gh-output-invalid' };
  const classicRead = ghJson([`repos/${slug}/branches/${encodeURIComponent(branch)}/protection`], spawn);
  let classic = null;
  if (classicRead.ok) {
    const checks = classicRead.value && classicRead.value.required_status_checks;
    classic = { checks: checks && Array.isArray(checks.checks) ? checks.checks.map(item => ({ context: item.context, app_id: item.app_id === undefined ? null : item.app_id })) : [] };
  } else if (classicRead.reason !== 'branch-not-protected') {
    return { ok: false, reason: classicRead.reason === 'plan-has-no-protection' ? 'plan-has-no-protection' : 'classic-protection-not-visible' };
  }
  const list = ghJson([`repos/${slug}/rulesets?targets=branch&per_page=100`], spawn);
  if (!list.ok) return list;
  const own = (Array.isArray(list.value) ? list.value : []).find(entry => entry && entry.name === RULESET_NAME && entry.source_type !== 'Organization');
  return {
    ok: true,
    default_branch: branch,
    repository: { allow_merge_commit: value.allow_merge_commit, allow_squash_merge: value.allow_squash_merge, allow_rebase_merge: value.allow_rebase_merge },
    rules: rules.value,
    classic,
    toolkit_ruleset: own && Number.isInteger(own.id) ? { id: own.id } : null,
  };
}

// The ruleset Toolkit adds or updates: the default branch, no bypass, the binding's checks pinned to
// GitHub Actions, and a pull request with merge commits only.
function protectionRulesetBody(requiredChecks) {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          allowed_merge_methods: ['merge'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [...requiredChecks].sort().map(context => ({ context, integration_id: GITHUB_ACTIONS_APP_ID })),
        },
      },
    ],
  };
}

// Creates the Toolkit ruleset, or updates it when `existingId` names it. { ok, id } or { ok: false, reason }.
function ghProtectionRulesetWriter(slug, requiredChecks, existingId = null, { spawn = childProcess.spawnSync } = {}) {
  const args = existingId ? ['-X', 'PUT', `repos/${slug}/rulesets/${existingId}`] : ['-X', 'POST', `repos/${slug}/rulesets`];
  const written = ghJson([...args, '--input', '-'], spawn, JSON.stringify(protectionRulesetBody(requiredChecks)));
  if (!written.ok) return written;
  return written.value && Number.isInteger(written.value.id) ? { ok: true, id: written.value.id } : { ok: false, reason: 'gh-output-invalid' };
}

function settingsVerdict(requiredChecks, read) {
  const required = new Map();
  const add = (context, pinned, source) => {
    if (typeof context !== 'string' || !context) return;
    const entry = required.get(context) || { pinned: true, sources: [] };
    entry.pinned = entry.pinned && pinned;
    entry.sources.push(source);
    required.set(context, entry);
  };
  let rulesetMethods = null;
  for (const rule of read.rules) {
    if (!rule || !rule.parameters) continue;
    const source = rule.ruleset_id ? `ruleset ${rule.ruleset_id}` : 'a ruleset';
    if (rule.type === 'required_status_checks' && Array.isArray(rule.parameters.required_status_checks)) {
      for (const item of rule.parameters.required_status_checks) add(item && item.context, Boolean(item && Number.isInteger(item.integration_id)), source);
    }
    if (rule.type === 'pull_request' && Array.isArray(rule.parameters.allowed_merge_methods)) {
      const methods = rule.parameters.allowed_merge_methods;
      rulesetMethods = rulesetMethods === null ? [...methods] : rulesetMethods.filter(method => methods.includes(method));
    }
  }
  if (read.classic) for (const item of read.classic.checks) add(item.context, item.app_id !== null && item.app_id !== -1, 'classic branch protection');
  const wanted = new Set(requiredChecks);
  const missing = requiredChecks.filter(check => !required.has(check));
  const extra = [...required.keys()].filter(check => !wanted.has(check));
  const unpinned = [...required.entries()].filter(([, entry]) => !entry.pinned).map(([context, entry]) => `"${context}" (${entry.sources.join(', ')})`);
  const settings = read.repository || {};
  const methods = rulesetMethods !== null ? rulesetMethods : [
    settings.allow_merge_commit === true ? 'merge' : null,
    settings.allow_squash_merge === true ? 'squash' : null,
    settings.allow_rebase_merge === true ? 'rebase' : null,
  ].filter(Boolean);
  const mergeOnly = methods.length === 1 && methods[0] === 'merge';
  return {
    P1: { status: missing.length || extra.length ? 'drift' : 'ok', details: [...missing.map(check => `"${check}" is in the binding but not required`), ...extra.map(check => `"${check}" is required but not in the binding`)], missing, extra },
    P2: { status: unpinned.length ? 'drift' : 'ok', details: unpinned.map(item => `${item} is not pinned to an app`) },
    P5: { status: mergeOnly ? 'ok' : 'drift', details: mergeOnly ? [] : [`${read.default_branch} allows ${methods.length ? methods.join(', ') : 'no merge method'} (${rulesetMethods !== null ? 'rulesets' : 'repository settings'}); only merge commits are allowed`] },
  };
}

// ---- the verdict --------------------------------------------------------------------------------

function verdict(status, reason, checks = {}, extra = {}) {
  return Object.freeze({ status, reason, checks: Object.freeze(checks), ...extra });
}

// The default branch as the local clone last saw it (origin/HEAD), or null when unknown.
function localDefaultBranch(root) {
  const result = childProcess.spawnSync('git', ['--no-optional-locks', '-C', root, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, shell: false });
  const ref = !result.error && result.status === 0 ? String(result.stdout).trim() : '';
  return ref.startsWith('origin/') && ref.length > 'origin/'.length ? ref.slice('origin/'.length) : null;
}

// { status: conformant | drift | unverified | not-enforceable | not-applicable, reason, checks: { P1..P5 } }
// for the repository at `root`. Options: `requiredChecks` (from the binding), `offline`, `reader(slug)`
// (tests).
function defaultBranchProtection(root, { requiredChecks = [], offline = false, reader = ghProtectionReader } = {}) {
  let identity;
  try { identity = governance.readIdentity(root); } catch { return verdict('unverified', 'identity-unreadable'); }
  const slug = identity.valid ? governance.remoteSlug(identity.remote) : null;
  if (!identity.valid || identity.remote.host !== 'github.com' || !slug) return verdict('not-applicable', 'not-a-github-repository');
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) return verdict('unverified', 'binding-has-no-required-checks');
  let read = null;
  if (!offline) {
    try { read = reader(slug); } catch { read = { ok: false, reason: 'reader-failed' }; }
  }
  const defaultBranch = read && read.ok ? read.default_branch : localDefaultBranch(root);
  const checks = { ...producerVerdict(requiredChecks, readWorkflows(root), defaultBranch) };
  if (offline) {
    for (const id of ['P1', 'P2', 'P5']) checks[id] = { status: 'not-checked', details: ['offline'] };
  } else if (!read || read.ok !== true) {
    const reason = (read && read.reason) || 'reader-failed';
    for (const id of ['P1', 'P2', 'P5']) checks[id] = { status: reason === 'plan-has-no-protection' ? 'not-enforceable' : 'unverified', details: [reason] };
    if (reason === 'plan-has-no-protection') return verdict('not-enforceable', reason, checks);
  } else {
    Object.assign(checks, settingsVerdict(requiredChecks, read));
  }
  const statuses = Object.values(checks).map(entry => entry.status);
  const status = statuses.includes('drift') ? 'drift' : statuses.every(item => item === 'ok') ? 'conformant' : 'unverified';
  return verdict(status, null, checks, read && read.ok ? { toolkit_ruleset: read.toolkit_ruleset, slug } : { slug });
}

module.exports = Object.freeze({
  RULESET_NAME,
  GITHUB_ACTIONS_APP_ID,
  readWorkflow,
  producerVerdict,
  settingsVerdict,
  protectionRulesetBody,
  ghProtectionReader,
  ghProtectionRulesetWriter,
  defaultBranchProtection,
});
