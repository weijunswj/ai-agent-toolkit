'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const TOOLKIT_CLIENT_VERSION = '3.9.1';

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
class AppServerRequest {
  #command; #codexHome; #request; #options;
  #child; #reader; #stderr=''; #response; #settled=false;
  #requestTimer=null; #shutdownTimer=null; #forceTimer=null; #pendingError=null;
  #resolve; #reject;
  constructor(command,codexHome,request,options={}) {
    this.#command=command;this.#codexHome=codexHome;this.#request=request;this.#options=options;
  }
  run() {
    return new Promise((resolve,reject)=>{
      this.#resolve=resolve;this.#reject=reject;
      const parts=codexCommandParts(this.#command,['app-server','--listen','stdio://']);
      this.#child=spawn(parts.command,parts.args,{
        env:{...process.env,CODEX_HOME:this.#codexHome},cwd:this.#options.cwd,
        stdio:['pipe','pipe','pipe'],windowsHide:true});
      this.#reader=readline.createInterface({input:this.#child.stdout});
      this.#requestTimer=setTimeout(()=>this.#shutdown(new Error(`${this.#command} app-server ${this.#request.method} timed out`)),this.#options.timeoutMs||15000);
      this.#child.stderr.on('data',chunk=>{this.#stderr=(this.#stderr+chunk).slice(-16384);});
      this.#child.stdin.on('error',error=>this.#shutdown(error));
      this.#child.on('error',error=>this.#settle(error));
      this.#child.on('close',code=>{
        if(this.#pendingError)this.#settle(this.#pendingError);
        else if(this.#response!==undefined)this.#settle();
        else this.#settle(new Error(`${this.#command} app-server exited ${code}: ${this.#stderr.trim()}`));
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
    if(error)this.#reject(error);else this.#resolve(this.#response);
  }
  #shutdown(error=null) {
    if(this.#shutdownTimer||this.#forceTimer||this.#settled)return;
    this.#pendingError=error;try{this.#child.stdin.end();}catch{}
    this.#shutdownTimer=setTimeout(()=>{
      terminateChildTree(this.#child);
      this.#forceTimer=setTimeout(()=>this.#settle(this.#pendingError||new Error(`${this.#command} app-server did not exit after bounded process-tree termination`)),this.#options.forceExitTimeoutMs||2000);
    },this.#options.closeTimeoutMs||2000);
  }
  #receive(line) {
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.id===1){
      if(message.error){this.#shutdown(new Error(`app-server initialize failed: ${message.error.message||JSON.stringify(message.error)}`));return;}
      this.#child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
      this.#child.stdin.write(JSON.stringify({...this.#request,id:2})+'\n');
    }else if(message.id===2){
      if(message.error){this.#shutdown(new Error(`${this.#request.method} failed: ${message.error.message||JSON.stringify(message.error)}`));return;}
      this.#response=message.result;this.#shutdown();
    }
  }
}
function runAppServerRequest(command,codexHome,request,options={}) {
  return new AppServerRequest(command,codexHome,request,options).run();
}

module.exports = { appServerCandidates, runAppServerRequest };
