#!/usr/bin/env node
'use strict';

const path = require('node:path');
const util = require('node:util');

const HOOK_ARGS = ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'];
const WARNING = 'Toolkit SessionStart skipped optional maintenance safely. Run `setup toolkit` in Codex to repair the installed hook.';
const MAX_CAPTURE_BYTES = 1024 * 1024;

class BridgeOutputCapture {
  #run; #writes=[]; #bytes=0; #overflow=false;
  #stdout; #stderr; #console={};
  constructor(run) {this.#run=run;this.#stdout=process.stdout.write;this.#stderr=process.stderr.write;}
  #append(stream,chunk,encoding) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk),typeof encoding==='string'?encoding:'utf8');
    this.#bytes+=bytes.length;
    if(this.#bytes<=MAX_CAPTURE_BYTES)this.#writes.push({stream,bytes});else this.#overflow=true;
  }
  #writer(stream) {
    return (chunk,encoding,callback)=>{
      this.#append(stream,chunk,encoding);
      const done=typeof encoding==='function'?encoding:callback;if(typeof done==='function')done();return true;
    };
  }
  capture() {
    process.stdout.write=this.#writer('stdout');process.stderr.write=this.#writer('stderr');
    for(const [method,stream] of [['log','stdout'],['info','stdout'],['error','stderr'],['warn','stderr'],['debug','stderr']]) {
      this.#console[method]=console[method];console[method]=(...args)=>this.#append(stream,util.format(...args)+'\n','utf8');
    }
    try {
      const result=this.#run();if(this.#overflow)throw new Error('bridge output exceeded the safe capture limit');
      return {result,writes:this.#writes};
    }finally{
      process.stdout.write=this.#stdout;process.stderr.write=this.#stderr;
      for(const [method,original] of Object.entries(this.#console))console[method]=original;
    }
  }
}
function captureBridgeOutput(run) {return new BridgeOutputCapture(run).capture();}

function replayBridgeOutput(writes) {
  for (const write of writes) {
    const stream = write.stream === 'stdout' ? process.stdout : process.stderr;
    stream.write(write.bytes);
  }
}

// The hook input Codex pipes in; {} when there is none (a manual run at a terminal). Read only after
// the bridge has run, so the bridge still receives stdin untouched.
function readHookInput() {
  if (process.stdin.isTTY) return {};
  try {
    const parsed = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

// One line stating this repository's governance state; nothing outside a repository.
// SessionStart cannot block, so a failure here only drops the line.
function governanceLine(input, dependencies) {
  try {
    const gate = dependencies.gate || require('./toolkit-governance-gate.cjs');
    // Codex always sends the session's cwd; without one there is no repository to describe.
    return input && typeof input.cwd === 'string' && input.cwd ? gate.sessionLine(input.cwd) : null;
  } catch { return null; }
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  // SessionStart is the only canonical Codex hook event.
  try {
    if (JSON.stringify(argv) !== JSON.stringify(HOOK_ARGS)) throw new Error('unexpected hook arguments');
    const pluginRoot = path.resolve(__dirname, '..', '..');
    process.env.PLUGIN_ROOT = pluginRoot;
    const captured = captureBridgeOutput(() => {
      const bridge = dependencies.bridge || require('./toolkit-local-bridge.cjs');
      return bridge.run(HOOK_ARGS);
    });
    const result = captured.result;
    if (!result || result.status !== 0) throw new Error('bridge returned a non-zero status');
    replayBridgeOutput(captured.writes);
  } catch {
    console.log(WARNING);
  }
  let input = {};
  try { input = dependencies.input || (dependencies.readInput ? dependencies.readInput() : {}); } catch { input = {}; }
  const line = governanceLine(input, dependencies);
  if (line) console.log(line);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), { readInput: readHookInput });

module.exports = { HOOK_ARGS, MAX_CAPTURE_BYTES, WARNING, main };
