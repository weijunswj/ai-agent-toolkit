'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { TOOLKIT_VERSION } = require('./toolkit-version.cjs');

const TOOLKIT_CLIENT_VERSION = TOOLKIT_VERSION;
const APP_SERVER_ARGS = Object.freeze(['app-server', '--listen', 'stdio://']);
// Fixed reason fields and raw host text; callers screen hostText before display.
// Messages stay as they were for existing callers.
const failure = (message, fields) => Object.assign(new Error(message), { hostText: '' }, fields);

function codexCommandParts(command, args) {
  if (/\.(?:cjs|mjs|js)$/i.test(command)) return { command: process.execPath, args: [command, ...args] };
  return { command, args };
}

function appServerCandidates(explicit = '', codexHome = '') {
  return [...new Set([
    explicit,
    process.env.CODEX_TOOLKIT_CODEX_CLI,
    process.env.CODEX_CLI_PATH,
    codexHome ? path.join(codexHome, 'plugins', '.plugin-appserver', process.platform === 'win32' ? 'codex.exe' : 'codex') : '',
    'codex',
  ].filter(Boolean))];
}

function terminateChildTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // By full path: Windows looks for a bare program name in the working folder first.
    const taskkill = path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore',
    });
  } else if (!child.killed) {
    child.kill('SIGTERM');
  }
}

// One bounded process and its protocol/shutdown state belong to one request.
// The constructor captures the existing command/config; it starts no process.
// options: cwd, timeoutMs, closeTimeoutMs, forceExitTimeoutMs, plus two opt-ins for read-only one-shot
// callers (the Codex hook check):
// - direct: start the command with no shell (claude-process-launch.cjs directSpawnParts: an npm
//   codex.cmd runs the script it wraps; any other command script is refused).
// - settleWithoutExit: when Codex has answered but does not stop after the bounded process-tree stop,
//   settle with that answer, and release this request's pipes when it settles so this process can exit.
//   Write callers leave it off: they must see Codex exit before trusting or deleting its folder.
class AppServerRequest {
  #command; #codexHome; #request; #options;
  #child; #reader; #stderr=''; #response; #settled=false; #answered=false;
  #requestTimer=null; #shutdownTimer=null; #forceTimer=null; #pendingError=null;
  #resolve; #reject;
  constructor(command,codexHome,request,options={}) {
    this.#command=command;this.#codexHome=codexHome;this.#request=request;this.#options=options;
  }
  run() {
    return new Promise((resolve,reject)=>{
      this.#resolve=resolve;this.#reject=reject;
      let parts;
      try {
        parts=this.#options.direct
          ? require('./claude-process-launch.cjs').directSpawnParts(this.#command,[...APP_SERVER_ARGS],{label:'Codex'})
          : codexCommandParts(this.#command,[...APP_SERVER_ARGS]);
      } catch { reject(failure(`${this.#command} cannot be started directly`,{reason:'start'}));return; }
      this.#child=spawn(parts.command,parts.args,{
        env:{...process.env,CODEX_HOME:this.#codexHome},cwd:this.#options.cwd,
        stdio:['pipe','pipe','pipe'],windowsHide:true});
      this.#reader=readline.createInterface({input:this.#child.stdout});
      this.#requestTimer=setTimeout(()=>this.#shutdown(failure(`${this.#command} app-server ${this.#request.method} timed out`,{reason:'timeout'})),this.#options.timeoutMs||15000);
      this.#child.stderr.on('data',chunk=>{this.#stderr=(this.#stderr+chunk).slice(-16384);});
      this.#child.stdin.on('error',error=>this.#shutdown(error));
      this.#child.on('error',error=>this.#settle(error));
      this.#child.on('close',code=>{
        if(this.#pendingError)this.#settle(this.#pendingError);
        else if(this.#response!==undefined)this.#settle();
        else this.#settle(failure(`${this.#command} app-server exited ${code}: ${this.#stderr.trim()}`,this.#answered?{reason:'no-result'}:{reason:'exit',exitCode:code,hostText:this.#stderr.trim()}));
      });
      this.#reader.on('line',line=>this.#receive(line));
      this.#child.stdin.write(JSON.stringify({method:'initialize',id:1,params:{
        clientInfo:{name:'ai_agent_toolkit',title:'AI Agent Toolkit',version:TOOLKIT_CLIENT_VERSION},
        capabilities:{experimentalApi:true}}})+'\n');
    });
  }
  #settle(error) {
    if(this.#settled)return;this.#settled=true;
    clearTimeout(this.#requestTimer);if(this.#shutdownTimer)clearTimeout(this.#shutdownTimer);
    if(this.#forceTimer)clearTimeout(this.#forceTimer);this.#reader.close();
    if(this.#options.settleWithoutExit){for(const stream of [this.#child.stdin,this.#child.stdout,this.#child.stderr])stream.destroy();this.#child.unref();}
    if(error)this.#reject(error);else this.#resolve(this.#response);
  }
  #shutdown(error=null) {
    if(this.#shutdownTimer||this.#forceTimer||this.#settled)return;
    this.#pendingError=error;try{this.#child.stdin.end();}catch{}
    this.#shutdownTimer=setTimeout(()=>{
      terminateChildTree(this.#child);
      this.#forceTimer=setTimeout(()=>{
        if(this.#pendingError)this.#settle(this.#pendingError);
        else if(this.#response!==undefined&&this.#options.settleWithoutExit)this.#settle();
        else this.#settle(failure(`${this.#command} app-server did not exit after bounded process-tree termination`,
          {reason:this.#response===undefined?'no-result':'stuck'}));
      },this.#options.forceExitTimeoutMs||2000);
    },this.#options.closeTimeoutMs||2000);
  }
  #receive(line) {
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.id===1){
      if(message.error){this.#shutdown(failure(`app-server initialize failed: ${message.error.message||JSON.stringify(message.error)}`,{reason:'error-reply',step:'initialize',hostText:String(message.error.message||JSON.stringify(message.error))}));return;}
      this.#child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
      this.#child.stdin.write(JSON.stringify({...this.#request,id:2})+'\n');
    }else if(message.id===2){
      this.#answered=true;
      if(message.error){this.#shutdown(failure(`${this.#request.method} failed: ${message.error.message||JSON.stringify(message.error)}`,{reason:'error-reply',step:'request',hostText:String(message.error.message||JSON.stringify(message.error))}));return;}
      this.#response=message.result;this.#shutdown();
    }
  }
}
function runAppServerRequest(command,codexHome,request,options={}) {
  return new AppServerRequest(command,codexHome,request,options).run().catch(error => {
    // Native spawn/pipe errors and synchronous start errors have no Codex diagnosis.
    if (typeof error.hostText !== 'string') error.hostText = '';
    throw error;
  });
}

module.exports = { appServerCandidates, runAppServerRequest };
