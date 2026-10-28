'use strict';

// Continuation evidence: the private evidence projection, ordered atoms, reader models, binding and
// construction closures, and the source sentinel transforms.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ContinuationResolver, LIMITS, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const matrix = require('./support/governance-continuation-matrix.json');
const { dataClass, evidenceProjection, expectedFor, fixture, message, root, sentinelText, shell, snapshot } = require('./support/governance-continuation-fixture.cjs');

test('complete data proofs retain consumed spans and unknown wrappers retain raw executable evidence', t => {
  const { commandRoles, roleWords, roleVisits } = evidenceProjection();
  for (const row of matrix.literal_role_cases) {
    const input = { tool_input: { ...(row.shell === undefined ? {} : { shell: row.shell }) } };
    const result = commandRoles(row.text, input);
    assert.equal(Boolean(result.data), row.proof, row.id);
    if (result.data) {
      assert.equal(result.data.consumed, row.text.trimEnd().length, row.id);
      for (const word of result.data.roles) {
        assert.ok(word.end > word.start && word.start >= 0 && word.end <= row.text.length);
        assert.ok(row.text.slice(word.start, word.end).includes(word.quote || word.value));
      }
      for (const word of result.data.inner?.roles || result.data.roles) assert.ok(word.role, row.id + ': every word has a role');
    }
    if (row.mask) {
      assert.ok(result.segments?.proofs.length, row.id + ': complete reader segment proof');
      assert.equal(result.candidate.length, row.text.length);
      const dataSpans = result.segments.proofs.flatMap(proof => proof.roles.filter(word => word.role.startsWith('literal ') || word.role === 'attached literal pattern' || (word.role === 'reader executable' && /[\\/]/.test(word.value))));
      if (result.excludedExecutable) dataSpans.push(result.excludedExecutable);
      for (let i = 0; i < row.text.length; i += 1) {
        if (result.candidate[i] !== row.text[i]) {
          assert.equal(result.candidate[i], ' ');
          assert.ok(dataSpans.some(span => i >= span.start && i < span.end), 'only proved data/executable spans excluded');
        }
      }
      for (const segment of result.segments.unproved) assert.ok(result.candidate.includes(segment), 'all unproved source retained');
    }
    if (row.noMask) assert.equal(result.candidate, row.text, row.id + ': unsupported list has no mask');
    if (['wrapper/unknown-flag', 'wrapper/encoded', 'wrapper/file', 'wrapper/config'].includes(row.id)) assert.equal(result.candidate, row.text, row.id + ': no path masking');
    if (row.id.startsWith('wrapper/runtime/')) {
      const span = roleWords(row.text)[1];
      assert.equal(result.candidate.length, row.text.length);
      assert.equal(result.candidate.slice(span.start, span.end), ' '.repeat(span.end - span.start));
      assert.equal(result.candidate.slice(span.end), row.text.slice(span.end), 'all options and script bytes retained');
    }
  }
  const shells = [undefined, 'cmd.exe', 'powershell.exe', 'bash', 'C:/example.test/codex-runtimes/pwsh.exe'];
  let count = 0;
  for (const selected of shells) for (const native of ['codex', 'claude', 'resume', 'fork']) {
    for (const file of [`repo/${native}/notes.txt`, `repo\\${native}\\notes.txt`, `C:/example.test/${native}/notes.txt`, `C:\\example.test\\${native}\\notes.txt`, `//server.example.test/share/${native}/notes.txt`]) {
      for (const quote of ['', '"']) for (const prefix of ['rg -n -e "codex resume"', 'rg --regexp=claude --regexp=resume --']) {
        const text = prefix + ' ' + quote + file + quote;
        const input = { tool_input: { ...(selected === undefined ? {} : { shell: selected }) } };
        assert.ok(commandRoles(text, input).data, text);
        assert.equal(parse(text, input).status, 'NOT_CONTINUATION', text); count += 1;
      }
    }
  }
  for (const ending of ['\\', '\\"', '\\ ', '\\&', '\\$', '\\`']) {
    const text = 'rg -e "codex resume" repo' + ending;
    assert.equal(commandRoles(text, { tool_input: {} }).data, null, 'ambiguous escape has no proof');
  }
  for (const flag of ['--pre', '--hostname-bin', '--unknown', '-ni', '-ecodex']) {
    assert.equal(commandRoles('rg ' + flag + ' "codex resume" fixture.txt', { tool_input: {} }).data, null);
  }
  for (const name of ['-n', '--line-number', '-i', '--ignore-case', '-F', '--fixed-strings', '-l', '--files-with-matches', '--hidden', '--no-ignore', '--no-config', '--help']) {
    assert.ok(commandRoles('rg ' + name + ' -e "codex resume" fixture.txt', { tool_input: {} }).data, name);
  }
  for (const text of ['rg -e "codex resume" ' + 'x'.repeat(LIMITS.command), 'pwsh -Command "' + 'x'.repeat(LIMITS.command) + '"']) {
    assert.equal(commandRoles(text, { tool_input: {} }).data, null, 'no over-limit proof or truncation');
  }
  for (const prefix of ['rg -e "codex resume" ', 'rg -e "', 'pwsh -Command "', 'rg ']) {
    const text = (prefix + 'x'.repeat(LIMITS.command)).slice(0, LIMITS.command - 1) + (prefix.endsWith('"') ? '"' : 'x');
    const before = roleVisits(); commandRoles(text, { tool_input: {} });
    assert.ok(roleVisits() - before <= 4 * text.length, 'bounded single-layer lexical acquisition');
  }
  const wrapperPrefix = 'pwsh -Command "git status; rg -e codex ';
  const composed = wrapperPrefix + 'x'.repeat(LIMITS.command - wrapperPrefix.length - 1) + '"';
  const beforeComposed = roleVisits(), composedRoles = commandRoles(composed, { tool_input: {} });
  assert.ok(composedRoles.segments?.proofs.length);
  assert.equal(composedRoles.candidate.length, composed.length);
  assert.ok(roleVisits() - beforeComposed <= 4 * composed.length, 'bounded composed lexical acquisition');
  assert.equal(parse(composed, { tool_input: {} }).status, 'NOT_CONTINUATION');
  for (const { word } of evidenceProjection().CANDIDATE_MACHINES) for (let cut = 1; cut < word.length; cut += 1) {
    for (const body of [`& ('${word.slice(0, cut)}'.ToString()+'${word.slice(cut)}')`, `& (' ${word.slice(0, cut)}'.Trim()+'${word.slice(cut)}')`, `& ('${word.slice(0, cut)}{0}' -f '${word.slice(cut)}')`]) {
      for (const prefix of ['pwsh', '"C:/example.test/codex-runtimes/pwsh.exe"']) {
        const text = prefix + ' -Command "' + body + '"';
        assert.equal(parse(text, { tool_input: {} }).status, 'UNKNOWN', 'quoted script role retains every fixed spelling split');
      }
    }
  }
  t.diagnostic(JSON.stringify({ pathRoleProperties: count, wrapperLayers: 1, nativeAdmissionGrammarChanged: false }));
});

test('ordered evidence retains every partition and arbitrary prefix state under inserted atoms', t => {
  const { CANDIDATE_MACHINES, atomPattern, advancePrefixes } = evidenceProjection();
  assert.equal(CANDIDATE_MACHINES.length, 18);
  assert.ok(Object.isFrozen(CANDIDATE_MACHINES));
  const noise = ['z', 'noise', 'co', 're', '--last', '', ' q '].map(atomPattern);
  let partitions = 0, insertions = 0, whitespace = 0, arbitrary = 0;
  for (const machine of CANDIDATE_MACHINES) {
    assert.ok(Object.isFrozen(machine)); assert.ok(Object.isFrozen(machine.characters));
    const word = machine.word;
    for (let cuts = 0; cuts < 2 ** (word.length - 1); cuts += 1) {
      const pieces = []; let last = 0;
      for (let p = 1; p < word.length; p += 1) if (cuts & (1 << (p - 1))) { pieces.push(word.slice(last, p)); last = p; }
      pieces.push(word.slice(last));
      const patterns = pieces.map(atomPattern); let states = 1;
      for (let slot = 0; slot <= patterns.length; slot += 1) {
        for (const atom of noise) {
          const withNoise = advancePrefixes(machine, states, atom);
          assert.equal(withNoise & states, states);
          let final = withNoise;
          for (let p = slot; p < patterns.length; p += 1) final = advancePrefixes(machine, final, patterns[p]);
          assert.ok(final & machine.end); insertions += 1;
        }
        if (slot < patterns.length) states = advancePrefixes(machine, states, patterns[slot]);
      }
      assert.ok(states & machine.end); partitions += 1;
      for (const edge of [' ', '  ', '\t', '\r\n']) {
        let padded = 1;
        for (const piece of pieces) padded = advancePrefixes(machine, padded, atomPattern(edge + piece + edge));
        assert.ok(padded & machine.end); whitespace += 1;
      }
    }
    for (let states = 1; states <= machine.full; states += 2) for (const atom of noise) {
      assert.equal(advancePrefixes(machine, states, atom) & states, states); arbitrary += 1;
    }
  }
  assert.equal(partitions, 63448); assert.equal(insertions, 3874724); assert.equal(whitespace, 253792);
  assert.equal(arbitrary, CANDIDATE_MACHINES.reduce((sum, machine) => sum + machine.end * noise.length, 0));
  t.diagnostic(JSON.stringify({ partitions, insertions, whitespace, arbitrary }));
});

test('whole atoms, fixed-letter holes and overlapping quote extraction keep finite boundaries', () => {
  const api = evidenceProjection();
  const { CANDIDATE_MACHINES, atomPattern, advancePrefixes, quoteAtoms, orderedEvidence } = api;
  for (const machine of CANDIDATE_MACHINES) {
    const word = machine.word;
    for (let hole = 0; hole <= word.length; hole += 1) {
      for (const template of [word.slice(0, hole) + '{0}' + word.slice(hole), word.slice(0, hole) + '{0}{1,2:x}' + word.slice(hole)]) {
        assert.ok(advancePrefixes(machine, 1, atomPattern(template)) & machine.end);
      }
    }
    for (let split = 1; split < word.length; split += 1) for (const quote of ['"', "'"]) for (const edge of ['', ' ', '\t', '\r\n']) {
      const left = quote + edge + word.slice(0, split).toUpperCase() + edge + quote;
      const right = quote + edge + word.slice(split) + edge + quote;
      for (const body of [left + '+' + right, '[string]' + left + '+' + right, left + '+[System.String]' + right,
        left + '.ToString()+' + right, left + '.Replace(' + quote + 'z' + quote + ',' + quote + quote + ')+' + right,
        left + '.Replace(' + quote + 'noise' + quote + ',' + quote + 'co' + quote + ')+' + right,
        '[string]::Concat(' + left + ',' + right + ')', '-join (' + left + ',' + right + ')']) {
        for (const outer of ['', '"', "'"]) {
          const text = 'powershell -Command (' + outer + '(' + body + ')' + outer + ')';
          assert.equal(orderedEvidence(text), true, text);
          assert.equal(parse(text, { cwd: root, tool_input: {} }).status, 'UNKNOWN', text);
        }
      }
    }
  }
  for (const atoms of [['cxdex'], ['rcsume'], ['scooter'], ['rescue'], ['co noise','dex'], ['{0}'], ['fixture {0}'], ['x{0}'], ['{0}q'], ['fixture','world'], ['c','q','d','e','x'], ['-c'], ['-r'], ['{0}','dex']]) {
    assert.equal(orderedEvidence(atoms.map(atom => '"' + atom + '"').join('+')), false, JSON.stringify(atoms));
  }
  assert.equal(orderedEvidence('("c{0}d" -f "o" + "ex")'), true);
  assert.equal(orderedEvidence('("r{0}s" -f "e" + "ume")'), true);
  assert.equal(orderedEvidence('"co"+"dex"'), true);
  assert.equal(orderedEvidence('"fixture"'), false, 'fresh per-call prefix states');
  for (const text of ['"q".'.repeat(8192), '"' + 'q'.repeat(32766) + '"', '"' + '{0}'.repeat(10920) + '"', "'\"".repeat(16384), '"co"+' + '"z"+'.repeat(8192) + '"dex"', '"' + '{' + '1'.repeat(32768), '"' + ' \t'.repeat(8192) + 'q"']) {
    const spans = quoteAtoms(text);
    assert.ok(spans.length <= text.length);
    assert.ok(spans.reduce((n, raw) => n + raw.length, 0) <= 2 * text.length);
    const before = api.operations(); orderedEvidence(text);
    assert.ok(api.operations() - before <= spans.length * 18 * 31);
    for (const raw of spans) {
      const pattern = atomPattern(raw);
      if (pattern) { assert.ok(pattern.literals <= 15); assert.ok(pattern.steps.length <= 31); }
    }
  }
  assert.equal(parse('& ("co"+"dex") ' + 'x'.repeat(LIMITS.command), { tool_input: {} }).status, 'UNKNOWN');
  assert.equal(parse('echo ' + 'x'.repeat(LIMITS.command), { tool_input: {} }).status, 'NOT_CONTINUATION');
});

test('ordered-atom closure table is UNKNOWN before target proof across placements, metadata and aliases', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const shells = [undefined, 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash', '/bin/sh', 'C:\\synthetic shell\\pwsh.exe', 'unknown-shell', '', null, ['cmd.exe']];
  for (const row of matrix.ordered_atom_cases) for (const tool_name of ['Bash', 'PowerShell']) for (const selected of shells) {
    const text = row.text.replaceAll('{TRANSCRIPT}', ctx.file).replaceAll('{TARGET}', ctx.target);
    const input = shell(ctx, text, { tool_name });
    if (selected !== undefined) input.tool_input.shell = selected;
    assert.equal(parse(text, input).status, row.expected, row.id + '/' + selected);
    const reader = new ContinuationResolver({ environment: ctx.environment, spawn() { assert.fail('computed evidence cannot acquire target metadata'); } });
    assert.equal(reader.resolve(text, input).status, row.expected, row.id);
    for (const args of [{ command: text }, { cmd: text }, { command: text.split(' ') }]) {
      const decision = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide({ ...input, tool_input: { ...args, ...(selected === undefined ? {} : { shell: selected }) } });
      assert.equal(Boolean(decision?.deny), row.expected === 'UNKNOWN', row.id + '/alias');
    }
  }
  // A queue read trap proves the dependency boundary, independently of native source proof.
  const stateReader = () => ({ state: 'DISABLED', rule: 'R1' });
  const originalRead = fs.readFileSync; let queueReads = 0;
  const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
  fs.readFileSync = (file, ...args) => { if (file === heldFile) queueReads += 1; return originalRead(file, ...args); };
  try {
    assert.equal(new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide(shell(ctx, 'codex exec resume --last')), null);
    assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide(shell(ctx, matrix.ordered_atom_cases[0].text))?.deny);
    for (const id of ['original-read', 'sqag/single/absent', 'sqag/compound/absent', 'wrapper/runtime/assignment', 'wrapper/runtime/concat', 'composition/runtime/absent', 'composition/runtime/native-after', 'composition/runtime/computed-after']) {
      const row = matrix.literal_role_cases.find(row => row.id === id);
      const input = { ...shell(ctx, row.text), tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } };
      assert.equal(Boolean(new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide(input)?.deny), expectedFor(row, input) === 'UNKNOWN', id);
    }
  } finally { fs.readFileSync = originalRead; }
  assert.equal(queueReads, 0, 'no held-queue read on verified or computed paths');
  assert.deepEqual(snapshot(ctx.dir), before);
});

test('multiline pipeline reader model keeps literal data separate from all executable source', t => {
  const ctx = fixture(t), api = evidenceProjection(), before = snapshot(ctx.dir);
  const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
  const originalRead = fs.readFileSync; let queueReads = 0;
  fs.readFileSync = (file, ...args) => { if (file === heldFile) queueReads += 1; return originalRead(file, ...args); };
  t.after(() => { fs.readFileSync = originalRead; });
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' };
  let positive = 0;
  for (const row of matrix.script_reader_cases) {
    const input = shell(ctx, row.text);
    if (Object.hasOwn(row, 'shell')) input.tool_input.shell = row.shell;
    const expected = expectedFor(row, input);
    assert.equal(parse(row.text, input).status, expected, row.id);
    const roles = api.commandRoles(row.text, input);
    if (roles.segments) {
      assert.equal(roles.candidate.length, row.text.length, row.id);
      const spans = roles.segments.proofs.flatMap(proof => proof.roles.filter(word => word.role.startsWith('literal ')
        || word.role === 'attached literal pattern' || (word.role === 'reader executable' && /[\\/]/.test(word.value))));
      if (roles.excludedExecutable) spans.push(roles.excludedExecutable);
      for (let i = 0; i < row.text.length; i += 1) if (roles.candidate[i] !== row.text[i]) {
        assert.equal(roles.candidate[i], ' ', row.id + ': equal-length mask');
        assert.ok(spans.some(span => i >= span.start && i < span.end), row.id + ': only consumed roles masked');
      }
      for (const separator of roles.segments.separators || []) {
        assert.equal(roles.candidate.slice(separator.start, separator.end), row.text.slice(separator.start, separator.end), row.id + ': exact separator offsets');
      }
      for (const proof of roles.segments.proofs) for (const word of proof.roles) {
        assert.ok(word.start >= proof.start && word.end <= proof.end && word.end > word.start, row.id + ': exact source extent');
        assert.ok(row.text.slice(word.start, word.end).includes(word.quote || word.value), row.id + ': original word bytes');
      }
      for (const text of roles.segments.unproved) assert.ok(roles.candidate.includes(text), row.id + ': unproved code retained');
    }
    if (['unknown-option', 'trailing-pipe', 'empty-semi', 'bare-cr', 'comment', 'here-string', 'doubled-quote'].includes(row.id)
      || row.id.startsWith('bad-shell/')) assert.equal(roles.candidate, row.text, row.id + ': no unsupported projection');
    for (const actor of matrix.actors) {
      const decide = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader }).decide({ ...input, actor });
      assert.equal(Boolean(decide(() => ({ state: 'DISABLED', rule: 'R1' }))?.deny), expected === 'UNKNOWN', row.id + '/' + actor);
      if (expected !== 'NOT_CONTINUATION') continue;
      positive += 1;
      const ordinary = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) });
      assert.match(ordinary.decide({ ...input, actor, tool_input: { ...input.tool_input, command: row.text + '\nnode toolkit-governance.cjs enable' } })?.deny || '', /only the user/, row.id + ': raw owner-answer guard');
      assert.match(ordinary.decide({ ...input, actor, tool_name: 'Write', tool_input: { command: row.text, file_path: ctx.options.registryPath } })?.deny || '', /user-state files/, row.id + ': user-state edit guard');
      const reached = new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other || cwd.startsWith(ctx.other + path.sep) ? held : { state: 'DISABLED', rule: 'R1' } });
      assert.ok(reached.decide({ ...input, actor, tool_input: { ...input.tool_input, command: row.text + '\nGet-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } })?.deny, row.id + ': raw known absolute-path guard');
      assert.ok(decide(() => held)?.deny, row.id + ': current guard');
      assert.ok(decide(() => ({ state: 'UNDECIDED', rule: 'ERROR', error_code: 'SYNTHETIC' }))?.deny, row.id + ': unreadable current guard');
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other ? held : { state: 'DISABLED', rule: 'R1' } })
        .decide({ ...input, actor, tool_input: { ...input.tool_input, workdir: ctx.other } })?.deny, row.id + ': workdir guard');
    }
  }
  const legacy = matrix.literal_role_cases.find(row => row.id === 'segments/pipeline');
  assert.equal(legacy.baseline_expected, 'UNKNOWN'); assert.ok(legacy.allowance);
  for (const text of [
    'Get-Content -Unknown "codex resume" | git status',
    legacy.text + '; codex resume --last', legacy.text + '; claude --continue',
  ]) assert.equal(parse(text, { tool_input: { shell: 'powershell.exe' } }).status, 'UNKNOWN', 'historical pipeline unsafe siblings');
  // A variable in a file path is data to Get-Content, and git status reads no pipe input.
  assert.equal(parse('Get-Content -LiteralPath "$codex/resume" | git status', { tool_input: { shell: 'powershell.exe' } }).status, 'NOT_CONTINUATION');
  assert.equal(queueReads, 0, 'role proof and all actor decisions never read the held queue');
  fs.readFileSync = originalRead;
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ modelRows: matrix.script_reader_cases.length, positiveActorChecks: positive, zeroQueueReads: true }));
});

test('acquisition schema and structural reader resources stay within the closed lexical subset', () => {
  const api = evidenceProjection(), input = { tool_input: { shell: 'powershell.exe' } };
  const branch = 'gh run list --branch codex/resume';
  const fields = ['attempt', 'conclusion', 'createdAt', 'databaseId', 'displayTitle', 'event', 'headBranch', 'headSha',
    'name', 'number', 'startedAt', 'status', 'updatedAt', 'url', 'workflowDatabaseId', 'workflowName'];
  for (const tail of ['', ' --repo example-org/example-repo', ' --repo github.example.test/example-org/example-repo',
    ' --commit ' + 'a'.repeat(40), ' --limit 8', ...fields.map(field => ' --json ' + field), ' --json ' + fields.join(',')]) {
    const text = branch + tail;
    assert.equal(parse(text, input).status, 'NOT_CONTINUATION', tail);
    const proof = api.commandRoles(text, input).segments.proofs[0];
    assert.equal(proof.consumed, text.length);
    assert.equal(proof.schema, 'gh run list literal filters');
  }
  for (const tail of [' --unknown value', ' -R example-org/example-repo', ' --repo=example-org/example-repo',
    ' --repo', ' --limit', ' --json', ' --commit bad', ' --commit ' + 'a'.repeat(39), ' --limit 1+1',
    ' --json status,', ' --json ,status', ' --json status,,headSha', ' --json Status', ' --json codex,resume',
    ' --jq .status', ' --template "codex resume"', ' --branch other', ' --repo example-org', ' --repo github.example.test/example-org/example-repo/extra',
    ...['--repo example-org/example-repo', '--commit ' + 'a'.repeat(40), '--limit 8', '--json status'].map(option => ' ' + option + ' ' + option)]) {
    const text = branch + tail;
    assert.equal(parse(text, input).status, 'UNKNOWN', tail);
    assert.equal(api.commandRoles(text, input).candidate, text, 'whole malformed acquisition stage is retained');
  }
  for (const text of ['gh run list --branch --codex', 'gh run list --branch -codex/resume',
    'gh run list --branch=codex/example-branch', 'gh run list -b codex/example-branch',
    'gh run watch --branch codex/example-branch', 'gh workflow list --branch codex/example-branch',
    'gh "run" list --branch codex/example-branch', 'gh run "list" --branch codex/example-branch']) {
    assert.equal(api.commandRoles(text, input).candidate, text, 'no alias, option-like value or alternate command proof');
  }
  for (const text of ['rg --regexp="codex resume" fixture.txt | ConvertFrom-Json', 'findstr /c:"codex resume" fixture.txt | ConvertFrom-Json']) {
    const roles = api.commandRoles(text, input);
    assert.equal(parse(text, input).status, 'NOT_CONTINUATION');
    assert.ok(roles.candidate.includes(text.startsWith('rg') ? '--regexp=' : '/c:'), 'attached option prefix retained');
  }
  const reader = 'Get-Content -LiteralPath C:/example.test/.codex/notes.md';
  for (const shape of hostile.cases(['line-breaks', 'continued-lines', 'quoting', 'indents', 'invisible', 'large-input'], ['shell', 'text'])) {
    const text = reader + '\n' + shape.text + '\ncodex resume --last';
    assert.equal(parse(text, input).status, 'UNKNOWN', shape.id);
  }
  for (const text of [reader + '\n' + '('.repeat(12000) + 'codex resume' + ')'.repeat(12000),
    (reader + '\n').repeat(500), reader + '\n' + ' '.repeat(LIMITS.command),
    (reader + '\n').repeat(500) + 'claude --continue']) {
    const roles = api.commandRoles(text, input);
    assert.equal(roles.candidate.length, text.length, 'no truncation or recursive stack growth');
    if (text.length > LIMITS.command) assert.equal(roles.candidate, text, 'over-limit source receives no projection');
    if (text.includes('codex resume') || text.includes('claude --continue')) assert.equal(parse(text, input).status, 'UNKNOWN');
  }
  assert.equal(api.roleWords('rg -e codex status,headSha'), null, 'comma belongs only to acquisition JSON fields');
});

// These anonymous equivalents exercise evidence roles only; no payload is dispatched.
test('evidence boundary model proves only owned binding separators and complete Git operands', t => {
  const model = matrix.evidence_boundary_model, api = evidenceProjection();
  const input = selected => ({ tool_input: selected === null ? {} : { shell: selected } });
  let rows = 0, masks = 0;
  function check(id, text, expected, selected) {
    const envelope = input(selected), roles = api.commandRoles(text, envelope);
    assert.equal(parse(text, envelope).status, expected, id + '/' + selected); rows += 1;
    if (!roles.segments) return;
    const spans = [...roles.segments.spans, ...(roles.excludedExecutable ? [roles.excludedExecutable] : [])].sort((a, b) => a.start - b.start);
    let at = 0;
    for (const span of spans) {
      assert.ok(span.start >= at && span.end <= text.length, id + ': non-overlapping original offsets');
      assert.equal(roles.candidate.slice(at, span.start), text.slice(at, span.start), id + ': executable bytes retained');
      assert.equal(roles.candidate.slice(span.start, span.end), ' '.repeat(span.end - span.start));
      at = span.end; masks += 1;
    }
    assert.equal(roles.candidate.slice(at), text.slice(at));
    assert.equal(roles.candidate.length, text.length);
    for (const unproved of roles.segments.unproved) assert.ok(roles.candidate.includes(unproved));
    for (const proof of roles.segments.proofs) {
      assert.equal(proof.consumed, text.slice(proof.start, proof.end).trimEnd().length, id + ': complete stage consumption');
      for (const role of proof.roles) assert.ok(role.role);
    }
  }
  for (const [id, text, expected] of model.foreign_ingress_cases) for (const [n, selected] of model.shells.entries()) {
    check('foreign/' + id, text, expected[n], selected);
  }
  for (const operation of model.native) for (const selected of model.shells) {
    const body = "@'\nfor key in items:\n    pass\n'@ | python -";
    for (const text of [operation + '; ' + body, body + '; ' + operation, body + ' | ' + operation,
      "@'\nfor key in items:\n    pass\n" + operation + "\n'@ | python -",
      "@'\nimport subprocess\nsubprocess.run([\"codex\",\"resume\"])\n'@ | python -",
      "pwsh -Command '" + operation + "'"]) check('executable-neighbour', text, 'UNKNOWN', selected);
  }
  for (const [id, command] of model.git) for (const selected of model.shells) {
    for (const text of [command, 'git status --short\n' + command,
      'git status --short; ' + command + '; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', command + ' | ConvertTo-Json']) {
      check('git/' + id, text, 'NOT_CONTINUATION', selected);
    }
    for (const text of ['codex resume --last; ' + command, command + '; claude --resume fixture',
      command + ' | codex resume --last', command.replace('codex/example', '$(codex resume)') + '; & ("co"+"dex") ("res"+"ume")']) {
      check('git-executable/' + id, text, 'UNKNOWN', selected);
    }
  }
  for (const [n, command] of model.unsupported.entries()) for (const selected of model.shells) {
    assert.equal(api.commandRoles(command, input(selected)).segments, null, 'no partial proof for unsupported schema');
    // An unsupported form without candidate evidence retains the ordinary boundary.
    // Here the reader has no partial proof, but a complete data-argument proof may still hold.
    const data = model.unsupported_data[n]?.includes(dataClass(input(selected)));
    check('unsupported/' + n, command, n === 8 || data ? 'NOT_CONTINUATION' : 'UNKNOWN', selected);
    check('unsupported-native/' + n, command + '; & ("co"+"dex") ("res"+"ume")', 'UNKNOWN', selected);
  }
  for (const [n, [command, proved, expected]] of model.schema.entries()) for (const selected of model.shells) {
    assert.equal(Boolean(api.commandRoles(command, input(selected)).segments?.proofs.some(p => p.schema.startsWith('git '))), proved, command);
    check('schema', command, model.schema_data[n]?.includes(dataClass(input(selected))) ? 'NOT_CONTINUATION' : expected, selected);
  }
  for (const [id, text] of model.construction) for (const selected of model.shells) check('construction/' + id, text, 'UNKNOWN', selected);
  for (const selected of [null, '', 5, 'unknown.exe']) {
    const text = 'git push origin HEAD:refs/heads/codex/example; if ($x) { Write-Output $x }';
    const envelope = { tool_input: { shell: selected } };
    assert.equal(api.commandRoles(text, envelope).segments, null); assert.equal(parse(text, envelope).status, 'UNKNOWN');
  }
  for (const selected of model.shells) for (const [id, body] of [
    ['ref', 'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'],
    ['message', 'git commit -m "codex resume"'],
  ]) {
    const text = "pwsh -NoProfile -Command '" + body + "'";
    const ordinary = ['powershell.exe', 'pwsh'].includes(selected) || (id === 'message' && ['bash', 'sh'].includes(selected));
    check('wrapper/' + id, text, ordinary ? 'NOT_CONTINUATION' : 'UNKNOWN', selected);
    check('wrapper-neighbour', text + '; & ("co"+"dex") ("res"+"ume")', 'UNKNOWN', selected);
  }
  // Frozen G0 structural rows: unsupported syntax gets no role proof; it does
  // not invent a continuation when neither native family has visible evidence.
  for (const [ending, expected] of [[';', 'NOT_CONTINUATION'], [' |', 'NOT_CONTINUATION'],
    [' && git status', 'NOT_CONTINUATION'], [' || git status', 'NOT_CONTINUATION'],
    [' # comment', 'UNKNOWN'], [' ' + String.fromCharCode(0), 'UNKNOWN'], [' ' + String.fromCharCode(0x2603), 'UNKNOWN']]) {
    const text = 'git push origin HEAD:refs/heads/codex/example' + ending;
    const roles = api.commandRoles(text, input(null));
    assert.equal(roles.segments, null); assert.equal(roles.candidate, text);
    assert.equal(parse(text, input(null)).status, expected, JSON.stringify(ending));
    assert.equal(parse(text + '; codex resume --last', input(null)).status, 'UNKNOWN', 'executable neighbour still refused');
  }
  const long = 'git push origin HEAD:refs/heads/codex/' + 'x'.repeat(LIMITS.command);
  assert.equal(api.commandRoles(long, input(null)).segments, null); assert.equal(parse(long, input(null)).status, 'UNKNOWN');
  const witness = "@'\nv={'example':1}\nfor key,value in v.items():\n    print(key,value)\n'@ | python -";
  for (const selected of model.shells) check('restart-witness-equivalent', witness,
    [null, 'powershell.exe', 'pwsh'].includes(selected) ? 'NOT_CONTINUATION' : 'UNKNOWN', selected);
  t.diagnostic(JSON.stringify({ rows, masks, payloadsDispatched: false }));
});

test('contiguous evidence restores conservative collapse for every unproved primitive separator', t => {
  const { CANDIDATE_MACHINES } = evidenceProjection(); let rows = 0;
  for (const { word } of CANDIDATE_MACHINES) for (let cut = 1; cut < word.length; cut += 1) {
    for (const separator of [' ', '\t', '\n', '\r\n', ';', '|', '(', ')', '[', ']', ',', ':', '+', '.', '/']) {
      const text = '(' + word.slice(0, cut) + separator + word.slice(cut) + ')';
      // Independent finite reference, including the inherited fixed format/join step.
      const reference = text.replace(/-(?:f|join)\b/gi, '').replace(/[^a-z0-9-]/gi, '');
      const expected = /claude|codex|resume|fork|--(?:continue|session-id)/i.test(reference) ? 'UNKNOWN' : 'NOT_CONTINUATION';
      assert.equal(parse(text, { tool_input: {} }).status, expected, word + '/' + cut + '/' + JSON.stringify(separator)); rows += 1;
    }
  }
  for (const separator of ['\v', '\f']) assert.equal(parse('(for' + separator + 'key)', { tool_input: {} }).status, 'UNKNOWN');
  assert.equal(rows, 2400);
  t.diagnostic(JSON.stringify({ primitiveRows: rows }));
});

test('construction closure restores explicit, implicit and pipeline evidence on both envelopes', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir), model = matrix.evidence_boundary_model;
  let rows = 0, confirmed = 0, spawns = 0;
  const resolver = new ContinuationResolver({ environment: ctx.environment,
    spawn() { spawns += 1; assert.fail('construction evidence must not acquire native metadata'); } });
  const guard = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment,
    stateReader: () => ({ state: 'DISABLED', rule: 'R1' }), continuationResolver: resolver });
  for (const [kind, cases] of [['confirmed', model.confirmed_constructions], ['sibling', model.construction_siblings]]) {
    for (const [id, text] of cases) for (const selected of model.shells) for (const tool_name of ['Bash', 'PowerShell']) {
      const input = { ...shell(ctx, text), tool_name };
      if (selected !== null) input.tool_input.shell = selected;
      assert.equal(parse(text, input).status, 'UNKNOWN', kind + '/' + id + '/' + selected);
      assert.ok(guard.decide(input)?.deny, kind + '/' + id + ': ToolGate denial');
      rows += 1; if (kind === 'confirmed') confirmed += 1;
    }
  }
  assert.equal(confirmed, 48); assert.equal(rows, 324); assert.equal(spawns, 0);
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ constructionRows: rows, confirmed, metadataSpawns: spawns, payloadsDispatched: false }));
});

test('binding closure changes only proved horizontal offsets and never hides source or native neighbours', t => {
  const model = matrix.evidence_boundary_model, api = evidenceProjection();
  const stdin = body => "@'\n" + body + "\n'@ | python -";
  const profile = selected => selected === null ? 'common' : ['powershell.exe', 'pwsh'].includes(selected) ? 'powershell'
    : selected === 'cmd.exe' ? 'cmd' : 'posix';
  let positive = 0, unproved = 0, neighbours = 0;
  for (const [id, body, count] of model.binding_cases) for (const selected of [null, 'powershell.exe', 'pwsh']) {
    const text = stdin(body), spans = api.pythonBindingBarriers(text, profile(selected));
    assert.equal(spans.length, count, id);
    for (const span of spans) {
      assert.match(text.slice(span.start, span.end), /^[ \t]+$/);
      assert.equal(text.slice(span.start - 3, span.start), 'for');
      assert.match(text.slice(span.end), /^[a-z_]/i);
    }
    assert.equal(parse(text, { tool_input: selected === null ? {} : { shell: selected } }).status, 'NOT_CONTINUATION', id);
    assert.equal((api.constructionFragments(text, profile(selected)).match(/\0/g) || []).length,
      spans.reduce((total, span) => total + span.end - span.start, 0), id + ': only proved separators become barriers');
    positive += 1;
  }
  for (const [id, source, expected, padding] of model.unproved_binding_cases) for (const [n, selected] of model.shells.entries()) {
    const text = padding ? source.replace("\n'@", '\n' + 'x'.repeat(padding) + "\n'@") : source;
    assert.deepEqual(api.pythonBindingBarriers(text, profile(selected)), [], id);
    assert.equal(parse(text, { tool_input: selected === null ? {} : { shell: selected } }).status, expected[n], id);
    unproved += 1;
  }
  for (const [id, body] of model.embedded_neighbours) for (const selected of model.shells) {
    assert.equal(parse(stdin(body), { tool_input: selected === null ? {} : { shell: selected } }).status, 'UNKNOWN', id);
    neighbours += 1;
  }
  for (const [id, text] of model.confirmed_constructions) for (const selected of model.shells) {
    const ordinary = stdin('for k in items:\n    pass');
    for (const command of [text + '; ' + ordinary, ordinary + '; ' + text, ordinary + ' | ' + text]) {
      assert.equal(parse(command, { tool_input: selected === null ? {} : { shell: selected } }).status, 'UNKNOWN', id);
      neighbours += 1;
    }
  }
  // Lexical proof is deliberately narrower than Python or PowerShell acceptance.
  for (const prefix of ['r', 'u', 'b', 'br', 'rb', 'R', 'BR']) {
    assert.equal(api.pythonBindingBarriers(stdin('x=' + prefix + '"unrelated"\nfor k in items:\n    pass'), 'common').length, 1, prefix);
  }
  for (const prefix of ['f', 't', 'fr', 'rf', 'tr', 'rt', 'unknown']) {
    assert.deepEqual(api.pythonBindingBarriers(stdin('x=' + prefix + '"unrelated"\nfor k in items:\n    pass'), 'common'), [], prefix);
  }
  for (const body of ['x="for k in items"', "x='for k in items'", 'x="""for k in items"""', '# for k in items',
    'for True in items:pass', 'for k, in items:pass', 'for k[0] in items:pass', 'for k.x in items:pass',
    'for (k) in items:pass', 'for k\nin items:pass', 'for k # comment\nin items:pass',
    '# first\n# coding=unicode_escape\nfor k in items:pass', 'for k in items:\r    pass',
    ...['\0', '\v', '\f', '\x01', '\x7f', '\u2603', '$', '%', '!', '`', '^', '&'].map(c => 'for k in items:\n    x="' + c + '"')]) {
    assert.deepEqual(api.pythonBindingBarriers(stdin(body), 'common'), [], JSON.stringify(body));
  }
  const ordinary = stdin('for k in items:\n    pass');
  for (const text of ['prefix ' + ordinary, ordinary + ' suffix', ordinary + ' | python -',
    ordinary.replace('python -', 'python -u -'), ordinary.replace('python -', 'python3 -x -'),
    ordinary.replace('python -', 'C:/example.test/python.exe -'), ordinary.replace('python -', 'node -')]) {
    assert.deepEqual(api.pythonBindingBarriers(text, 'common'), [], 'complete exact consumer required');
  }
  for (const consumer of ['python -', 'python3 -', 'python.exe -', 'python3.exe -', 'PYTHON3.EXE -']) {
    assert.equal(api.pythonBindingBarriers(ordinary.replace('python -', consumer), 'common').length, 1, consumer);
  }
  assert.equal(api.constructionFragments('(co\0dex) (res\0ume)', 'common').includes('\0'), false, 'original NUL cannot impersonate an internal barrier');
  assert.equal(positive, 21); assert.equal(unproved, 120); assert.equal(neighbours, 114);
  t.diagnostic(JSON.stringify({ bindingRows: positive, unprovedRows: unproved, nativeNeighbours: neighbours, payloadsDispatched: false }));
});

// Frozen legacy projection: independent numeric-hole reference, original stage order.
function legacyConstructionProjection(text) {
  return text.replace(/[\\\x60^]\r?\n/g, '')
    .replace(/%[^%\r\n]*%|![^!\r\n]*!|\$\{[^}$\r\n]*\}/g, '')
    .replace(/["'\\\x60^]/g, '').replace(/\{[0-9][^{}]*\}/g, '')
    .replace(/-(?:f|join)\b/gi, '').replace(/[^a-z0-9-]/gi, '');
}

test('source sentinels preserve the closed legacy classification and ToolGate family', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir), api = evidenceProjection();
  const model = matrix.evidence_boundary_model, closed = model.sentinel_transforms, counts = closed.expected_rows;
  assert.deepEqual(api.CANDIDATE_MACHINES.map(row => row.word), closed.words);
  let rows = 0, reviewRows = 0, spawns = 0, queueAccesses = 0;
  const failures = [], originals = {};
  const resolver = new ContinuationResolver({ environment: ctx.environment,
    spawn() { spawns += 1; assert.fail('sentinel source cannot acquire native metadata'); } });
  const guard = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment,
    stateReader: () => ({ state: 'DISABLED', rule: 'R1' }), continuationResolver: resolver });
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync']) {
    originals[name] = fs[name]; fs[name] = function(file, ...args) {
      if (String(file).includes(gate.HELD_BASENAME)) { queueAccesses += 1; throw Error('SYNTHETIC_QUEUE_ACCESS'); }
      return originals[name].call(this, file, ...args);
    };
  }
  try {
    for (const [wordIndex, word] of closed.words.entries()) for (const count of closed.nul_counts)
      for (const shape of closed.shapes) for (const selected of model.shells) for (const tool_name of ['Bash', 'PowerShell']) {
        const text = sentinelText(shape.template, word, String.fromCharCode(0).repeat(count));
        const input = { ...shell(ctx, text), tool_name, tool_input: { command: text, ...(selected === null ? {} : { shell: selected }) } };
        const expected = shape.expected[wordIndex], status = parse(text, input).status, denied = Boolean(guard.decide(input)?.deny);
        if (status !== expected || denied !== (expected === 'UNKNOWN')) failures.push({ shape: shape.id, word, count, selected, tool_name, expected, status, denied });
        rows += 1; if (!shape.id.endsWith('-join-reversal')) reviewRows += 1;
      }
  } finally { for (const name of Object.keys(originals)) fs[name] = originals[name]; }
  assert.equal(rows, counts.sentinel); assert.equal(reviewRows, counts.original_review);
  assert.equal(spawns, 0); assert.equal(queueAccesses, 0); assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ sentinelRows: rows, originalReviewRows: reviewRows, failures: failures.length,
    lostRefusals: failures.filter(row => row.expected === 'UNKNOWN').length,
    extraRefusals: failures.filter(row => row.expected === 'NOT_CONTINUATION').length, spawns, queueAccesses }));
  assert.deepEqual(failures, [], 'original source controls must not create consuming syntax');
});

test('source sentinel projection preserves every consuming stage and UTF-16 code unit', t => {
  const api = evidenceProjection(), closed = matrix.evidence_boundary_model.sentinel_transforms, counts = closed.expected_rows;
  const controls = closed.control_code_points.map(point => String.fromCodePoint(point));
  const neighbours = [...closed.shapes.map(row => [row.id, row.template]), ...closed.neighbours];
  let unproved = 0, codeUnits = 0, qualified = 0, withdrawn = 0;
  for (const word of closed.words) for (const control of controls) for (const [id, template] of neighbours)
    for (const profile of ['common', 'powershell']) {
      const text = sentinelText(template, word, control);
      assert.deepEqual(api.pythonBindingBarriers(text, profile), [], id);
      assert.equal(api.constructionFragments(text, profile), legacyConstructionProjection(text), id); unproved += 1;
    }
  for (let code = 0; code <= 65535; code += 1) for (const shape of closed.shapes.slice(0, 2)) {
    const control = String.fromCharCode(code), text = sentinelText(shape.template, 'codex', control);
    assert.equal(text.split('').join(''), text, 'identity includes lone surrogates');
    assert.equal(api.constructionFragments(text, 'common'), legacyConstructionProjection(text), shape.id); codeUnits += 1;
  }
  const stdin = body => "@'\n" + body + "\n'@ | python -";
  const placements = [(body, word) => body + '\ntext="' + word + '"', (body, word) => body + '\n# ' + word,
    (body, word) => body + '\ntext="{0' + word + '}"', (body, word) => body + '\ntext="{ ' + word + '}"'];
  for (const body of closed.qualified_bodies) for (const word of closed.words) for (const place of placements)
    for (const profile of ['common', 'powershell']) {
      const text = stdin(place(body, word)), spans = api.pythonBindingBarriers(text, profile);
      assert.ok(spans.length); assert.equal(api.constructionFragments(text, profile).replace(/\0/g, ''), legacyConstructionProjection(text));
      qualified += 1;
    }
  for (const control of controls.filter(c => !['\t', '\n', '\r'].includes(c)))
    for (const place of ['before', 'after', 'header', 'string', 'comment']) for (const profile of ['common', 'powershell']) {
      const body = place === 'before' ? control + '\nfor k in items:\n    pass' : place === 'after' ? 'for k in items:\n    pass' + control
        : place === 'header' ? 'for ' + control + 'k in items:\n    pass' : place === 'string' ? 'for k in items:\n    text="' + control + '"'
          : 'for k in items:\n    # ' + control;
      const text = stdin(body); assert.deepEqual(api.pythonBindingBarriers(text, profile), []);
      assert.equal(api.constructionFragments(text, profile), legacyConstructionProjection(text)); withdrawn += 1;
    }
  // Reuse the hostile-input set. CRLF and horizontal tabs remain permitted proof;
  // every source string still equals the legacy letters after generated barriers.
  let hostileRows = 0;
  for (const shape of [...hostile.cases(['continued-lines', 'invisible', 'indents', 'large-input'], ['shell', 'text']),
    ...hostile.variants('for k in items:\n    pass')]) {
    const text = stdin(shape.text), projection = api.constructionFragments(text, 'common');
    assert.equal(projection.replace(/\0/g, ''), legacyConstructionProjection(text), shape.id); hostileRows += 1;
  }
  assert.equal(unproved, counts.unproved_projection); assert.equal(codeUnits, counts.code_units);
  assert.equal(qualified, counts.qualified_projection); assert.equal(withdrawn, counts.proof_withdrawal);
  t.diagnostic(JSON.stringify({ unproved, codeUnits, qualified, withdrawn, hostileRows }));
});

test('source sentinel ablations expose early deletion, unowned barriers and missing proof', t => {
  const closed = matrix.evidence_boundary_model.sentinel_transforms, counts = closed.expected_rows;
  const api = evidenceProjection(), input = { tool_input: {} }; let lost = 0, extra = 0;
  const replace = (source, before, after) => { assert.ok(source.includes(before), 'ablation anchor'); return source.replace(before, after); };
  const retainNul = source => replace(source,
    '.replace(barriers.length ? /[^a-z0-9\\x00-]/gi : /[^a-z0-9-]/gi,\'\');', '.replace(/[^a-z0-9\\x00-]/gi,\'\');');
  const early = evidenceProjection(source => retainNul(replace(source,
    "chars=text.split('')", "chars=[...text].map(c=>c==='\\0'?'':c)")));
  // No-proof partition only: this freezes the rejected early-source-NUL deletion.
  for (const [wordIndex, word] of closed.words.entries()) for (const count of closed.nul_counts) for (const shape of closed.shapes) {
    const text = sentinelText(shape.template, word, String.fromCharCode(0).repeat(count));
    const ablated = early.parse(text, input).status, expected = shape.expected[wordIndex];
    if (expected === 'UNKNOWN' && ablated === 'NOT_CONTINUATION') lost += 12;
    if (expected === 'NOT_CONTINUATION' && ablated === 'UNKNOWN') extra += 12;
  }
  assert.equal(lost, counts.early_deletion_lost_refusals); assert.equal(extra, counts.early_deletion_extra_refusals);
  const unowned = evidenceProjection(retainNul);
  const split = '(co' + String.fromCharCode(0) + 'dex)';
  assert.equal(api.parse(split, input).status, 'UNKNOWN'); assert.equal(unowned.parse(split, input).status, 'NOT_CONTINUATION');
  const noProof = evidenceProjection(source => replace(source, 'const barriers=pythonBindingBarriers(text, shell),chars=', 'const barriers=[],chars='));
  const binding = "@'\nfor key in items:\n    pass\n'@ | python -";
  assert.equal(api.parse(binding, input).status, 'NOT_CONTINUATION'); assert.equal(noProof.parse(binding, input).status, 'UNKNOWN');
  t.diagnostic(JSON.stringify({ ablations: 3, lostRefusals: lost, extraRefusals: extra,
    withdrawalReason: 'Restore exact legacy classification after early deletion invented consuming syntax' }));
});
