#!/usr/bin/env node
'use strict';

// Toolkit's own check of the installed Claude Code result. Setup runs it last; the installed
// session-start hook runs it after its maintenance. It gives one result:
//   passed            what Toolkit installed is current and in use
//   restart-required  this run changed the install; the next Claude Code session confirms it
//   action-required   something needs a person; `actions` lists the steps in plain words
// A check that could not be completed is action-required, never passed.
//
// Checks: the Claude Code plugin (setup only; from the setup verifier's summary), the update
// record in the Toolkit hub, the Toolkit helper definitions and global rules (each refreshed
// when stale), the Toolkit-owned Claude Code depth setting against the selected topology, and,
// once toolkit env is in use, its store and connected MCP entries (by key name only).
// Notices that block nothing: an older uploaded Projects controller skill, and an older Toolkit copy
// from the user's claude.ai account in the Claude desktop app (read only; claude.ai alone updates it).
//
// Usage (session-start hook): node repo/scripts/toolkit-install-health.cjs --session-start [--hub <path>]
// Prints the result as JSON. Exit 0 when the check ran, 1 when it could not run.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { samePath } = require('./toolkit-canonical-path.cjs');
const { ClaudeHelperDefinitions } = require('./toolkit-claude-helper-agents.cjs');
const { GlobalRules, describeResult: describeGlobalRules } = require('./toolkit-global-rules.cjs');
const { ClaudeSubagentDepthSetting, SETTING: DEPTH_SETTING, STATES: DEPTH } = require('./toolkit-claude-subagent-depth.cjs');
const { ToolkitEnv } = require('./toolkit-env.cjs');
const { accountCopyBehind } = require('./toolkit-claude-account-copy.cjs');

const STATUS = Object.freeze({ PASSED: 'passed', RESTART: 'restart-required', ACTION: 'action-required' });
const RECORDED_SOURCES = Object.freeze(['claude-plugin', 'repo']);
const DEFAULT_RETENTION_DAYS = 7;

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number), b = String(right).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
  return 0;
}

function readJsonIfExists(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return JSON.parse(text.replace(/^﻿/, ''));
}

function slash(value) { return String(value || '').replace(/\\/g, '/'); }

const PROJECTS_SKILL_REL = path.join('repo', 'contracts', 'claude-projects', 'web-controller-projects', 'SKILL.md');
const QUALIFICATION_REL = path.join('repo', 'contracts', 'host-qualification', 'claude-code.json');
const PLATFORM_NAMES = Object.freeze({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' });
const skillVersion = (text) => /^Version:\s*(\d{4}-\d{2}-\d{2}\.\d+)\s*$/m.exec(String(text || ''))?.[1] || '';
// Versions look like 2026-10-23.6: the date, then a counter for that day.
function compareSkillVersions(left, right) {
  const [ld, ln] = left.split('.'), [rd, rn] = right.split('.');
  if (ld !== rd) return ld > rd ? 1 : -1;
  return Number(ln) === Number(rn) ? 0 : (Number(ln) > Number(rn) ? 1 : -1);
}

// The Claude desktop app keeps plugins from the user's claude.ai account in
// %LOCALAPPDATA%\Claude-Data\claude_<package>\rpm\<a>\<b>\, with a manifest.json listing each plugin's id.
// Returns those folders, or [] when the app is not installed. Read only.
function claudeAccountPluginFolders(environment = process.env) {
  const base = environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'Claude-Data') : '';
  const folders = [];
  const children = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { return []; } };
  for (const app of children(base).filter((entry) => entry.name.startsWith('claude_'))) {
    const rpm = path.join(base, app.name, 'rpm');
    for (const first of children(rpm)) for (const second of children(path.join(rpm, first.name))) folders.push(path.join(rpm, first.name, second.name));
  }
  // In name order, so every reader sees the same first copy whatever order the disk lists them in.
  return folders.sort();
}

// The newest Toolkit version among the account copies in those folders, or '' when there is none.
function claudeAccountToolkitVersion(folders) {
  const versions = [];
  for (const folder of folders) {
    let manifest;
    try { manifest = readJsonIfExists(path.join(folder, 'manifest.json')); } catch { continue; }
    for (const plugin of Array.isArray(manifest?.plugins) ? manifest.plugins : []) {
      if (plugin?.name !== 'ai-agent-toolkit' || typeof plugin.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(plugin.id)) continue;
      let pluginJson;
      try { pluginJson = readJsonIfExists(path.join(folder, plugin.id, '.claude-plugin', 'plugin.json')); } catch { continue; }
      if (/^\d+\.\d+\.\d+$/.test(pluginJson?.version || '')) versions.push(pluginJson.version);
    }
  }
  return versions.sort(compareVersions).pop() || '';
}

class ToolkitInstallHealthCheck {
  #toolkitRoot; #expectedVersion; #hubPath; #helpers; #globalRules; #depth; #env; #syncedSkillsDir; #accountPluginFolders; #platform;

  // envHealth: an object with health() (see toolkit-env.cjs), or null to skip that check.
  // syncedSkillsDir: where Claude Code keeps skills synced from claude.ai, or null to skip the Projects skill check.
  // accountPluginFolders: the Claude desktop app's account-plugin folders, or null to skip that check.
  constructor({ toolkitRoot, expectedVersion, hubPath, helperDefinitions, globalRules, depthSetting, envHealth = null, syncedSkillsDir = null, accountPluginFolders = null, platform = process.platform }) {
    this.#platform = platform;
    this.#toolkitRoot = path.resolve(toolkitRoot);
    this.#expectedVersion = expectedVersion;
    this.#hubPath = hubPath;
    this.#helpers = helperDefinitions;
    this.#globalRules = globalRules;
    this.#depth = depthSetting;
    this.#env = envHealth;
    this.#syncedSkillsDir = syncedSkillsDir;
    this.#accountPluginFolders = accountPluginFolders;
  }

  // The checks the installed session-start hook runs, wired to the real files.
  static forSessionStart({ environment = process.env, toolkitRoot = path.resolve(__dirname, '..', '..'), hubPath } = {}) {
    const hub = path.resolve(hubPath || path.join(os.homedir(), '.ai-agent-toolkit', 'current'));
    const state = readJsonIfExists(path.join(hub, 'state.json')) || {};
    const retentionDays = Number.isInteger(state.update_report_retention_days) && state.update_report_retention_days > 0
      ? state.update_report_retention_days : DEFAULT_RETENTION_DAYS;
    const manifest = readJsonIfExists(path.join(toolkitRoot, '.claude-plugin', 'plugin.json')) || {};
    return new ToolkitInstallHealthCheck({
      toolkitRoot,
      expectedVersion: manifest.version,
      hubPath: hub,
      helperDefinitions: new ClaudeHelperDefinitions({ environment, repositoryRoot: toolkitRoot, retentionDays }),
      globalRules: new GlobalRules({ environment, toolkitRoot, harnesses: ['claude-code'], retentionDays, respectRemoval: true }),
      depthSetting: new ClaudeSubagentDepthSetting({ environment }),
      envHealth: ToolkitEnv.forUser({ environment }),
      syncedSkillsDir: path.join(environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', 'synced'),
      accountPluginFolders: claudeAccountPluginFolders(environment),
    });
  }

  // Shown only when a copy of the Projects controller skill is synced from claude.ai (the user runs a
  // Claude Project as controller). An older copy is reported with Toolkit's SKILL.md, its size and sha256,
  // which the setup agent offers as a skill card the owner saves; it blocks nothing. A card carries SKILL.md only, so
  // when the account copy holds reference files that differ from Toolkit's, the whole folder is
  // uploaded by hand instead.
  #projectsSkillCheck() {
    if (!this.#syncedSkillsDir) return null;
    let copies = [];
    try {
      copies = fs.readdirSync(this.#syncedSkillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.#syncedSkillsDir, entry.name, 'web-controller-projects', 'SKILL.md'))
        .filter((file) => fs.existsSync(file));
    } catch { return null; }
    if (!copies.length) return null;
    const source = path.join(this.#toolkitRoot, PROJECTS_SKILL_REL);
    const repoVersion = fs.existsSync(source) ? skillVersion(fs.readFileSync(source, 'utf8')) : '';
    if (!repoVersion) return null;
    const uploaded = copies.map((file) => skillVersion(fs.readFileSync(file, 'utf8'))).filter(Boolean).sort(compareSkillVersions).pop() || '';
    const label = 'Claude Projects controller skill';
    if (uploaded && compareSkillVersions(uploaded, repoVersion) >= 0) return this.#check('projects-skill', label, STATUS.PASSED, `Your uploaded copy is current (${uploaded}).`);
    const behind = `Your uploaded copy is ${uploaded || 'missing its Version line'}; Toolkit has ${repoVersion}.`;
    const folder = slash(path.dirname(source));
    if (copies.some((file) => this.#referenceFilesDiffer(path.dirname(file), path.dirname(source)))) {
      return this.#check('projects-skill', label, STATUS.PASSED,
        `${behind} Your copy has its own reference files, so a skill card is not enough: upload the folder ${folder} to claude.ai (Customize > Skills, replace web-controller-projects).`);
    }
    // The size and sha256 let the setup agent confirm it passes the file it read, unchanged.
    const body = fs.readFileSync(source);
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    return this.#check('projects-skill', label, STATUS.PASSED,
      `${behind} Skill card: offer ${slash(source)} (${body.length} bytes, sha256 ${sha256}) as a skill update card to save. Without a card tool, upload the folder ${folder} to claude.ai (Customize > Skills, replace web-controller-projects).`);
  }

  // Whether an account copy holds a reference/*.md file that is not byte-equal to Toolkit's. A folder
  // that cannot be read counts as differing, so the notice asks for the whole folder.
  #referenceFilesDiffer(copyDir, sourceDir) {
    const referenceDir = path.join(copyDir, 'reference');
    let names;
    try { names = fs.readdirSync(referenceDir).filter((name) => name.endsWith('.md')); }
    catch (error) { return error.code !== 'ENOENT'; }
    return names.some((name) => {
      const ours = path.join(sourceDir, 'reference', name);
      return !fs.existsSync(ours) || !fs.readFileSync(ours).equals(fs.readFileSync(path.join(referenceDir, name)));
    });
  }

  // Shown only when the Claude desktop app holds a Toolkit copy from the user's claude.ai account.
  // The app runs that copy, and claude.ai alone updates it (from the Toolkit repository's main), so an
  // older copy is reported with the fix; Toolkit never changes it, and it blocks nothing.
  #accountPluginCheck() {
    if (!this.#accountPluginFolders?.length || !/^\d+\.\d+\.\d+$/.test(this.#expectedVersion || '')) return null;
    const account = claudeAccountToolkitVersion(this.#accountPluginFolders);
    if (!account) return null;
    const label = 'Claude app account copy';
    if (compareVersions(account, this.#expectedVersion) >= 0) return this.#check('account-plugin', label, STATUS.PASSED, `Your claude.ai account copy of Toolkit is current (${account}).`);
    return this.#check('account-plugin', label, STATUS.PASSED, accountCopyBehind(account, this.#expectedVersion));
  }

  #check(id, label, status, summary, action = '') {
    return { id, label, status, summary, ...(action ? { action } : {}) };
  }

  // What the stored native results say about the helper route on this computer's platform, and the
  // known limit. Informational: there is nothing for the owner to fix, so it always passes.
  #helperRoutes() {
    const label = 'Helper routes';
    let record;
    try { record = readJsonIfExists(path.join(this.#toolkitRoot, QUALIFICATION_REL)); }
    catch { record = null; }
    const runs = Array.isArray(record?.runs) ? record.runs : [];
    const platform = PLATFORM_NAMES[this.#platform] || this.#platform;
    const here = runs.filter((run) => run.platform === this.#platform).at(-1);
    const latest = runs.at(-1);
    const describe = (run) => `Claude Code ${run.claude_code_version} (${PLATFORM_NAMES[run.platform] || run.platform}, ${run.date})`;
    const status = here ? `Qualified on ${describe(here)}.`
      : latest ? `Not yet qualified on ${platform}; last qualified on ${describe(latest)}.`
        : 'Not yet qualified: no stored native result.';
    const limits = (Array.isArray(record?.known_limits) ? record.known_limits : []).map((limit) => ` Known limit: ${limit.summary}`).join('');
    return this.#check('helper-routes', label, STATUS.PASSED, `${status}${limits}`);
  }

  // plugin: { installed, current, running_copy, updated_this_run } from setup.
  #plugin(plugin) {
    const label = 'Claude Code plugin';
    if (plugin.installed !== true || plugin.current !== true) {
      return this.#check('plugin', label, STATUS.ACTION, `Toolkit ${this.#expectedVersion} is not installed, enabled and current in Claude Code, so its hooks are not enforced.`,
        'Run `setup toolkit` and choose to install or refresh the Claude Code plugin.');
    }
    if (!samePath(plugin.running_copy, this.#toolkitRoot)) {
      return this.#check('plugin', label, STATUS.ACTION, 'Claude Code does not run Toolkit from the managed checkout.',
        'Run `setup toolkit` and choose to install or refresh the Claude Code plugin.');
    }
    if (plugin.updated_this_run === true) {
      return this.#check('plugin', label, STATUS.RESTART, `Toolkit ${this.#expectedVersion} was installed this run.`,
        `Start a new Claude Code session, and close sessions opened before the update, so it loads Toolkit ${this.#expectedVersion}. After that, each session start rechecks the update record, helper definitions, global rules and depth setting, and reports only a problem.`);
    }
    return this.#check('plugin', label, STATUS.PASSED, `Claude Code runs Toolkit ${this.#expectedVersion} from the managed checkout.`);
  }

  // A recorded version newer than this install makes later session starts refuse to run.
  #updateRecord() {
    const label = 'Update record';
    let state;
    try { state = readJsonIfExists(path.join(this.#hubPath, 'state.json')); }
    catch { return this.#check('update-record', label, STATUS.ACTION, 'The Toolkit update record could not be read.', 'Run `setup toolkit` to repair it.'); }
    const recorded = state?.bridge_versions_by_source || {};
    const newer = RECORDED_SOURCES.filter((source) => /^\d+\.\d+\.\d+$/.test(String(recorded[source] || ''))
      && compareVersions(recorded[source], this.#expectedVersion) > 0);
    if (!newer.length) return this.#check('update-record', label, STATUS.PASSED, `No recorded version is newer than ${this.#expectedVersion}.`);
    const script = slash(path.join(this.#toolkitRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'));
    const versions = newer.map((source) => `${source} ${recorded[source]}`).join(', ');
    return this.#check('update-record', label, STATUS.ACTION,
      `The update record holds a newer version (${versions}) than this install (${this.#expectedVersion}), so session starts refuse to update. A newer Toolkit copy, such as a test candidate, probably ran here.`,
      `If ${this.#expectedVersion} is the version you want, clear the record once with: ${newer.map((source) => `node "${script}" --sync-enabled --write --sync-source ${source} --force-downgrade`).join(' ; ')}. Otherwise run \`setup toolkit\` to install the newer version.`);
  }

  #helperDefinitions(refresh, projectDirectories) {
    const label = 'Toolkit helpers';
    let result;
    try { result = refresh ? this.#helpers.refresh() : this.#helpers.check(); }
    catch (error) {
      return this.#check('helpers', label, STATUS.ACTION, `The Toolkit helper definitions could not be checked: ${error.message}`, 'Run `setup toolkit` again.');
    }
    const overrides = projectDirectories.length ? this.#helpers.check({ projectDirectories }) : null;
    const mismatch = overrides?.project_overrides?.find((entry) => entry.state === 'mismatch');
    if (result.status === 'held') return this.#check('helpers', label, STATUS.ACTION, `held: ${result.detail}`, result.detail);
    if (result.status === 'stale') return this.#check('helpers', label, STATUS.ACTION, 'out of date.', 'Run `setup toolkit` to refresh them.');
    if (mismatch) {
      const detail = `the project copy ${slash(mismatch.file)} does not match the selected stack. Toolkit does not change project files; update or remove it.`;
      return this.#check('helpers', label, STATUS.ACTION, `held: ${detail}`, detail);
    }
    const note = result.prune_warning ? ` ${slash(result.prune_warning)}` : '';
    if (result.status === 'updated') {
      return { ...this.#check('helpers', label, STATUS.PASSED, `updated this run (backup: ${slash(result.backup_dir)}).${note}`), updated: true };
    }
    if (result.status === 'not-installed') return this.#check('helpers', label, STATUS.PASSED, `not installed${note}`);
    return this.#check('helpers', label, STATUS.PASSED, `current${note}`);
  }

  // The Toolkit global rules block in each harness's user-level file, refreshed when stale.
  #globalRulesCheck() {
    const label = 'Global rules';
    let result;
    try { result = this.#globalRules.refresh(); }
    catch (error) {
      return this.#check('global-rules', label, STATUS.ACTION, `The Toolkit global rules could not be checked: ${error.message}`, 'Run `setup toolkit` again.');
    }
    const notes = describeGlobalRules(result).join(' ');
    if (result.status === 'held') return this.#check('global-rules', label, STATUS.ACTION, `held: ${notes}`, notes);
    // A write this run (created, added, refreshed or a hand edit restored) is recorded in the update report.
    if (result.status === 'updated') return { ...this.#check('global-rules', label, STATUS.PASSED, notes), updated: true, run: result.run_id || '' };
    return this.#check('global-rules', label, STATUS.PASSED, notes);
  }

  // The Toolkit-owned depth setting must match the selected topology.
  #depthSetting(topology) {
    const label = 'Claude Code depth setting';
    const depth = this.#depth.inspect();
    if (depth.state === DEPTH.UNREADABLE) {
      return this.#check('depth', label, STATUS.ACTION, depth.detail, 'Fix the Claude Code user settings file, then run `setup toolkit` again.');
    }
    if (topology === 'root-only') {
      if (depth.state === DEPTH.TOOLKIT || (depth.state === DEPTH.OWNER && depth.value === '1')) {
        return this.#check('depth', label, STATUS.PASSED, `${DEPTH_SETTING}=1 is set in your Claude Code user settings.`);
      }
      if (depth.state === DEPTH.OWNER) {
        return this.#check('depth', label, STATUS.ACTION,
          `Your Claude Code user settings set ${DEPTH_SETTING}=${depth.value}, which allows more nesting than root-only. Toolkit does not change a value you set.`,
          `Change ${DEPTH_SETTING} to 1 in your Claude Code user settings, or remove it and run \`setup toolkit\`.`);
      }
      return this.#check('depth', label, STATUS.ACTION, `Root-only is selected, but ${DEPTH_SETTING} is not set in your Claude Code user settings.`,
        'Run `setup toolkit` and choose root-only to set it.');
    }
    if (topology === 'broader-native' && depth.state === DEPTH.TOOLKIT) {
      return this.#check('depth', label, STATUS.ACTION, `Broader native behaviour is selected, but Toolkit's ${DEPTH_SETTING}=1 is still in your Claude Code user settings.`,
        'Run `setup toolkit` and choose broader native behaviour again.');
    }
    return this.#check('depth', label, STATUS.PASSED, 'matches the selected topology.');
  }

  // Shown only once toolkit env is in use (or an entry still uses the old ~/.codex/.env helper).
  #envCheck() {
    const label = 'Toolkit env';
    let result;
    try { result = this.#env.health(); }
    catch { return this.#check('env', label, STATUS.ACTION, 'The Toolkit env store and connected entries could not be checked.', 'Run `toolkit env status` to see why.'); }
    if (result.state === 'not-set-up' || result.state === 'skipped') return null;
    if (result.state === 'passed') return this.#check('env', label, STATUS.PASSED, result.summary);
    return this.#check('env', label, STATUS.ACTION, result.summary, result.actions.join(' '));
  }

  // plugin: setup's plugin facts, or null at session start. topology: 'root-only' |
  // 'broader-native' | null (null skips the depth check).
  run({ plugin = null, topology = null, refreshHelpers = true, projectDirectories = [] } = {}) {
    const checks = [];
    if (plugin) checks.push(this.#plugin(plugin));
    checks.push(this.#updateRecord());
    checks.push(this.#helperDefinitions(refreshHelpers, projectDirectories));
    checks.push(this.#globalRulesCheck());
    if (topology === 'root-only' || topology === 'broader-native') checks.push(this.#depthSetting(topology));
    checks.push(this.#helperRoutes());
    const env = this.#env ? this.#envCheck() : null;
    if (env) checks.push(env);
    const projectsSkill = this.#projectsSkillCheck();
    if (projectsSkill) checks.push(projectsSkill);
    const accountPlugin = this.#accountPluginCheck();
    if (accountPlugin) checks.push(accountPlugin);
    const status = checks.some((entry) => entry.status === STATUS.ACTION) ? STATUS.ACTION
      : checks.some((entry) => entry.status === STATUS.RESTART) ? STATUS.RESTART : STATUS.PASSED;
    const actions = checks.filter((entry) => entry.status !== STATUS.PASSED && entry.action).map((entry) => entry.action);
    return { status, version: this.#expectedVersion, checks, actions };
  }
}

// The topology the installed hook enforces, or null when no Claude profile was ever stored.
function storedClaudeTopology(options = {}) {
  const agentControl = require('./toolkit-agent-control.cjs');
  if (!fs.existsSync(agentControl.profilePath('claude-code', options))) return null;
  return agentControl.readProfile('claude-code', options).topology || null;
}

function main(argv = process.argv.slice(2)) {
  let hubPath = '';
  let sessionStart = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--session-start') sessionStart = true;
    else if (argv[i] === '--hub') hubPath = argv[++i] || '';
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!sessionStart) throw new Error('Usage: node repo/scripts/toolkit-install-health.cjs --session-start [--hub <path>]');
  const check = ToolkitInstallHealthCheck.forSessionStart({ hubPath });
  return check.run({ topology: storedClaudeTopology() });
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ claudeAccountPluginFolders, claudeAccountToolkitVersion, ToolkitInstallHealthCheck, STATUS, storedClaudeTopology, main });
