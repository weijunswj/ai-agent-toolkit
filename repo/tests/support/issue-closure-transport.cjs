'use strict';
// Isolated subprocess metadata for authority tests. No request reaches a real gh process.
const fs = require('node:fs');
const path = require('node:path');
function fakeClosureEnvironment(root, environment, sha) {
  const bin = path.join(root, 'closure-github'); fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'gh.exe' : 'gh'), '');
  const preload = path.join(bin, 'transport.cjs');
  fs.writeFileSync(preload, `
const cp = require('node:child_process'); const original = cp.spawnSync;
cp.spawnSync = function(file, args, options) {
  if (!/^gh(?:\\.exe)?$/i.test(require('node:path').basename(file))) return original(file, args, options);
  let json = null; const api = args[4] || '';
  const pr = /^repos\\/[^/]+\\/[^/]+\\/pulls\\/(\\d+)$/.exec(api);
  if (pr) json = { number: Number(pr[1]), title: 'Safe change', body: 'Refs only', commits: 0, head: { sha: ${JSON.stringify(sha)} } };
  else if (/\\/commits\\?/.test(api) || /\\/sub_issues\\?/.test(api)) json = [];
  else { const issue = /\\/issues\\/(\\d+)$/.exec(api); if (issue) json = { number: Number(issue[1]), state: 'open' }; }
  const status = json ? 200 : 404;
  return { status: status === 200 ? 0 : 1, stdout: 'HTTP/2.0 ' + status + '\\n\\n' + JSON.stringify(json || {}), stderr: '' };
};
`);
  const quotedPreload = preload.replace(/[\\"]/g, (char) => `\\${char}`);
  return { ...environment, Path: undefined, PATH: `${bin}${path.delimiter}${environment.PATH || environment.Path || ''}`, NODE_OPTIONS: [environment.NODE_OPTIONS, `--require "${quotedPreload}"`].filter(Boolean).join(' ') };
}
module.exports = { fakeClosureEnvironment };
