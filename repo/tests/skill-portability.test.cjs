'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

// Every temp folder a test makes is removed after the file's tests, also when they fail.
const tempFolders = [];
test.after(() => { for (const dir of tempFolders) fs.rmSync(dir, { recursive: true, force: true }); });
function tempFolder(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempFolders.push(dir);
  return dir;
}

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');

function tempCopy() {
  const target = tempFolder('toolkit-skill-portability-');
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      if (!rel) return true;
      return !(
        rel === '.git' ||
        rel.startsWith('.git/') ||
        rel === 'node_modules' ||
        rel.startsWith('node_modules/') ||
        rel === '_dist' ||
        rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

// Without DIFF_BASE, so a base commit set for the CI run never leaks into a fixture without git.
function runAudit(cwd) {
  const { DIFF_BASE, ...env } = process.env;
  return spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8', env });
}

test('skill portability audit passes the published skill folders', () => {
  const result = runAudit(repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skill portability audit passed for \d+ skill\(s\)/);
});

test('skill portability audit catches missing README and local references', () => {
  const cwd = tempCopy();
  fs.unlinkSync(path.join(cwd, 'skills', 'windows-local-dev-services', 'README.md'));
  fs.appendFileSync(
    path.join(cwd, 'skills', 'windows-local-dev-services', 'SKILL.md'),
    '\n\nSee `references/missing.md` before using this skill.\n'
  );
  const result = runAudit(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing README\.md or INSTALL\.md/);
  assert.match(result.stderr, /references missing local file or folder: references\/missing\.md/);
});

test('skill portability audit catches thin link-only skills', () => {
  const cwd = tempCopy();
  const skillDir = path.join(cwd, 'skills', 'thin-link-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'README.md'), '# Thin link skill\n\nCopy this folder.\n');
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: thin-link-skill',
      'description: thin link test skill.',
      '---',
      '',
      '# Thin',
      '',
      'Read https://example.com/a and https://example.com/b. This is required.'
    ].join('\n')
  );
  const result = runAudit(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /extremely thin/);
  assert.match(result.stderr, /multiple external links but no local support folders/);
});

// Skill classes: repo/contracts/skill-publication.json marks each skill portable (works anywhere) or
// Toolkit's own. Portable skills must not pick up Toolkit words or name an app without a reason.
const contractRel = path.join('repo', 'contracts', 'skill-publication.json');

function readContract(rootDir = repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, contractRel), 'utf8'));
}

function filler(count) {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
}

function skillText({ name, description, body = '' }) {
  return ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, '', filler(90), '', body, ''].join('\n');
}

const defaultSkills = {
  'plain-skill': { cls: 'portable', description: 'Check a web server before a release.', body: '' },
  'own-skill': { cls: 'toolkit', description: 'Run the Toolkit controller and its G1 gate.', body: 'The controller reads the programme.' }
};

// A small workspace: two skills, the real term lists, a matching contract and README.
function classFixture({ skills = defaultSkills, edit = () => {}, readme } = {}) {
  const cwd = tempFolder('toolkit-skill-classes-');
  const real = readContract();
  const contract = {
    schema: real.schema,
    toolkit_terms: real.toolkit_terms,
    app_names: real.app_names,
    skills: {},
    baseline: []
  };
  const groups = { portable: [], toolkit: [] };
  for (const [name, skill] of Object.entries(skills)) {
    const dir = path.join(cwd, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nCopy this folder.\n`);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillText({ name, description: skill.description, body: skill.body }));
    contract.skills[name] = { class: skill.cls, reason: `Test skill ${name}.` };
    groups[skill.cls].push(`| [${name}](skills/${name}/) | Test row. |`);
  }
  edit(contract);
  fs.mkdirSync(path.join(cwd, 'repo', 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(cwd, contractRel), `${JSON.stringify(contract, null, 2)}\n`);
  const readmeText = readme || [
    '# Fixture', '', '## Skills', '',
    '| Portable skill | Use |', '|---|---|', ...groups.portable, '',
    "| Toolkit's own skill | Use |", '|---|---|', ...groups.toolkit, '',
    '## Next', ''
  ].join('\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), readmeText);
  return cwd;
}

test('skill classes: the contract holds the owner-confirmed classes for every skill folder', () => {
  const contract = readContract();
  const byClass = (cls) => Object.keys(contract.skills).filter((name) => contract.skills[name].class === cls).sort();
  assert.deepEqual(byClass('toolkit'), [
    'controller-bootstrap', 'github-program-reconciler', 'repository-agent-rules',
    'toolkit-env', 'toolkit-playbooks', 'toolkit-setup'
  ]);
  assert.equal(byClass('portable').length, 15);
  const folders = fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(Object.keys(contract.skills).sort(), folders);
  for (const entry of contract.baseline) {
    assert.equal(contract.skills[entry.skill].class, 'portable', `${entry.skill} baseline entry should be for a portable skill`);
  }
});

test('skill classes: a clean fixture passes, and a Toolkit-own skill may use Toolkit words', () => {
  const result = runAudit(classFixture());
  assert.equal(result.status, 0, result.stderr);
});

const classCases = [
  {
    name: 'a skill folder with no class fails',
    edit: (contract) => { delete contract.skills['plain-skill']; },
    error: /skills\/plain-skill has no class in repo\/contracts\/skill-publication\.json/
  },
  {
    name: 'a class for a missing skill folder fails',
    edit: (contract) => { contract.skills['gone-skill'] = { class: 'portable', reason: 'Gone.' }; },
    error: /gone-skill is classified but skills\/gone-skill does not exist/
  },
  {
    name: 'a third class fails',
    edit: (contract) => { contract.skills['plain-skill'].class = 'internal'; },
    error: /plain-skill class must be "portable" or "toolkit"/
  },
  {
    name: 'a class without a reason fails',
    edit: (contract) => { contract.skills['plain-skill'].reason = ' '; },
    error: /plain-skill needs a one-line reason/
  },
  {
    name: 'a Toolkit word in a portable description fails',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Ask the controller before a release.' } },
    error: /skills\/plain-skill is portable but uses Toolkit term "controller" 1 time\(s\); allowed 0/
  },
  {
    name: 'plural Toolkit words and words in the body count too',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Run the G1s, then the programmes.' } },
    error: /uses Toolkit term "G1" 1 time\(s\)[\s\S]*uses Toolkit term "programme" 1 time\(s\)/
  },
  {
    name: 'an app name without a reason fails',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Use when Codex checks a server.' } },
    error: /skills\/plain-skill is portable but names app "Codex" 1 time\(s\) with no depends_on_app reason; allowed 0/
  },
  {
    name: 'a depends_on_app entry without a reason fails',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Use when Codex checks a server.' } },
    edit: (contract) => { contract.skills['plain-skill'].depends_on_app = { Codex: '' }; },
    error: /plain-skill depends_on_app "Codex" needs a reason/
  },
  {
    name: 'a depends_on_app entry for an unlisted app fails',
    edit: (contract) => { contract.skills['plain-skill'].depends_on_app = { Notepad: 'Edits text.' }; },
    error: /plain-skill depends_on_app "Notepad" is not one of app_names/
  },
  {
    name: 'a baseline count one below the hits fails',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Toolkit and Toolkit again.' } },
    edit: (contract) => { contract.baseline.push({ skill: 'plain-skill', term: 'Toolkit', count: 1 }); },
    error: /uses Toolkit term "Toolkit" 2 time\(s\); allowed 1/
  },
  {
    name: 'a baseline count above the hits fails so the baseline only shrinks',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Toolkit once.' } },
    edit: (contract) => { contract.baseline.push({ skill: 'plain-skill', term: 'Toolkit', count: 2 }); },
    error: /baseline allows "Toolkit" 2 time\(s\) in plain-skill but it now appears 1 time\(s\); lower the count to 1/
  },
  {
    name: 'a baseline entry with no hits left fails',
    edit: (contract) => { contract.baseline.push({ skill: 'plain-skill', term: 'Toolkit', count: 1 }); },
    error: /baseline allows "Toolkit" 1 time\(s\) in plain-skill but it now appears 0 time\(s\); remove the entry/
  },
  {
    name: 'an empty Toolkit term list fails instead of turning the check off',
    edit: (contract) => { contract.toolkit_terms = []; },
    error: /toolkit_terms must be a non-empty list of words/
  },
  {
    name: 'a missing app list fails instead of turning the check off',
    edit: (contract) => { delete contract.app_names; },
    error: /app_names must be a non-empty list of words/
  },
  {
    name: 'a skill entry that is not an object fails',
    edit: (contract) => { contract.skills['plain-skill'] = null; },
    error: /plain-skill entry must be an object with class and reason/
  },
  {
    name: 'a baseline count that is not a positive whole number fails',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Toolkit once.' } },
    edit: (contract) => { contract.baseline.push({ skill: 'plain-skill', term: 'Toolkit', count: '1' }); },
    error: /baseline entry "Toolkit" for plain-skill needs a whole-number count above 0/
  },
  {
    name: 'a baseline that is not a list fails',
    edit: (contract) => { contract.baseline = { 'plain-skill': 1 }; },
    error: /baseline must be a list/
  },
  {
    name: 'a repeated baseline entry fails',
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Toolkit once.' } },
    edit: (contract) => { contract.baseline.push({ skill: 'plain-skill', term: 'Toolkit', count: 1 }, { skill: 'plain-skill', term: 'Toolkit', count: 1 }); },
    error: /baseline lists "Toolkit" for plain-skill more than once/
  },
  {
    name: 'a baseline entry for a Toolkit-own skill fails',
    edit: (contract) => { contract.baseline.push({ skill: 'own-skill', term: 'controller', count: 2 }); },
    error: /baseline entry for own-skill must name a portable skill/
  },
  {
    name: 'a baseline entry for an unlisted word fails',
    edit: (contract) => { contract.baseline.push({ skill: 'plain-skill', term: 'server', count: 1 }); },
    error: /baseline entry "server" for plain-skill is not one of toolkit_terms or app_names/
  },
  {
    name: 'a portable skill listed in the Toolkit\'s own table in the README fails',
    readme: [
      '## Skills', '', '| Portable skill | Use |', '|---|---|', '',
      "| Toolkit's own skill | Use |", '|---|---|', '| [plain-skill](skills/plain-skill/) | Row. |', '| [own-skill](skills/own-skill/) | Row. |', '', '## Next', ''
    ].join('\n'),
    error: /README\.md lists skills\/plain-skill in the "Toolkit's own skill" table but its class is portable/
  },
  {
    name: 'a README missing a skill row fails',
    readme: ['## Skills', '', '| Portable skill | Use |', '|---|---|', '', "| Toolkit's own skill | Use |", '|---|---|', '| [own-skill](skills/own-skill/) | Row. |', '', '## Next', ''].join('\n'),
    error: /README\.md does not list skills\/plain-skill in the "Portable skill" table/
  }
];

for (const testCase of classCases) {
  test(`skill classes: ${testCase.name}`, () => {
    const result = runAudit(classFixture(testCase));
    assert.notEqual(result.status, 0, 'audit should fail');
    assert.match(result.stderr, testCase.error);
  });
}

test('skill classes: an app name with a depends_on_app reason passes', () => {
  const cwd = classFixture({
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Configure Codex profiles for a team.' } },
    edit: (contract) => { contract.skills['plain-skill'].depends_on_app = { Codex: 'It edits that app\'s own profile file.' }; }
  });
  const result = runAudit(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('skill classes: words inside fenced code are not counted', () => {
  const cwd = classFixture({
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: '```text\nnode toolkit-controller.cjs --g1\n```' } }
  });
  const result = runAudit(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('skill classes: a multi-word Toolkit term split by a line wrap still counts', () => {
  const result = runAudit(classFixture({
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Follow the coding\ngate before release.' } }
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uses Toolkit term "coding gate" 1 time\(s\)/);
});

test('skill classes: an inline triple-backtick span in prose still counts, and tilde fences are skipped', () => {
  const result = runAudit(classFixture({
    skills: {
      ...defaultSkills,
      'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Ask the ```controller``` first.\n\n~~~text\nG1 G2 programme\n~~~' }
    }
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uses Toolkit term "controller" 1 time\(s\)/);
  assert.doesNotMatch(result.stderr, /"G1"|"G2"|"programme"/);
});

test('skill classes: a classified portable folder without SKILL.md reports it instead of crashing', () => {
  const cwd = classFixture();
  fs.unlinkSync(path.join(cwd, 'skills', 'plain-skill', 'SKILL.md'));
  const result = runAudit(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skills\/plain-skill missing SKILL\.md/);
  assert.doesNotMatch(result.stderr, /ENOENT|\n\s+at /);
});

// The baseline only shrinks against the change's base commit (DIFF_BASE in CI, else where HEAD left
// origin/main): raising a count or adding an entry in the same change as a new mention fails.
function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function baselineRepo(baseCount) {
  const cwd = classFixture({
    skills: { ...defaultSkills, 'plain-skill': { cls: 'portable', description: 'Check a server.', body: 'Toolkit once.' } },
    edit: (contract) => { if (baseCount) contract.baseline.push({ skill: 'plain-skill', term: 'Toolkit', count: baseCount }); }
  });
  git(cwd, ['init', '-q']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  return { cwd, base: git(cwd, ['rev-parse', 'HEAD']) };
}

function setMentions(cwd, count, baselineCount) {
  const skillPath = path.join(cwd, 'skills', 'plain-skill', 'SKILL.md');
  const text = fs.readFileSync(skillPath, 'utf8').replace('Toolkit once.', Array(count).fill('Toolkit').join(' and '));
  fs.writeFileSync(skillPath, text);
  const contractPath = path.join(cwd, contractRel);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.baseline = [{ skill: 'plain-skill', term: 'Toolkit', count: baselineCount }];
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
}

function runAuditAgainst(cwd, base) {
  return spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8', env: { ...process.env, DIFF_BASE: base } });
}

test('skill classes: raising a baseline count over the base commit fails', () => {
  const { cwd, base } = baselineRepo(1);
  setMentions(cwd, 2, 2);
  const result = runAuditAgainst(cwd, base);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline for "Toolkit" in plain-skill rose from 1 to 2 since the base commit; the baseline only shrinks/);
});

test('skill classes: adding a baseline entry the base commit did not have fails', () => {
  const { cwd, base } = baselineRepo(0);
  setMentions(cwd, 1, 1);
  const result = runAuditAgainst(cwd, base);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline for "Toolkit" in plain-skill rose from 0 to 1 since the base commit/);
});

test('skill classes: lowering a baseline count against the base commit passes', () => {
  const { cwd, base } = baselineRepo(1);
  const skillPath = path.join(cwd, 'skills', 'plain-skill', 'SKILL.md');
  fs.writeFileSync(skillPath, fs.readFileSync(skillPath, 'utf8').replace('Toolkit once.', 'Once.'));
  const contractPath = path.join(cwd, contractRel);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.baseline = [];
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const result = runAuditAgainst(cwd, base);
  assert.equal(result.status, 0, result.stderr);
});

test('skill classes: a DIFF_BASE that is not a commit fails', () => {
  const { cwd } = baselineRepo(1);
  const result = runAuditAgainst(cwd, 'not-a-commit');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DIFF_BASE not-a-commit is not a commit in this checkout/);
});

// Plug and play serves the governed rules and the playbooks from the installed Toolkit, so a skill
// that still names the old in-repository copy as a live source sends an agent looking for a block
// or folder that is gone. Sentences that call those copies leftovers are allowed.
test('no skill file names an old in-repository Toolkit copy as a live source', () => {
  const stale = [
    /managed `AGENTS\.md`/,
    /Toolkit block in `AGENTS\.md`/,
    /governed block's/,
    /(?<![\w/.-])docs\/agent-playbooks\//
  ];
  const leftover = /leftover|older setup|old cop/i;
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (stale.some((pattern) => pattern.test(line)) && !leftover.test(line)) {
          hits.push(`${path.relative(repoRoot, full).replace(/\\/g, '/')}:${index + 1}`);
        }
      });
    }
  };
  walk(path.join(repoRoot, 'skills'));
  assert.deepEqual(hits, []);
});
