'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
// Runtime scripts and the helper-script templates repositories copy and run.
const SCANNED = /^(?:repo\/scripts\/.*|skills\/.*\/scripts\/.*|skills\/.*\/templates\/helper-scripts\/.*)\.cjs$/;

// Two same-length views of a source: `code` blanks comments; `bare` also blanks the bodies of strings,
// template literals and regular expressions, so a word inside one never counts as code. One misread
// token can blank the rest of a file, so `unclosed` lists every token the lexer could not close (a
// string or regular expression reaching a line end, a template or comment reaching the end of the
// file, a brace with no partner); the tree test requires none.
const lexed = new Map();
function views(source) {
  if (!lexed.has(source)) lexed.set(source, lex(source));
  return lexed.get(source);
}
function lex(source) {
  const code = [], bare = [], unclosed = [];
  let copied = 0;
  const take = (to, hideCode, hideBare) => {
    const text = source.slice(copied, to), blank = text.replace(/[^\n]/g, ' ');
    code.push(hideCode ? blank : text);
    bare.push(hideBare ? blank : text);
    copied = to;
  };
  // A slash starts a regular expression where an expression may start: at the start, after one of
  // these, or after a keyword such as return.
  const punctuation = '(,=:[!&|?{};+-*%<>~^';
  const keyword = /(?:^|[^\w$.])(?:return|typeof|case|in|of|void|delete|throw|new|else|do)$/;
  const regexStarts = at => {
    let last = at - 1;
    while (last >= 0 && /\s/.test(source[last])) last -= 1;
    return last < 0 || punctuation.includes(source[last]) || keyword.test(source.slice(Math.max(0, last - 7), last + 1));
  };
  const braces = [];
  const interesting = /[/'"`{}]/g;
  let at = 0;
  while (at < source.length) {
    interesting.lastIndex = at;
    const found = interesting.exec(source);
    if (!found) break;
    at = found.index;
    const char = source[at], next = source[at + 1];
    if (char === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? source.indexOf('\n', at) : source.indexOf('*/', at + 2);
      const stop = end < 0 ? source.length : next === '/' ? end : end + 2;
      if (end < 0 && next === '*') unclosed.push({ at, what: 'comment' });
      take(at, false, false);
      take(stop, true, true);
      at = stop;
      continue;
    }
    const resumes = char === '}' && braces.at(-1) === 'template';
    if (char === '{') braces.push('block');
    else if (char === '}' && braces.pop() === undefined) unclosed.push({ at, what: 'brace' });
    if (!(char === '\'' || char === '"' || char === '`' || resumes || (char === '/' && regexStarts(at)))) { at += 1; continue; }
    const close = resumes ? '`' : char;
    let end = at + 1, inClass = false;
    while (end < source.length) {
      const inner = source[end];
      if (inner === '\\') { end += 2; continue; }
      if (close === '`' && inner === '$' && source[end + 1] === '{') { braces.push('template'); break; }
      if (close === '/' && inner === '[') inClass = true;
      else if (close === '/' && inner === ']') inClass = false;
      else if ((inner === close && !inClass) || (close !== '`' && inner === '\n')) break;
      end += 1;
    }
    if (end >= source.length || source[end] === '\n') unclosed.push({ at, what: close === '/' ? 'regular expression' : close === '`' ? 'template' : 'string' });
    end = Math.min(end, source.length);
    take(at + 1, false, false);
    take(end, false, true);
    // A template's ${ opens code again until its matching brace.
    at = source[end] === '$' ? end + 2 : end + 1;
  }
  take(source.length, false, false);
  for (const open of braces) unclosed.push({ at: source.length, what: open === 'template' ? 'template' : 'brace' });
  return { code: code.join(''), bare: bare.join(''), unclosed };
}

// The repository path a require argument names, or null. It follows string literals, __dirname,
// path.join and path.resolve, and same-file `const NAME =` values built from those. A require of a
// variable set any other way (a function argument, an option, a computed root) stays unresolved:
// that is the accepted remainder.
function argumentOf(code, open) {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === '(') depth += 1;
    else if (code[at] === ')' && --depth === 0) return code.slice(open + 1, at).trim();
  }
  return null;
}
function splitArguments(text) {
  const parts = [];
  let depth = 0, from = 0;
  for (let at = 0; at < text.length; at += 1) {
    if ('([{'.includes(text[at])) depth += 1;
    else if (')]}'.includes(text[at])) depth -= 1;
    else if (text[at] === ',' && depth === 0) { parts.push(text.slice(from, at).trim()); from = at + 1; }
  }
  parts.push(text.slice(from).trim());
  return parts.filter(Boolean);
}
function pathOf(file, view, expression, depth = 0) {
  if (depth > 8 || !expression) return null;
  const literal = /^(['"])([^'"\\]*)\1$/.exec(expression);
  if (literal) return { literal: literal[2] };
  if (expression === '__dirname') return { dir: path.posix.dirname(file) };
  const call = /^path\.(join|resolve)\s*\(([\s\S]*)\)$/.exec(expression);
  if (call) {
    const parts = splitArguments(call[2]).map(part => pathOf(file, view, part, depth + 1));
    if (!parts.length || !parts[0]?.dir || parts.slice(1).some(part => !part || part.dir)) return null;
    return { dir: path.posix.join(parts[0].dir, ...parts.slice(1).map(part => part.literal)) };
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expression)) {
    for (const match of view.bare.matchAll(/(?<![\w$])const\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
      if (match[1] !== expression) continue;
      const from = match.index + match[0].length;
      const end = view.bare.slice(from).search(/;|\n/);
      const found = pathOf(file, view, view.code.slice(from, end < 0 ? undefined : from + end).trim(), depth + 1);
      if (found) return found;
    }
  }
  return null;
}
function targetOf(file, view, argument, sources) {
  const found = pathOf(file, view, argument);
  if (!found) return null;
  let target;
  if (found.dir !== undefined) target = path.posix.normalize(found.dir);
  else if (/^\.{1,2}\//.test(found.literal)) target = path.posix.normalize(path.posix.join(path.posix.dirname(file), found.literal));
  else return null;
  return [target, `${target}.cjs`, `${target}/index.cjs`].find(candidate => sources.has(candidate)) || null;
}

function offendersOf(sources) {
  const files = [...sources.keys()];
  const viewed = new Map(files.map(file => [file, views(sources.get(file))]));
  const graph = new Map(files.map(file => {
    const view = viewed.get(file);
    const edges = [];
    // Scan the whole source, including requires inside functions.
    for (const match of view.bare.matchAll(/\brequire\s*\(/g)) {
      const resolved = targetOf(file, view, argumentOf(view.code, match.index + match[0].length - 1), sources);
      if (resolved) edges.push(resolved);
    }
    return [file, edges];
  }));
  function inCycle(start) {
    const visited = new Set();
    const pending = [...graph.get(start)];
    while (pending.length) {
      const next = pending.pop();
      if (next === start) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(...graph.get(next));
    }
    return false;
  }
  return files.filter(file => {
    const { bare } = viewed.get(file);
    const cli = bare.search(/require\.main\s*===\s*module/);
    const exports = bare.search(/module\.exports\s*=/);
    return cli >= 0 && (exports < 0 || cli < exports) && inCycle(file);
  });
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--', 'repo/scripts', 'skills'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
    .split('\0').filter(file => SCANNED.test(file));
}

test('scripts in require cycles export before running their CLI', () => {
  const files = trackedFiles();
  assert.ok(files.includes('repo/scripts/toolkit-tasks.cjs'), 'tracked runtime scripts must be scanned');
  assert.ok(files.includes('skills/n8n-workflow-transport/templates/helper-scripts/import-export-sync/n8n-workflow-transport.cjs'), 'helper-script templates must be scanned');
  const sources = new Map(files.map(file => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]));
  // A token the lexer could not close blanks the rest of its file, which would hide that file's
  // requires, CLI check and exports line from the guard.
  const misread = files.flatMap(file => views(sources.get(file)).unclosed
    .map(({ at, what }) => `${file}:${sources.get(file).slice(0, at).split('\n').length} unclosed ${what}`));
  assert.deepEqual(misread, [], `The guard's lexer misread these files; teach it the construct:\n${misread.join('\n')}`);
  const offenders = offendersOf(sources);
  assert.deepEqual(offenders, [], `Export before CLI execution in require cycles:\n${offenders.join('\n')}`);
});

const CLI_FIRST = "if (require.main === module) main();\nmodule.exports = { main };\n";
const EXPORTS_FIRST = "module.exports = { main };\nif (require.main === module) main();\n";

test('the guard follows path.join(__dirname, ...) requires and named path constants', () => {
  const joined = new Map([
    ['repo/scripts/a.cjs', `const path = require('node:path');\nconst b = require(path.join(__dirname, 'b.cjs'));\n${CLI_FIRST}`],
    ['repo/scripts/b.cjs', "require('./a.cjs');\nmodule.exports = {};\n"],
  ]);
  assert.deepEqual(offendersOf(joined), ['repo/scripts/a.cjs']);
  const named = new Map([
    ['repo/scripts/a.cjs', `const path = require('node:path');\nconst ROOT = path.resolve(__dirname, '..', '..');\nconst B = path.join(ROOT, 'skills', 'x', 'scripts', 'b.cjs');\nfunction main() { require(B); }\n${CLI_FIRST}`],
    ['skills/x/scripts/b.cjs', "require('../../../repo/scripts/a.cjs');\nmodule.exports = {};\n"],
  ]);
  assert.deepEqual(offendersOf(named), ['repo/scripts/a.cjs']);
});

test('the guard ignores comments and strings', () => {
  const cycle = first => new Map([
    ['repo/scripts/a.cjs', `require('./b.cjs');\n${first}`],
    ['repo/scripts/b.cjs', "require('./a.cjs');\nmodule.exports = {};\n"],
  ]);
  // The CLI guard named in a comment or a string above real exports is not a CLI.
  assert.deepEqual(offendersOf(cycle(`// require.main === module runs main below\n${EXPORTS_FIRST}`)), []);
  assert.deepEqual(offendersOf(cycle(`const note = 'require.main === module';\n${EXPORTS_FIRST}`)), []);
  // An exports line in a comment or a regular expression above the real CLI does not count as exporting.
  assert.deepEqual(offendersOf(cycle(`/* module.exports = later */\n${CLI_FIRST}`)), ['repo/scripts/a.cjs']);
  assert.deepEqual(offendersOf(cycle(`const re = /module.exports = ['"]/;\n${CLI_FIRST}`)), ['repo/scripts/a.cjs']);
  assert.deepEqual(offendersOf(cycle(`function f(s) { return /module.exports = x/.test(s); }\n${CLI_FIRST}`)), ['repo/scripts/a.cjs'], 'a regular expression after return');
  // A require named only in a comment or a string is no edge.
  const commented = new Map([
    ['repo/scripts/a.cjs', `// require('./b.cjs')\nconst s = "require('./b.cjs')";\n${CLI_FIRST}`],
    ['repo/scripts/b.cjs', "require('./a.cjs');\nmodule.exports = {};\n"],
  ]);
  assert.deepEqual(offendersOf(commented), []);
  // Code inside a template's ${ ... } is code again: its require is an edge, and a quote or brace in a
  // string there neither ends the template nor counts as a brace.
  const templated = new Map([
    ['repo/scripts/a.cjs', `const s = \`\${ok ? '}\`' : require('./b.cjs').name}\`;\n${CLI_FIRST}`],
    ['repo/scripts/b.cjs', "require('./a.cjs');\nmodule.exports = {};\n"],
  ]);
  assert.deepEqual(views(templated.get('repo/scripts/a.cjs')).unclosed, []);
  assert.deepEqual(offendersOf(templated), ['repo/scripts/a.cjs']);
});

test('the guard reports a token its lexer could not close', () => {
  // A regular expression after a closing parenthesis reads as division, so its backtick opens a
  // template that never closes and would blank the rest of the file.
  assert.deepEqual(views("if (ok) /`/.test(s);\nrequire('./b.cjs');\n").unclosed.map(item => item.what), ['template']);
  assert.deepEqual(views("const s = 'open\nconst t = 1;\n").unclosed.map(item => item.what), ['string']);
  assert.deepEqual(views('function f() {\n').unclosed.map(item => item.what), ['brace']);
  assert.deepEqual(views('}\n').unclosed.map(item => item.what), ['brace']);
  assert.deepEqual(views('/* open\n').unclosed.map(item => item.what), ['comment']);
  assert.deepEqual(views(`${CLI_FIRST}const re = /a[/]b/g;\nconst t = \`x\${{ a: 1 }.a}\`;\n`).unclosed, []);
});
