#!/usr/bin/env node
'use strict';

// The commands of `toolkit permissions` that read or write every settings file in scope: `--review`
// (read-only list, toolkit-permissions-review.cjs) and the owner's `--apply` and `--remove`
// (toolkit-permissions-apply.cjs). toolkit-permissions.cjs runs this file as its own process for
// those three flags, so the commands people type stay the same.
//
// Why a separate process: hooks load toolkit-permissions.cjs (its blocks, path reader and the
// session-start check), and every module it loads becomes part of the hooks' code, which must hold no
// one harness's vocabulary (repo/contracts/hooks/hook-scope.json). The review names Claude Code's own
// tools, so it lives here, where no hook loads it.
//
//   node repo/scripts/toolkit-permissions.cjs --review [--host claude] [--repo-root <checkout>] [--all] [--drop <ids>] [--json]
//   node repo/scripts/toolkit-permissions.cjs --apply|--remove [--host claude|codex] [--repo-root <checkout>] [--drop <ids> --preview <code>]

const os = require('node:os');
const { spawnSync } = require('node:child_process');
const permissions = require('./toolkit-permissions.cjs');
const review = require('./toolkit-permissions-review.cjs');

const { PermissionBlocks, PermissionsError } = permissions;

function parseReviewArgs(argv) {
  const options = { repoRoot: null, all: false, drop: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all' && !options.all) { options.all = true; continue; }
    if (arg === '--json' && !options.json) { options.json = true; continue; }
    if (arg === '--host' && argv[index + 1] === 'claude') { index += 1; continue; }
    const value = argv[index + 1];
    if ((arg === '--repo-root' || arg === '--drop') && typeof value === 'string' && value && !value.startsWith('--')) {
      const key = arg === '--drop' ? 'drop' : 'repoRoot';
      if (options[key] === null) { options[key] = value; index += 1; continue; }
    }
    throw new PermissionsError(`--review takes only --host claude, --repo-root <checkout>, --all, --drop <ids> and --json, not ${JSON.stringify(arg)}.`, 'see the usage line.', 2);
  }
  return options;
}

// The review over this computer's files, with the deps the tests inject.
function lister(deps = {}) {
  return new review.PermissionReview({ blocks: new PermissionBlocks(deps), rows: permissions.ROWS, never: permissions.NEVER, safePath: permissions.safePath, cwd: deps.cwd,
    fs: deps.fs, home: deps.home || os.homedir(), platform: deps.platform || process.platform, environment: deps.environment, run: deps.run || spawnSync });
}

function reviewMain(argv, deps, out, err) {
  let options;
  try { options = parseReviewArgs(argv); } catch (error) { err(`${error.message}\n${permissions.USAGE}`); return 2; }
  try {
    const model = lister(deps).collect({ repoRoot: options.repoRoot });
    if (options.drop !== null) {
      const picks = review.readDrop(options.drop, model);
      if (!picks.ok) throw new review.ReviewStop(picks.reason, 'name ids from the list, such as D1 or D1-D5. Nothing was written.');
      const code = review.previewCode(model, picks.ids);
      if (options.json) out(`${JSON.stringify({ picks: picks.ids, preview: code, command: review.applyCommand(model, ` --drop ${picks.ids.join(',')} --preview ${code}`) }, null, 2)}\n`);
      else out(`${review.picksText(model, picks.ids)}\n`);
      return 0;
    }
    if (options.json) {
      out(`${JSON.stringify({ toolkit: { missing: model.missing, old: model.old, status: review.toolkitStatus(model) }, counts: model.counts,
        items: model.items.map(item => ({ id: item.id, class: item.cls, list: item.list, line: review.mask(item.line), where: [...new Set(item.files.map(index => model.files[index].place))] })),
        chat: review.chatList(model, { all: options.all }), command: model.missing || model.old ? review.applyCommand(model) : null }, null, 2)}\n`);
    } else out(`${review.chatList(model, { all: options.all })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof review.ReviewStop || error instanceof PermissionsError) { err(`${error.message}\n`); return error.exitCode; }
    throw error;
  }
}

// permissionsState plus the lines that are not Toolkit's, for the governance bank and setup (Claude
// Code only): { other, risky, dead, review (the chat list) }. Ready stays on Toolkit's own lines.
function permissionsWithReview(root, options = {}) {
  const found = permissions.permissionsState(root, options);
  if (found.host !== 'claude') return found;
  try {
    const model = lister({ cwd: root || process.cwd() }).collect({});
    return { ...found, other: model.counts.other, risky: model.counts.risky, dead: model.counts.dead, review: review.chatList(model) };
  } catch (error) {
    if (!(error instanceof review.ReviewStop)) throw error;
    return { ...found, other: null, review_error: error.message };
  }
}

// `--review`, `--apply` and `--remove` (first argument); anything else is toolkit-permissions.cjs's own.
function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  if (['--apply', '--remove'].includes(argv[0])) return require('./toolkit-permissions-apply.cjs').main(argv.slice(1), { ...deps, mode: argv[0].slice(2) });
  if (argv[0] === '--review') return reviewMain(argv.slice(1), deps, out, err);
  return permissions.main(argv, deps);
}

module.exports = Object.freeze({ main, permissionsWithReview, parseReviewArgs });

// Toolkit's ask line names toolkit-permissions.cjs, so this file runs as a script only when that file
// started it. A speed bump like the agent-shell check, not a lock.
if (require.main === module) {
  if (process.env[permissions.CLI_MARK] !== '1') {
    process.stderr.write('Stopped: run this through toolkit-permissions.cjs, the command its permission lines name. Next: node "<Toolkit>/repo/scripts/toolkit-permissions.cjs" with the same arguments.\n');
    process.exitCode = 2;
  } else Promise.resolve(main()).then((code) => { process.exitCode = code; });
}
