#!/usr/bin/env node
'use strict';

// Copies the official n8n skills (pinned exact copy under repo/contracts/third-party/n8n-io-skills/skills)
// into an app's own skills folder: Claude Code ~/.claude/skills, Codex ~/.agents/skills, and Antigravity
// ~/.gemini/config/skills when the user keeps Toolkit's skills in Antigravity (`antigravity: true`). Only skill files are copied; nothing runs.
// Toolkit records each folder it created in ~/.ai-agent-toolkit/n8n-official-skills.json and only ever
// updates or removes those. A folder of the same name that Toolkit did not create (a hand copy) is
// reported and never changed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManagedSkillCopies, copySummary } = require('./toolkit-skill-copies.cjs');

const SOURCE_REL = path.join('repo', 'contracts', 'third-party', 'n8n-io-skills', 'skills');
const LEDGER_SCHEMA = 'ai-agent-toolkit.n8n-official-skills.v1';
const HOST_TARGETS = Object.freeze({
  'claude-code': ['.claude', 'skills'],
  codex: ['.agents', 'skills']
});
const ANTIGRAVITY_TARGET = ['.gemini', 'config', 'skills'];
// Antigravity's IDE also reads this older global folder; Toolkit never writes there.
const ANTIGRAVITY_OLDER = ['.gemini', 'antigravity', 'skills'];

class OfficialN8nSkills extends ManagedSkillCopies {
  #homeDir;

  constructor({ toolkitRoot, host, homeDir = os.homedir(), controlRoot, antigravity = false } = {}) {
    if (!Object.hasOwn(HOST_TARGETS, host)) throw new Error(`Unsupported host for the n8n skills copy: ${host}`);
    super({
      sourceRoot: path.join(toolkitRoot, SOURCE_REL),
      ledgerPath: path.join(controlRoot || path.join(homeDir, '.ai-agent-toolkit'), 'n8n-official-skills.json'),
      ledgerSchema: LEDGER_SCHEMA,
      // This app's skills folder, plus Antigravity's when the user keeps Toolkit's skills there.
      targets: () => [path.join(homeDir, ...HOST_TARGETS[host]), ...(antigravity ? [path.join(homeDir, ...ANTIGRAVITY_TARGET)] : [])],
    });
    this.#homeDir = homeDir;
  }

  // Antigravity's skills folder, for removing Toolkit's n8n copies there when the user turns it off.
  antigravityTarget() { return path.join(this.#homeDir, ...ANTIGRAVITY_TARGET); }

  install() {
    return { ...super.install(), loadTwice: this.#loadTwice() };
  }

  // The user's own copies that load next to Toolkit's: an older release's name (without "-official")
  // in a folder Toolkit copies to, and either name in Antigravity's older global folder. Never touched.
  #loadTwice() {
    const folders = [...this.targets()];
    const antigravity = path.join(this.#homeDir, ...ANTIGRAVITY_TARGET);
    const older = path.join(this.#homeDir, ...ANTIGRAVITY_OLDER);
    if (folders.includes(antigravity)) folders.push(older);
    const found = new Set();
    for (const folder of folders) {
      for (const skill of this.skillNames()) {
        const oldName = skill.replace(/-official$/, '');
        const names = folder === older ? [skill, oldName] : [oldName].filter((name) => name !== skill);
        for (const name of names) if (fs.existsSync(path.join(folder, name))) found.add(path.join(folder, name));
      }
    }
    return [...found].map((dir) => `${path.basename(dir)} in ${path.relative(this.#homeDir, path.dirname(dir)).replace(/\\/g, '/')}`);
  }
}

// One line for setup's summary; names only, no private paths.
function installSummary(result) {
  const parts = copySummary(result);
  if (result.loadTwice?.length) {
    const byFolder = new Map();
    for (const entry of result.loadTwice) {
      const [name, folder] = entry.split(' in ');
      byFolder.set(folder, [...(byFolder.get(folder) || []), name]);
    }
    const listed = [...byFolder].map(([folder, names]) => `${names.join(', ')} in ~/${folder}`).join('; ');
    parts.push(`your own older copies also load (${listed}); delete them yourself so the skills do not load twice`);
  }
  return parts.join('; ') || 'nothing to copy';
}

function main(argv = process.argv.slice(2)) {
  const host = argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : 'claude-code';
  const owner = new OfficialN8nSkills({ toolkitRoot: path.resolve(__dirname, '..', '..'), host, antigravity: argv.includes('--antigravity') });
  if (argv.includes('--remove')) {
    const removed = owner.remove();
    console.log(`Removed ${removed.length} Toolkit copies of the official n8n skills.`);
    return 0;
  }
  if (argv.includes('--write')) {
    console.log(`Official n8n skills: ${installSummary(owner.install())}.`);
    return 0;
  }
  for (const row of owner.inspect()) console.log(`${row.state}\t${row.skill}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ OfficialN8nSkills, installSummary, HOST_TARGETS });
