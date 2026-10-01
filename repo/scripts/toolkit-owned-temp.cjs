'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn:spawnProcess,spawnSync}=require('node:child_process');
const SCHEMA='ai-agent-toolkit.owned-temp.v1', SPEC='ai-agent-toolkit.owned-temp.spec.v1', MARKER='.ai-agent-toolkit-owned-temp-marker.json', NS='.ai-agent-toolkit-owned-temp-v1';
const MiB=1024*1024, GiB=1024*MiB;
const OWNED_REPORT_MAX_BYTES=65536, OWNED_REPORT_MAX_FRAME_BYTES=OWNED_REPORT_MAX_BYTES*6+1024;
const LIMITS=Object.freeze({portability:256*MiB,sourceUpdate:16*MiB,foundationTest:256*MiB,headroom:GiB,aggregate:2*GiB,roots:8,entries:8192,depth:64,file:64*MiB,chunk:64*1024,metadata:MiB,lease:120000,renew:30000,recoveryRecords:128,recoveryCount:8,retained:2,retainedBytes:64*MiB,retainedMs:24*60*60*1000});
const WIN_RETRY=[0,50,150,300,600,1200,2400], RETRY=new Set(['EBUSY','EPERM','ENOTEMPTY']);
const processInstance=crypto.randomBytes(16).toString('hex');
const processStart=getProcessStart(process.pid);
const MUTATION_OWNER=Symbol('owned-temp-mutation-owner');
const NAMESPACE_OWNER=Symbol('owned-temp-namespace-owner');
const active=new Map();let namespaceCache=null,startupRecovery=false;

function error(code,message,details){const e=new Error(message||code);e.name='OwnedTempError';e.code=code;e.status=code;if(details)Object.assign(e,details);return e;}
function isRfc3339DateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
function createCanonicalValidators() {
  try {
    const Ajv2020 = require('ajv/dist/2020');
    const schemaPath = path.join(__dirname, '..', 'contracts', 'owned-temp', 'owned-temp-v1.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({
      strict: true,
      strictTypes: false,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false
    });
    ajv.addFormat('date-time', isRfc3339DateTime);
    const spec = ajv.compile(schema);
    const records = Object.create(null);
    for (const name of ['claim', 'lease', 'marker', 'rootMarker', 'namespaceMarker', 'admissionLock']) {
      records[name] = ajv.compile({ $ref: schema.$id + '#/$defs/' + name });
    }
    return Object.freeze({ spec, records: Object.freeze(records) });
  } catch (_) {
    throw error('TEMP_SCHEMA_INVALID', 'Canonical owned-temp schema validators are unavailable.');
  }
}
const canonicalValidators = createCanonicalValidators();
const durableRecordSchemaNames = Object.freeze({
  [SCHEMA + '.namespace']: 'namespaceMarker',
  [SCHEMA + '.claim']: 'claim',
  [SCHEMA + '.lease']: 'lease',
  [SCHEMA + '.marker']: 'marker',
  [SCHEMA + '.root-marker']: 'rootMarker',
  [SCHEMA + '.lock']: 'admissionLock'
});
const durableRecordReadTypes = Object.freeze({
  'Namespace marker': 'namespaceMarker',
  'Partial lease': 'lease',
  Claim: 'claim',
  Lease: 'lease',
  Marker: 'marker',
  'Root marker': 'rootMarker',
  'Admission lock': 'admissionLock',
  'Orphan lease': 'lease'
});
function assertDurableRecord(value, label) {
  const name = value && durableRecordSchemaNames[value.schema];
  const validate = name && canonicalValidators.records[name];
  if (!validate || !validate(value)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'Metadata') + ' does not match the canonical durable-record schema.');
  }
}
function assertDurableSnapshot(value, label) {
  const name = durableRecordReadTypes[label];
  const validate = name && canonicalValidators.records[name];
  if (!validate || !validate(value)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'Metadata') + ' does not match the canonical durable-record schema.');
  }
}
function win(){return process.platform==='win32';}
function identity(s){const dev=String(s.dev),ino=String(s.ino);if(!dev||!ino||ino==='0')throw error('TEMP_OWNERSHIP_UNCERTAIN','Filesystem resource identity is unavailable.');return{dev,ino};}
function sameId(a,b){return Boolean(a&&b&&String(a.dev)===String(b.dev)&&String(a.ino)===String(b.ino));}
function norm(p){p=path.resolve(p);return win()?p.replace(/\//g,'\\').toLowerCase():p;}
function samePath(a,b){return norm(a)===norm(b);}
function within(root,p){const rel=path.relative(root,p);return !rel||(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));}
function contained(root,p){p=path.resolve(p);if(!within(path.resolve(root),p))throw error('TEMP_PATH_ESCAPE','Path escaped the owned root.');return p;}
function chain(p){p=path.resolve(p);const root=path.parse(p).root;let cur=root;const s=fs.lstatSync(root,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())throw error('TEMP_OWNERSHIP_UNCERTAIN','Path root is not an ordinary directory.');for(const part of path.relative(root,p).split(path.sep).filter(Boolean)){cur=path.join(cur,part);let x;try{x=fs.lstatSync(cur,{bigint:true});}catch(e){if(e.code==='ENOENT')break;throw e;}if(!x.isDirectory()||x.isSymbolicLink()){if(cur===p&&x.isFile())return;throw error('TEMP_OWNERSHIP_UNCERTAIN','Path contains a symlink, junction, or non-directory component.');}}}
function realDir(p,label){p=path.resolve(p);chain(p);const real=fs.realpathSync.native(p);if(!samePath(p,real))throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'Directory')+' is a path alias.');const s=fs.lstatSync(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'Directory')+' is not ordinary.');return{path:p,id:identity(s)};}
function dir(p,expected,label){let s;try{s=fs.lstatSync(p,{bigint:true});}catch(e){throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'Directory')+' is missing.',{cause:e});}if(!s.isDirectory()||s.isSymbolicLink())throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'Directory')+' is not ordinary.');const id=identity(s);if(expected&&!sameId(id,expected))throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'Directory')+' identity changed.');if(!samePath(path.resolve(p),fs.realpathSync.native(p)))throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'Directory')+' was substituted.');return id;}
function file(p,expected,label){let s;try{s=fs.lstatSync(p,{bigint:true});}catch(e){throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'File')+' is missing.',{cause:e});}if(!s.isFile()||s.isSymbolicLink())throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'File')+' is not ordinary.');const id=identity(s);if(expected&&!sameId(id,expected))throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'File')+' identity changed.');if(!samePath(path.resolve(p),fs.realpathSync.native(p)))throw error('TEMP_OWNERSHIP_UNCERTAIN',(label||'File')+' was substituted.');return{id,stats:s};}

function extendedWindowsPath(p){if(!win()||p.length<240||p.startsWith('\\\\?\\'))return p;const resolved=path.resolve(p);if(resolved.startsWith('\\\\'))return'\\\\?\\UNC\\'+resolved.slice(2);return'\\\\?\\'+resolved;}
function acl(p,apply){const payload=Buffer.from(JSON.stringify({p:extendedWindowsPath(p),apply})).toString('base64');const script=[
"$ErrorActionPreference='Stop'","$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+payload+"'))|ConvertFrom-Json",
"$p=[string]$d.p","$u=[Security.Principal.WindowsIdentity]::GetCurrent().User",
"if($d.apply){$s=New-Object Security.AccessControl.DirectorySecurity;$s.SetAccessRuleProtection($true,$false);$s.SetOwner($u);$i=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit;$r=[Security.AccessControl.FileSystemRights]::FullControl;$a=[Security.AccessControl.AccessControlType]::Allow;$n=[Security.AccessControl.PropagationFlags]::None;foreach($v in @($u.Value,'S-1-5-18','S-1-5-32-544')){$sid=New-Object Security.Principal.SecurityIdentifier($v);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,$r,$i,$n,$a);[void]$s.AddAccessRule($rule)};[System.IO.Directory]::SetAccessControl($p,$s)}",
"$x=[System.IO.Directory]::GetAccessControl($p)","$rules=@($x.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|%{[pscustomobject]@{sid=$_.IdentityReference.Value;rights=$_.FileSystemRights.ToString();type=$_.AccessControlType.ToString();inherited=$_.IsInherited}})",
"[pscustomobject]@{user=$u.Value;owner=$x.GetOwner([Security.Principal.SecurityIdentifier]).Value;protected=$x.AreAccessRulesProtected;rules=$rules}|ConvertTo-Json -Compress -Depth 4"].join('\n');
const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{input:script,encoding:'utf8',windowsHide:true,timeout:10000});
if(r.error||r.status!==0)throw error('TEMP_OWNERSHIP_UNCERTAIN','Windows ACL check failed.',{diagnostic:String(r.stderr||'ACL query failed').slice(0,300)});
let x;try{x=JSON.parse(r.stdout.trim());}catch(e){throw error('TEMP_OWNERSHIP_UNCERTAIN','Windows ACL response was invalid.',{cause:e});}if(!Array.isArray(x.rules))x.rules=x.rules?[x.rules]:[];return x;}
function privateDir(p,id,base,apply){dir(p,id,'Private directory');if(win()){const x=acl(p,apply===true),allowed=new Set([x.user,'S-1-5-18','S-1-5-32-544']);if(x.owner!==x.user||x.protected!==!!base||x.rules.length!==3)throw error('TEMP_OWNERSHIP_UNCERTAIN','Private ACL does not match the required owner-only policy.');const seen=new Set();for(const a of x.rules){if(!allowed.has(a.sid)||seen.has(a.sid)||a.type!=='Allow'||!String(a.rights).includes('FullControl')||a.inherited===!!base)throw error('TEMP_OWNERSHIP_UNCERTAIN','Private ACL contains an unexpected principal or grant.');seen.add(a.sid);}if([...allowed].some(s=>!seen.has(s)))throw error('TEMP_OWNERSHIP_UNCERTAIN','Private ACL is missing a required principal.');return id;}const s=fs.lstatSync(p,{bigint:true});if(typeof process.getuid!=='function'||Number(s.uid)!==process.getuid()||(Number(s.mode)&0o777)!==0o700||(Number(s.mode)&0o7000)!==0)throw error('TEMP_OWNERSHIP_UNCERTAIN','Private directory ownership or mode is unsafe.');return id;}
function privateFile(p,id,label){const x=file(p,id,label);if(!win()){if(typeof process.getuid!=='function'||Number(x.stats.uid)!==process.getuid()||(Number(x.stats.mode)&0o777)!==0o600||(Number(x.stats.mode)&0o7000)!==0)throw error('TEMP_OWNERSHIP_UNCERTAIN','Private file ownership or mode is unsafe.');}return x.id;}
function processUser(){if(win())return acl(path.resolve(os.tmpdir()),false).user;if(typeof process.getuid==='function')return String(process.getuid());throw error('TEMP_OWNERSHIP_UNCERTAIN','User identity is unavailable.');}
function getProcessStart(pid){if(win()){const s="$ErrorActionPreference='Stop';(Get-Process -Id "+Number(pid)+" -ErrorAction Stop).StartTime.ToUniversalTime().Ticks";const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{input:s,encoding:'utf8',windowsHide:true,timeout:5000});const v=String(r.stdout||'').trim();return !r.error&&r.status===0&&/^\d+$/.test(v)?v:null;}try{const text=fs.readFileSync('/proc/'+pid+'/stat','utf8'),end=text.lastIndexOf(')'),fields=text.slice(end+1).trim().split(/\s+/),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();return fields[19]&&boot?boot+':'+fields[19]:null;}catch(_){return null;}}
function processStatus(pid,start){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return'dead';}const actual=getProcessStart(pid);if(!actual||!start)return'unknown';return actual===start?'live':'mismatched';}
function rootTemp(){const p=path.resolve(os.tmpdir());chain(p);return p;}

function readJson(p, id, label, max = 65536) {
  const verified = privateFile(p, id, label);
  let fd;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY);
    if (!sameId(identity(fs.fstatSync(fd, { bigint: true })), verified)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Metadata changed while opening.');
    }
    const buffer = Buffer.alloc(max + 1);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (count > max) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Metadata exceeds its size limit.');
    const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    assertDurableSnapshot(value, label);
    return { data: value, id: verified };
  } catch (caught) {
    if (caught.code === 'TEMP_OWNERSHIP_UNCERTAIN') throw caught;
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'Metadata') + ' cannot be read safely.', { cause: caught });
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
  }
}
function writeExclusive(p, data, label) {
  assertDurableRecord(data, label);
  const parent = path.dirname(p);
  const parentId = identity(fs.lstatSync(parent, { bigint: true }));
  let fd;
  let id;
  try {
    dir(parent, parentId, (label || 'Metadata') + ' parent');
    fd = fs.openSync(p, 'wx', 0o600);
    if (!win()) fs.fchmodSync(fd, 0o600);
    id = identity(fs.fstatSync(fd, { bigint: true }));
    dir(parent, parentId, (label || 'Metadata') + ' parent');
    if (!sameId(identity(fs.fstatSync(fd, { bigint: true })), id)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'Metadata') + ' changed while opening.');
    }
    fs.writeFileSync(fd, Buffer.from(JSON.stringify(data)));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    dir(parent, parentId, (label || 'Metadata') + ' parent');
    return privateFile(p, id, label);
  } catch (e) {
    if (fd !== undefined) {
      if (!id) {
        try { id = identity(fs.fstatSync(fd, { bigint: true })); } catch (_) {}
      }
      try { fs.closeSync(fd); } catch (_) {}
    }
    let cleanupError;
    if (id) {
      try {
        dir(parent, parentId, (label || 'Metadata') + ' parent');
        file(p, id, label);
        dir(parent, parentId, (label || 'Metadata') + ' parent');
        fs.unlinkSync(p);
      } catch (caught) {
        if (!caught.cause || caught.cause.code !== 'ENOENT') cleanupError = caught;
      }
    }
    const failure = e.code === 'TEMP_OWNERSHIP_UNCERTAIN'
      ? e
      : error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'Metadata') + ' could not be created exclusively.', { cause: e });
    if (cleanupError) {
      failure.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
      failure.cleanupStatus = { status: 'CLEANUP_INCOMPLETE', code: cleanupError.code || 'TEMP_OWNERSHIP_UNCERTAIN' };
    }
    throw failure;
  }
}

function atomicJson(p, data, oldId, expectedParentId = null) {
  assertDurableRecord(data, 'Lease');
  const parent = path.dirname(p);
  const parentId = expectedParentId || identity(fs.lstatSync(parent, { bigint: true }));
  const tmp = p + '.next-' + crypto.randomBytes(12).toString('hex');
  let fd;
  let id;
  let renamed = false;
  try {
    dir(parent, parentId, 'Metadata parent');
    fd = fs.openSync(tmp, 'wx', 0o600);
    if (!win()) fs.fchmodSync(fd, 0o600);
    id = identity(fs.fstatSync(fd, { bigint: true }));
    dir(parent, parentId, 'Metadata parent');
    if (!sameId(identity(fs.fstatSync(fd, { bigint: true })), id)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Temporary metadata changed while opening.');
    }
    fs.writeFileSync(fd, Buffer.from(JSON.stringify(data)));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    dir(parent, parentId, 'Metadata parent');
    if (oldId) privateFile(p, oldId, 'Lease');
    else if (!isMissing(p)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Metadata destination appeared before publication.');
    dir(parent, parentId, 'Metadata parent');
    file(tmp, id, 'Temporary lease');
    fs.renameSync(tmp, p);
    renamed = true;
    dir(parent, parentId, 'Metadata parent');
    return privateFile(p, id, 'Lease');
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    let cleanupError;
    if (id && !renamed) {
      try {
        dir(parent, parentId, 'Metadata parent');
        file(tmp, id, 'Temporary lease');
        dir(parent, parentId, 'Metadata parent');
        fs.unlinkSync(tmp);
      } catch (caught) {
        if (!caught.cause || caught.cause.code !== 'ENOENT') cleanupError = caught;
      }
    }
    const failure = e.code === 'TEMP_OWNERSHIP_UNCERTAIN'
      ? e
      : error('TEMP_OWNERSHIP_UNCERTAIN', 'Lease could not be updated atomically.', { cause: e });
    if (cleanupError) {
      failure.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
      failure.cleanupStatus = { status: 'CLEANUP_INCOMPLETE', code: cleanupError.code || 'TEMP_OWNERSHIP_UNCERTAIN' };
    }
    throw failure;
  }
}
function validateNamespace(ns) {
  dir(ns.temp, ns.tempId, 'Temp root');
  dir(ns.base, ns.baseId, 'Temp namespace');
  file(ns.marker, ns.markerId, 'Namespace marker');
  validateNamespaceMarker(ns);
  dir(ns.claims, ns.claimsId, 'Claims');
  dir(ns.roots, ns.rootsId, 'Roots');
}

function validateNamespaceMarker(ns) {
  const marker = readJson(ns.marker, ns.markerId, 'Namespace marker', 16384).data;
  if (marker.path !== ns.base
      || marker.temp_root !== ns.temp
      || marker.user_identity !== ns.user
      || !sameId(marker.base_identity, ns.baseId)
      || marker.namespace_id !== ns.namespaceId) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Namespace marker identity mismatch.');
  }
}

function namespace(create) {
  if (namespaceCache) {
    validateNamespace(namespaceCache);
    privateDir(namespaceCache.base, namespaceCache.baseId, true, false);
    privateDir(namespaceCache.claims, namespaceCache.claimsId, false, false);
    privateDir(namespaceCache.roots, namespaceCache.rootsId, false, false);
    return namespaceCache;
  }

  const temp = rootTemp();
  const tempId = identity(fs.lstatSync(temp, { bigint: true }));
  const candidate = path.join(temp, NS);
  const markerPath = path.join(candidate, 'namespace.json');
  let base;
  let baseId = null;
  let createdBase = false;
  let markerStagePath = null;
  let markerStageId = null;
  let markerPublished = false;
  let markerObstructed = false;
  let markerPublicationFailed = false;
  const createdChildren = [];

  try {
    dir(temp, tempId, 'Temp root');
    try {
      const stats = fs.lstatSync(candidate, { bigint: true });
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Temp namespace is not an ordinary directory.');
      }
      baseId = identity(stats);
    } catch (caught) {
      if (caught.code !== 'ENOENT') throw caught;
      if (!create) return null;
      dir(temp, tempId, 'Temp root');
      try {
        fs.mkdirSync(candidate, { mode: 0o700 });
        createdBase = true;
      } catch (creationError) {
        if (creationError.code !== 'EEXIST') throw creationError;
        const stats = fs.lstatSync(candidate, { bigint: true });
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Temp namespace changed during creation.');
        }
      }
      const stats = fs.lstatSync(candidate, { bigint: true });
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Temp namespace changed during creation.');
      }
      baseId = identity(stats);
      if (createdBase && !win()) fs.chmodSync(candidate, 0o700);
    }

    base = fs.realpathSync.native(candidate);
    chain(base);
    if (!samePath(candidate, base) || !samePath(base, fs.realpathSync.native(base))) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Canonical temp namespace is unstable.');
    }
    dir(temp, tempId, 'Temp root');
    dir(base, baseId, 'Temp namespace');
    privateDir(base, baseId, true, createdBase);

    const user = processUser();
    const claims = path.join(base, 'claims');
    const roots = path.join(base, 'roots');
    const childRows = [];
    for (const childPath of [claims, roots]) {
      let childId;
      try {
        const stats = fs.lstatSync(childPath, { bigint: true });
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Namespace child is not ordinary.');
        }
        childId = identity(stats);
      } catch (caught) {
        if (caught.code !== 'ENOENT') throw caught;
        if (!createdBase) {
          throw error('TEMP_NAMESPACE_PARTIAL', 'Existing temp namespace is missing a child directory; state was preserved.', { cause: caught });
        }
        dir(base, baseId, 'Temp namespace');
        fs.mkdirSync(childPath, { mode: 0o700 });
        const stats = fs.lstatSync(childPath, { bigint: true });
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Created namespace child changed during initialization.');
        }
        childId = identity(stats);
        createdChildren.push({ path: childPath, id: childId });
        if (!win()) fs.chmodSync(childPath, 0o700);
      }
      privateDir(childPath, childId, false, false);
      childRows.push({ path: childPath, id: childId });
    }

    let namespaceId;
    let markerId;
    if (createdBase) {
      namespaceId = crypto.randomBytes(16).toString('hex');
      markerStagePath = markerPath + '.stage-' + crypto.randomBytes(12).toString('hex');
      markerStageId = writeExclusive(markerStagePath, {
        schema: SCHEMA + '.namespace',
        namespace_id: namespaceId,
        path: base,
        temp_root: temp,
        user_identity: user,
        base_identity: baseId,
        created_at_ms: Date.now()
      }, 'Namespace marker staging');

      dir(temp, tempId, 'Temp root');
      dir(base, baseId, 'Temp namespace');
      for (const child of childRows) dir(child.path, child.id, 'Namespace child');
      file(markerStagePath, markerStageId, 'Namespace marker staging');
      if (!isMissing(markerPath)) {
        markerObstructed = true;
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Namespace marker appeared before publication.');
      }
      dir(temp, tempId, 'Temp root');
      dir(base, baseId, 'Temp namespace');
      file(markerStagePath, markerStageId, 'Namespace marker staging');
      try {
        fs.linkSync(markerStagePath, markerPath);
        markerPublished = true;
      } catch (caught) {
        try {
          markerPublicationFailed = true;
          file(markerPath, markerStageId, 'Published namespace marker');
          markerPublished = true;
        } catch (_) {
          if (!isMissing(markerPath)) markerObstructed = true;
        }
        throw caught;
      }
      markerId = markerStageId;
      dir(base, baseId, 'Temp namespace');
      file(markerPath, markerId, 'Published namespace marker');
      file(markerStagePath, markerId, 'Namespace marker staging');
      dir(base, baseId, 'Temp namespace');
      fs.unlinkSync(markerStagePath);
      dir(base, baseId, 'Temp namespace');
      file(markerPath, markerId, 'Published namespace marker');
    } else {
      let markerFile;
      try { markerFile = file(markerPath, null, 'Namespace marker'); }
      catch (caught) {
        if (caught.cause && caught.cause.code === 'ENOENT') {
          throw error('TEMP_NAMESPACE_PARTIAL', 'Existing temp namespace has no published marker; state was preserved.', { cause: caught });
        }
        throw caught;
      }
      const marker = readJson(markerPath, markerFile.id, 'Namespace marker', 16384);
      if (marker.data.schema !== SCHEMA + '.namespace'
          || marker.data.path !== base
          || marker.data.temp_root !== temp
          || marker.data.user_identity !== user
          || !sameId(marker.data.base_identity, baseId)
          || typeof marker.data.namespace_id !== 'string') {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Namespace marker identity mismatch.');
      }
      namespaceId = marker.data.namespace_id;
      markerId = marker.id;
    }

    const childIds = new Map(childRows.map((child) => [child.path, child.id]));
    const ready = {
      temp, tempId, base, baseId, marker: markerPath, markerId, namespaceId, user,
      claims, claimsId: childIds.get(claims), roots, rootsId: childIds.get(roots)
    };
    validateNamespace(ready);
    privateDir(base, baseId, true, false);
    privateDir(claims, ready.claimsId, false, false);
    privateDir(roots, ready.rootsId, false, false);
    namespaceCache = ready;
    return namespaceCache;
  } catch (cause) {
    if (createdBase && markerStagePath && markerStageId && !markerPublished && !markerObstructed) {
      try {
        dir(base, baseId, 'Partial temp namespace');
        file(markerStagePath, markerStageId, 'Partial namespace marker staging');
        dir(base, baseId, 'Partial temp namespace');
        fs.unlinkSync(markerStagePath);
      } catch (caught) {
        if (!(caught.cause && caught.cause.code === 'ENOENT')) createdChildren.push({ path: markerStagePath, id: markerStageId, residue: true });
      }
    }

    const residue = [];
    if (markerPublished || markerObstructed) {
      residue.push(candidate);
    } else if (createdBase && base && baseId) {
      for (const child of createdChildren.slice().reverse()) {
        if (child.residue) { residue.push(child.path); continue; }
        try {
          dir(base, baseId, 'Partial temp namespace');
          dir(child.path, child.id, 'Partial namespace child');
          if (fs.readdirSync(child.path).length !== 0) {
            throw error('TEMP_NAMESPACE_PARTIAL', 'Partial namespace child is no longer empty.');
          }
          dir(base, baseId, 'Partial temp namespace');
          dir(child.path, child.id, 'Partial namespace child');
          fs.rmdirSync(child.path);
          dir(base, baseId, 'Partial temp namespace');
        } catch (caught) {
          if (!(caught.cause && caught.cause.code === 'ENOENT')) residue.push(child.path);
        }
      }
      try {
        dir(temp, tempId, 'Temp root');
        dir(base, baseId, 'Partial temp namespace');
        if (fs.readdirSync(base).length !== 0) {
          throw error('TEMP_NAMESPACE_PARTIAL', 'Partial temp namespace is no longer empty.');
        }
        dir(temp, tempId, 'Temp root');
        dir(base, baseId, 'Partial temp namespace');
        fs.rmdirSync(base);
        dir(temp, tempId, 'Temp root');
      } catch (caught) {
        if (!(caught.cause && caught.cause.code === 'ENOENT')) residue.push(base);
      }
    }

    if (residue.length) {
      const published = markerPublished || markerObstructed;
      throw error('TEMP_NAMESPACE_PARTIAL', published
        ? 'Namespace publication failed after shared state became visible; state was preserved.'
        : 'Namespace initialization preserved partial state because ownership was not sufficient to remove it.', {
        cause,
        cleanupStatus: { status: published ? 'PUBLISHED_STATE_PRESERVED' : 'PRESERVED_RESIDUE', paths: [...new Set(residue)] }
      });
    }
    if (markerPublicationFailed) {
      throw error('TEMP_NAMESPACE_PARTIAL', 'Namespace marker publication failed before shared state became visible; creator state was removed.', { cause });
    }
    throw cause;
  }
}
function normalize(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw error('TEMP_SPEC_INVALID', 'Owned-temp spec schema is required.');
  }
  let valid = false;
  try { valid = canonicalValidators.spec(spec); } catch (_) {}
  if (!valid) throw error('TEMP_SPEC_INVALID', 'Owned-temp spec does not match the canonical schema.');

  const cap = spec.purpose === 'source-update' ? LIMITS.sourceUpdate
    : spec.purpose === 'portability' ? LIMITS.portability
      : spec.purpose === 'foundation-test' ? LIMITS.foundationTest : 0;
  if (!cap) throw error('TEMP_SPEC_INVALID', 'Owned-temp purpose is invalid.');
  const repo = realDir(spec.repoRoot, 'Repository root');
  const ident = (value, label) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
      throw error('TEMP_SPEC_INVALID', label + ' is invalid.');
    }
    return value;
  };
  const budget = spec.budgetBytes === undefined ? cap : spec.budgetBytes;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > cap) {
    throw error('TEMP_SPEC_INVALID', 'Budget exceeds the purpose limit.');
  }
  if (spec.signal !== undefined
      && (!spec.signal || typeof spec.signal.aborted !== 'boolean' || typeof spec.signal.addEventListener !== 'function')) {
    throw error('TEMP_SPEC_INVALID', 'signal must be an AbortSignal.');
  }

  let retention = null;
  if (spec.retention !== undefined) {
    const value = spec.retention;
    const now = Date.now();
    const expires = Date.parse(value.expiresAt);
    if (!value.reason.trim() || value.reason.length > 512
        || value.maxBytes < 1 || value.maxBytes > LIMITS.retainedBytes
        || !Number.isFinite(expires) || expires <= now || expires - now > LIMITS.retainedMs) {
      throw error('TEMP_SPEC_INVALID', 'Retention must have a bounded reason, owner, size, and expiry.');
    }
    retention = {
      reason: value.reason.trim(),
      owner: ident(value.owner, 'Retention owner'),
      maxBytes: value.maxBytes,
      expiresAtMs: expires
    };
  }
  return {
    purpose: spec.purpose,
    repo,
    episode: ident(spec.episode, 'Episode'),
    runId: ident(spec.runId || crypto.randomBytes(16).toString('hex'), 'Run'),
    lockId: ident(spec.lockId || crypto.randomBytes(16).toString('hex'), 'Lock'),
    budget,
    retention,
    signal: spec.signal || null
  };
}

function claim(ns, spec) {
  const id = crypto.randomBytes(16).toString('hex');
  const cp = path.join(ns.claims, id + '.claim.json');
  const lp = path.join(ns.claims, id + '.lease.json');
  const mp = path.join(ns.claims, id + '.marker.json');
  const rp = path.join(ns.roots, 'root-' + id);
  const created = Date.now();
  if (spec.retention && spec.retention.expiresAtMs <= created) throw error('TEMP_SPEC_INVALID', 'Retention expired before the claim could be created.');
  let fd;
  let cid;
  const c = {
    schema: SCHEMA + '.claim',
    claim_id: id,
    namespace_id: ns.namespaceId,
    namespace_path: ns.base,
    claim_path: cp,
    lease_path: lp,
    marker_path: mp,
    root_path: rp,
    repository: { path: spec.repo.path, identity: spec.repo.id },
    episode: spec.episode,
    run_id: spec.runId,
    lock_id: spec.lockId,
    process: { pid: process.pid, instance_id: processInstance, start_identity: processStart },
    created_at_ms: created,
    purpose: spec.purpose,
    budget_bytes: spec.budget,
    metadata_bytes: LIMITS.metadata,
    reservation_bytes: spec.budget + LIMITS.metadata,
    retention: spec.retention
  };
  let r;
  try {
    validateNamespace(ns);
    dir(ns.claims, ns.claimsId, 'Claims');
    fd = fs.openSync(cp, 'wx', 0o600);
    if (!win()) fs.fchmodSync(fd, 0o600);
    cid = identity(fs.fstatSync(fd, { bigint: true }));
    c.claim_identity = cid;
    dir(ns.claims, ns.claimsId, 'Claims');
    if (!sameId(identity(fs.fstatSync(fd, { bigint: true })), cid)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Claim changed while opening.');
    assertDurableRecord(c, 'Claim');
    fs.writeFileSync(fd, Buffer.from(JSON.stringify(c)));
    dir(ns.claims, ns.claimsId, 'Claims');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    privateFile(cp, cid, 'Claim');
    r = {
      ns, id, cp, lp, mp, rp, c, cid, lid: null, mid: null, rid: null, rmid: null,
      lease: null, spec, bytes: 0, entries: 0, admissionClosed: false, children: new Map(), operations: new Set(),
      closing: false, creator: true, retained: false, retentionRequested: false, live: false,
      mutationTail: Promise.resolve(), mutationOwner: null, mutationSequence: 0, mutationClosed: false,
      taskAbortRequested: false, ownershipFenced: false, profileTerminalFailure: null,
      sourceUpdateAdmitted: false, sourceUpdateSucceeded: false, terminalFailure: null,
      brokerOperations: new Set(), terminalPromise: null, terminalKind: null, terminalReason: null, terminalCommitted: false,
      cleanup: null, abort: new AbortController(), stop: new AbortController(), callbackRunning: false, rootMarkerRemoved: false
    };
    const lease = {
      schema: SCHEMA + '.lease',
      claim_id: id,
      claim_identity: cid,
      status: 'CLAIMED',
      lease_expires_at_ms: created + LIMITS.lease,
      root_identity: null,
      root_marker_identity: null,
      marker_identity: null,
      root_marker_removed: false,
      root_removed: false,
      metadata_cleanup_phase: null,
      bytes_reserved: 0,
      entries: 0,
      reservation_bytes: c.reservation_bytes,
      retention: null,
      owned_children: []
    };
    validateNamespace(ns);
    r.lid = atomicJson(lp, lease, null, ns.claimsId);
    r.lease = lease;
    return r;
  } catch (e) {
    if (fd !== undefined) {
      if (!cid) {
        try { cid = identity(fs.fstatSync(fd, { bigint: true })); } catch (_) {}
      }
      try { fs.closeSync(fd); } catch (_) {}
    }
    let cleanupError;
    if (cid) {
      try {
        const partialLease = readJson(lp, null, 'Partial lease').data;
        if (partialLease.claim_id !== id || !sameId(partialLease.claim_identity, cid)) {
          throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Partial lease does not match its claim.');
        }
        const leaseFile = file(lp, null, 'Partial lease');
        fs.unlinkSync(lp);
        if (leaseFile.id === null) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Partial lease identity is unavailable.');
      } catch (caught) {
        if (!caught.cause || caught.cause.code !== 'ENOENT') cleanupError = caught;
      }
      if (!cleanupError) {
        try {
          file(cp, cid, 'Partial claim');
          fs.unlinkSync(cp);
        } catch (caught) {
          if (!caught.cause || caught.cause.code !== 'ENOENT') cleanupError = caught;
        }
      }
    } else if (fd === undefined) {
      cleanupError = error('TEMP_OWNERSHIP_UNCERTAIN', 'Partial claim identity is unavailable.');
    }
    const failure = e.code === 'TEMP_OWNERSHIP_UNCERTAIN'
      ? e
      : error('TEMP_OWNERSHIP_UNCERTAIN', 'Claim and initial lease could not be created.', { cause: e });
    if (cleanupError) {
      failure.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
      failure.cleanupStatus = { status: 'CLEANUP_INCOMPLETE', code: cleanupError.code || 'TEMP_OWNERSHIP_UNCERTAIN' };
    }
    throw failure;
  }
}
function load(ns, cp) {
  const cfile = readJson(cp, null, 'Claim');
  const c = cfile.data;
  const id = path.basename(cp).replace(/\.claim\.json$/, '');
  if (!/^[a-f0-9]{32}$/.test(id)
      || c.schema !== SCHEMA + '.claim'
      || c.claim_id !== id
      || c.namespace_id !== ns.namespaceId
      || c.namespace_path !== ns.base
      || c.claim_path !== cp
      || !sameId(c.claim_identity, cfile.id)
      || c.lease_path !== path.join(ns.claims, id + '.lease.json')
      || c.marker_path !== path.join(ns.claims, id + '.marker.json')
      || c.root_path !== path.join(ns.roots, 'root-' + id)
      || !within(ns.roots, c.root_path)
      || !Number.isSafeInteger(c.process && c.process.pid)
      || typeof c.created_at_ms !== 'number'
      || !Number.isSafeInteger(c.reservation_bytes)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Claim does not bind exact canonical paths and identity.');
  }
if (c.retention !== null && (!c.retention || typeof c.retention !== 'object'
      || typeof c.retention.reason !== 'string' || !c.retention.reason.trim() || c.retention.reason.length > 512
      || typeof c.retention.owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c.retention.owner)
      || !Number.isSafeInteger(c.retention.maxBytes) || c.retention.maxBytes < 1 || c.retention.maxBytes > LIMITS.retainedBytes
      || !Number.isSafeInteger(c.retention.expiresAtMs)
      || c.retention.expiresAtMs <= c.created_at_ms
      || c.retention.expiresAtMs > c.created_at_ms + LIMITS.retainedMs)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Claim retention metadata is malformed.');
  }
  const lf = file(c.lease_path, null, 'Lease');
  const l = readJson(c.lease_path, lf.id, 'Lease').data;
  const allowedStatuses = new Set([
    'CLAIMED', 'CREATED', 'MARKED', 'ADMITTED', 'ACTIVE', 'TERMINAL',
    'CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED', 'RETAINED'
  ]);
  const persistedIdentity = (value) => value === null || Boolean(value && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.dev === 'string' && value.dev.length > 0
    && typeof value.ino === 'string' && value.ino.length > 0);
  if (l.schema !== SCHEMA + '.lease'
      || l.claim_id !== id
      || !sameId(l.claim_identity, c.claim_identity)
      || !Number.isSafeInteger(l.lease_expires_at_ms)
      || !allowedStatuses.has(l.status)
      || !Number.isSafeInteger(l.bytes_reserved) || l.bytes_reserved < 0 || l.bytes_reserved > c.budget_bytes
      || !Number.isSafeInteger(l.entries) || l.entries < 0 || l.entries > LIMITS.entries
      || !Number.isSafeInteger(l.reservation_bytes) || l.reservation_bytes !== c.reservation_bytes
      || !persistedIdentity(l.root_identity)
      || !persistedIdentity(l.root_marker_identity)
      || !persistedIdentity(l.marker_identity)
      || typeof l.root_marker_removed !== 'boolean'
      || typeof l.root_removed !== 'boolean'
      || ![null, 'MARKER_REMOVAL_PENDING', 'MARKER_REMOVED', 'CLAIM_REMOVAL_PENDING'].includes(l.metadata_cleanup_phase)
      || (l.root_removed && !isMissing(c.root_path))
      || (l.metadata_cleanup_phase !== null && (!l.root_removed || !isMissing(c.root_path)
        || (l.root_identity && !l.root_marker_removed)
        || ((l.metadata_cleanup_phase === 'MARKER_REMOVED' || l.metadata_cleanup_phase === 'CLAIM_REMOVAL_PENDING')
          && !isMissing(c.marker_path))))
      || !Array.isArray(l.owned_children)
      || l.owned_children.length > LIMITS.entries) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Lease is malformed or contains unsupported recovery evidence.');
  }
  for (const child of l.owned_children) {
    if (!/^[a-f0-9]{32}$/.test(child.token)
        || !['STARTING', 'RUNNING'].includes(child.phase)
        || ![true, false].includes(child.process_group)
        || (child.phase === 'STARTING'
          ? child.pid !== null || child.start_identity !== null
          : !Number.isSafeInteger(child.pid) || child.pid < 1
            || !(typeof child.start_identity === 'string' || child.start_identity === null))) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Owned child metadata is malformed.');
    }
  }
  if (l.status === 'RETAINED' || l.retention !== null) {
    const t = l.retention;
    if (!t || typeof t !== 'object'
        || !['RETAINED', 'TERMINAL', 'CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED'].includes(l.status)
        || typeof t.reason !== 'string'
        || typeof t.owner !== 'string'
        || !Number.isSafeInteger(t.max_bytes)
        || !Number.isSafeInteger(t.bytes)
        || !Number.isSafeInteger(t.expires_at_ms)
        || t.expires_at_ms < c.created_at_ms
        || t.expires_at_ms !== c.retention?.expiresAtMs
        || t.reason !== c.retention?.reason
        || t.owner !== c.retention?.owner
        || t.max_bytes !== c.retention?.maxBytes
        || t.bytes > t.max_bytes
        || (l.status === 'RETAINED' && l.lease_expires_at_ms !== t.expires_at_ms)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Retained lease metadata is malformed.');
    }
  }
  const r = {
    ns, id, cp, lp: c.lease_path, mp: c.marker_path, rp: c.root_path, c, cid: c.claim_identity,
    lid: lf.id, mid: l.marker_identity || null, rid: l.root_identity || null,
    rmid: l.root_marker_identity || null, lease: l, spec: null,
    bytes: Number(l.bytes_reserved || 0), entries: Number(l.entries || 0), admissionClosed: false,
    children: new Map(), operations: new Set(), closing: false, creator: false, live: false,
    mutationTail: Promise.resolve(), mutationOwner: null, mutationSequence: 0, mutationClosed: false,
    taskAbortRequested: false, ownershipFenced: false, profileTerminalFailure: null,
    sourceUpdateAdmitted: false, sourceUpdateSucceeded: false, terminalFailure: null,
    brokerOperations: new Set(), terminalPromise: null, terminalKind: null, terminalReason: null, terminalCommitted: false,
    retained: l.status === 'RETAINED', retentionRequested: false, cleanup: null,
    abort: new AbortController(), stop: new AbortController(), callbackRunning: false,
    rootMarkerRemoved: l.root_marker_removed === true
  };
  validate(r);
  return r;
}
function verifyClaim(r){const x=readJson(r.cp,r.cid,'Claim').data;if(x.claim_id!==r.id||x.claim_path!==r.cp||x.root_path!==r.rp||x.lease_path!==r.lp||x.marker_path!==r.mp||!sameId(x.claim_identity,r.cid)||x.namespace_id!==r.ns.namespaceId||x.episode!==r.c.episode||x.run_id!==r.c.run_id||x.lock_id!==r.c.lock_id||x.process.pid!==r.c.process.pid||x.process.instance_id!==r.c.process.instance_id||x.created_at_ms!==r.c.created_at_ms)throw error('TEMP_OWNERSHIP_UNCERTAIN','Claim changed.');return x;}
function readLease(r){const l=readJson(r.lp,r.lid,'Lease').data;if(l.schema!==SCHEMA+'.lease'||l.claim_id!==r.id||!sameId(l.claim_identity,r.cid))throw error('TEMP_OWNERSHIP_UNCERTAIN','Lease does not match claim.');return l;}
function assertMutationOwner(r, owner) {
  if (!owner || owner !== r.mutationOwner || owner[MUTATION_OWNER] !== r) {
    throw error('TEMP_MUTATION_COORDINATOR', 'Owned-temp mutation does not hold the claim coordinator.');
  }
}

function assertMutationAccess(r, owner = null) {
  if (r.mutationOwner) {
    assertMutationOwner(r, owner);
    return;
  }
  if (r.live || owner) {
    throw error('TEMP_MUTATION_COORDINATOR', 'Owned-temp mutation coordinator is not held.');
  }
}

function assertUsable(r) {
  if (!r || !r.live || r.mutationClosed || r.closing || !r.lease
      || r.lease.status !== 'ACTIVE' || r.abort.signal.aborted) {
    throw error('TEMP_LEASE_CLOSED', 'Owned-temp lease is no longer active.');
  }
}

function operation(r, fn) {
  if (typeof fn !== 'function') return Promise.reject(error('TEMP_MUTATION_COORDINATOR', 'Owned-temp operation is invalid.'));
  const scheduled = r.mutationTail.then(async () => {
    if (!r || r.mutationClosed || r.closing) {
      throw error('TEMP_LEASE_CLOSED', 'Owned-temp lease is no longer active.');
    }
    const owner = enterMutation(r, 'public-operation');
    try {
      assertUsable(r);
      assertMutationOwner(r, owner);
      validate(r);
      const result = await fn(owner);
      assertMutationOwner(r, owner);
      validate(r);
      return result;
    } catch (caught) {
      if (caught && (caught.code === 'TEMP_OWNERSHIP_UNCERTAIN'
          || caught.code === 'TEMP_WRITE_FAILED' || caught.code === 'TEMP_COPY_FAILED'
          || (typeof caught.code === 'string' && /^(EACCES|EIO|EROFS|ENOSPC|EMFILE|ENFILE)$/.test(caught.code)))) {
        const ownershipFailure = caught.code === 'TEMP_OWNERSHIP_UNCERTAIN';
        closeMutationAdmission(r, 'owned-temp identity or filesystem operation failed', !ownershipFailure, ownershipFailure);
      }
      throw caught;
    } finally {
      leaveMutation(r, owner);
    }
  });
  let tracked;
  tracked = scheduled.finally(() => { r.operations.delete(tracked); });
  r.operations.add(tracked);
  r.mutationTail = tracked.then(() => undefined, () => undefined);
  return tracked;
}

function trackBrokerOperation(r, childRecord, owner, fn) {
  assertMutationOwner(r, owner);
  if (!childRecord || childRecord.owner !== r || typeof fn !== 'function') {
    return Promise.reject(error('TEMP_CHILD_PROTOCOL', 'Owned report broker operation is invalid.'));
  }
  if (childRecord.closed || childRecord.brokerClosed) {
    return Promise.reject(error('TEMP_CHILD_PROTOCOL', 'Owned report broker is closed.'));
  }
  let tracked;
  tracked = Promise.resolve().then(async () => {
    assertMutationOwner(r, owner);
    const result = await fn();
    assertMutationOwner(r, owner);
    return result;
  }).finally(() => {
    r.brokerOperations.delete(tracked);
    childRecord.brokerOperations.delete(tracked);
  });
  r.brokerOperations.add(tracked);
  childRecord.brokerOperations.add(tracked);
  return tracked;
}

async function waitBrokerOperations(r, owner = null) {
  if (owner) assertMutationOwner(r, owner);
  while (r.brokerOperations.size) {
    await Promise.allSettled([...r.brokerOperations]);
    if (owner) assertMutationOwner(r, owner);
  }
}
function enterMutation(r, kind) {
  if (r.mutationOwner) throw error('TEMP_MUTATION_COORDINATOR', 'Owned-temp mutation coordinator is already held.');
  const owner = Object.freeze({ [MUTATION_OWNER]: r, kind, sequence: ++r.mutationSequence });
  r.mutationOwner = owner;
  return owner;
}

function leaveMutation(r, owner) {
  if (r.mutationOwner === owner) r.mutationOwner = null;
}

function rememberTerminalFailure(r, caught) {
  if (!r.terminalFailure) r.terminalFailure = caught;
  return r.terminalFailure;
}

function closeMutationAdmission(r, reason, taskAbort = true, ownershipFence = false, terminalFailure = null) {
  if (taskAbort) {
    r.taskAbortRequested = true;
    if (terminalFailure) rememberTerminalFailure(r, terminalFailure);
    try { r.abort.abort(reason || 'owned-temp task stopped'); } catch (_) {}
  }
  if (ownershipFence) r.ownershipFenced = true;
  if (r.mutationClosed) return;
  r.mutationClosed = true;
  r.closing = true;
  if (r.timer) clearInterval(r.timer);
  try { r.stop.abort(reason || 'owned-temp mutation stopped'); } catch (_) {}
  for (const child of r.children.values()) void requestStop(child);
}

function setLease(r, patch, owner = null) {
  assertMutationAccess(r, owner);
  validateNamespace(r.ns);
  verifyClaim(r);
  const current = readLease(r);
  const previousBytes = Number(current.bytes_reserved || 0);
  const previousEntries = Number(current.entries || 0);
  const next = { ...current, ...patch, updated_at_ms: Date.now() };
  if (!Number.isSafeInteger(next.bytes_reserved) || next.bytes_reserved < previousBytes
      || !Number.isSafeInteger(next.entries) || next.entries < previousEntries) {
    r.admissionClosed = true;
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Owned-temp accounting must remain monotonic.');
  }
  if (Buffer.byteLength(JSON.stringify(next)) > LIMITS.metadata) {
    r.admissionClosed = true;
    throw error('TEMP_BUDGET_EXCEEDED', 'Owned-temp metadata budget would be exceeded.');
  }
  try {
    r.lid = atomicJson(r.lp, next, r.lid, r.ns.claimsId);
  } catch (caught) {
    r.admissionClosed = true;
    throw caught;
  }
  r.lease = next;
  r.bytes = Math.max(r.bytes, next.bytes_reserved);
  r.entries = Math.max(r.entries, next.entries);
  r.rmid = next.root_marker_identity || r.rmid;
  r.mid = next.marker_identity || r.mid;
  r.rootMarkerRemoved = next.root_marker_removed === true;
  return next;
}

function validate(r, opts = {}) {
  validateNamespace(r.ns);
  const c = verifyClaim(r);
  const l = readLease(r);
  if (l.root_identity) {
    try { dir(r.rp, l.root_identity, 'Owned root'); }
    catch (caught) {
      const missing = caught.cause && caught.cause.code === 'ENOENT';
      const cleaning = ['CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED'].includes(l.status);
      if (!missing || !(opts.allowMissing || l.root_removed || (cleaning && l.root_marker_removed))) throw caught;
    }
  }
  let marker;
  try { marker = readJson(r.mp, l.marker_identity, 'Marker').data; }
  catch (caught) {
    const missing = caught.cause && caught.cause.code === 'ENOENT';
    const partial = r.creator && !l.marker_identity;
    const done = l.root_removed && ['CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED'].includes(l.status);
    if (missing && (partial || done)) return { c, l, m: null };
    throw caught;
  }
  if (marker.schema !== SCHEMA + '.marker'
      || marker.claim_id !== r.id
      || !sameId(marker.claim_identity, r.cid)
      || marker.root_path !== r.rp
      || !sameId(marker.root_identity, l.root_identity)
      || !sameId(marker.root_marker_identity, l.root_marker_identity)
      || marker.repository.path !== c.repository.path
      || !sameId(marker.repository.identity, c.repository.identity)
      || marker.process.instance_id !== c.process.instance_id
      || marker.episode !== c.episode
      || marker.run_id !== c.run_id
      || marker.lock_id !== c.lock_id) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Claim and marker do not match.');
  }
  if (l.root_identity) {
    try {
      const rootMarker = readJson(path.join(r.rp, MARKER), l.root_marker_identity, 'Root marker').data;
      if (JSON.stringify(rootMarker) !== JSON.stringify(marker.root_marker)) {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Root marker content mismatch.');
      }
    } catch (caught) {
      const removable = l.root_marker_removed
        && ['CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED'].includes(l.status)
        && caught.cause && caught.cause.code === 'ENOENT';
      if (!removable) throw caught;
    }
  }
  return { c, l, m: marker };
}
function makeMarker(r){const rootMarker={schema:SCHEMA+'.root-marker',claim_id:r.id,claim_identity:r.cid,namespace_id:r.ns.namespaceId,root_path:r.rp,root_identity:r.rid,repository:r.c.repository,episode:r.c.episode,run_id:r.c.run_id,lock_id:r.c.lock_id,process:r.c.process,created_at_ms:r.c.created_at_ms};r.rmid=writeExclusive(path.join(r.rp,MARKER),rootMarker,'Root marker');const m={schema:SCHEMA+'.marker',claim_id:r.id,claim_identity:r.cid,namespace_id:r.ns.namespaceId,namespace_path:r.ns.base,claim_path:r.cp,root_path:r.rp,root_identity:r.rid,root_marker_identity:r.rmid,root_marker:rootMarker,repository:r.c.repository,episode:r.c.episode,run_id:r.c.run_id,lock_id:r.c.lock_id,process:r.c.process,created_at_ms:r.c.created_at_ms};r.mid=writeExclusive(r.mp,m,'Marker');setLease(r,{status:'MARKED',root_identity:r.rid,root_marker_identity:r.rmid,marker_identity:r.mid});}

async function wait(ms){await new Promise(resolve=>setTimeout(resolve,ms));}
function lockRead(p) {
  try {
    const entry = file(p, null, 'Admission lock');
    const value = readJson(p, entry.id, 'Admission lock', 16384);
    return { data: value.data, id: value.id };
  } catch (caught) {
    if (caught.cause && caught.cause.code === 'ENOENT') return null;
    throw caught;
  }
}

function assertNamespaceOwner(owner, ns) {
  if (!owner || owner[NAMESPACE_OWNER] !== ns || !owner.lock
      || owner.lock.namespace !== ns || owner.lock.released) {
    throw error('TEMP_CAPACITY_UNKNOWN', 'Namespace mutation ownership is missing or stale.');
  }
  validateNamespace(ns);
  const current = readJson(owner.lock.p, owner.lock.id, 'Admission lock', 16384);
  if (current.data.token !== owner.lock.token || !sameId(current.id, owner.lock.id)) {
    throw error('TEMP_CAPACITY_UNKNOWN', 'Admission lock identity changed and was preserved.');
  }
  return owner;
}

async function lockAcquire(ns) {
  const lockPath = path.join(ns.base, 'admission.lock.json');
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const data = {
    schema: SCHEMA + '.lock', token, pid: process.pid, start: processStart,
    created: now, expires: now + 30000
  };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    validateNamespace(ns);
    try {
      const id = writeExclusive(lockPath, data, 'Admission lock');
      const lock = { p: lockPath, token, id, namespace: ns, released: false };
      try {
        validateNamespace(ns);
        return lock;
      } catch (caught) {
        try { lockRelease(lock); }
        catch (cleanup) { caught.cleanupCode = cleanup.code || 'TEMP_CAPACITY_UNKNOWN'; }
        throw caught;
      }
    } catch (caught) {
      if (!((caught.cause && caught.cause.code === 'EEXIST') || caught.code === 'EEXIST')) throw caught;
      validateNamespace(ns);
      const old = lockRead(lockPath);
      if (!old) continue;
      const lock = old.data;
      if (lock.schema !== SCHEMA + '.lock' || typeof lock.token !== 'string'
          || !Number.isSafeInteger(lock.pid) || !Number.isSafeInteger(lock.created)
          || !Number.isSafeInteger(lock.expires) || lock.expires < lock.created) {
        throw error('TEMP_CAPACITY_UNKNOWN', 'Admission lock is ambiguous and was preserved.');
      }
      const owner = processStatus(lock.pid, lock.start);
      validateNamespace(ns);
      const current = lockRead(lockPath);
      if (!current || !sameId(current.id, old.id) || current.data.token !== lock.token) continue;
      validateNamespace(ns);
      if (owner === 'unknown') {
        throw error('TEMP_CAPACITY_UNKNOWN', 'Admission lock owner is uncertain and the lock was preserved.');
      }
      if ((owner === 'dead' || owner === 'mismatched') && lock.expires <= Date.now()) {
        throw error('TEMP_CAPACITY_UNKNOWN', 'Expired admission lock is preserved; stale takeover is disabled.');
      }
      await wait(25);
    }
  }
  throw error('TEMP_CAPACITY_UNKNOWN', 'Timed out waiting for admission lock.');
}

function lockRelease(lock) {
  const ns = lock && lock.namespace;
  if (!ns || lock.released) throw error('TEMP_CAPACITY_UNKNOWN', 'Admission lock ownership is missing or already released.');
  validateNamespace(ns);
  const current = readJson(lock.p, lock.id, 'Admission lock');
  if (current.data.token !== lock.token || !sameId(current.id, lock.id)) {
    throw error('TEMP_CAPACITY_UNKNOWN', 'Admission lock changed and was preserved.');
  }
  validateNamespace(ns);
  file(lock.p, lock.id, 'Admission lock');
  validateNamespace(ns);
  fs.unlinkSync(lock.p);
  validateNamespace(ns);
  lock.released = true;
}

async function locked(ns, fn, owner = null) {
  if (owner) {
    assertNamespaceOwner(owner, ns);
    return fn(owner);
  }
  const lock = await lockAcquire(ns);
  const context = Object.freeze({ [NAMESPACE_OWNER]: ns, lock });
  let value;
  let primary;
  try { assertNamespaceOwner(context, ns); value = await fn(context); assertNamespaceOwner(context, ns); } catch (caught) { primary = caught; }
  try { lockRelease(lock); }
  catch (caught) {
    if (primary) primary.lockReleaseCode = caught.code || 'TEMP_CAPACITY_UNKNOWN';
    else primary = caught;
  }
  if (primary) throw primary;
  return value;
}
function claimPaths(ns){const names=fs.readdirSync(ns.claims).filter(n=>/^[a-f0-9]{32}\.claim\.json$/.test(n)).sort();if(names.length>LIMITS.recoveryRecords)throw error('TEMP_CAPACITY_UNKNOWN','Claim inventory exceeds its limit.');return names.map(n=>path.join(ns.claims,n));}
function orphanLeaseInventory(ns) {
  const names = fs.readdirSync(ns.claims).filter((name) => name.endsWith('.lease.json')).sort();
  if (names.length > LIMITS.recoveryRecords) throw error('TEMP_CAPACITY_UNKNOWN', 'Lease inventory exceeds its limit.');
  const rows = [];
  for (const name of names) {
    const match = /^([a-f0-9]{32})\.lease\.json$/.exec(name);
    if (!match) { rows.push({ path: path.join(ns.claims, name), id: null, malformed: true }); continue; }
    const id = match[1];
    const claimPath = path.join(ns.claims, id + '.claim.json');
    if (!isMissing(claimPath)) continue;
    rows.push({ path: path.join(ns.claims, name), id, malformed: false });
  }
  return rows;
}
async function recoverOrphanLease(ns, row, namespaceOwner) {
  if (row.malformed || !row.id) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Malformed orphan lease name is preserved.');
  dir(ns.claims, ns.claimsId, 'Claims');
  const leaseFile = file(row.path, null, 'Orphan lease');
  const lease = readJson(row.path, leaseFile.id, 'Orphan lease').data;
  const id = row.id;
  const claimPath = path.join(ns.claims, id + '.claim.json');
  const markerPath = path.join(ns.claims, id + '.marker.json');
  const rootPath = path.join(ns.roots, 'root-' + id);
  if (lease.schema !== SCHEMA + '.lease' || lease.claim_id !== id
      || !lease.claim_identity || typeof lease.claim_identity.dev !== 'string' || typeof lease.claim_identity.ino !== 'string'
      || lease.status !== 'REMOVED' || lease.root_removed !== true
      || lease.metadata_cleanup_phase !== 'CLAIM_REMOVAL_PENDING'
      || !Array.isArray(lease.owned_children) || lease.owned_children.length !== 0
      || (lease.root_identity && lease.root_marker_removed !== true)
      || !Number.isSafeInteger(lease.reservation_bytes) || lease.reservation_bytes < 1
      || !Number.isSafeInteger(lease.bytes_reserved) || lease.bytes_reserved < 0
      || !isMissing(claimPath) || !isMissing(markerPath) || !isMissing(rootPath)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Orphan lease lacks complete durable metadata-cleanup evidence.');
  }
  dir(ns.claims, ns.claimsId, 'Claims');
  await unlinkMetadataWithRetry(ns, row.path, leaseFile.id, 'Orphan lease', namespaceOwner);
  return { status: 'REMOVED', claimId: id, metadataOnly: true };
}
function inventory(ns, exclude) {
  const orphans = orphanLeaseInventory(ns);
  if (orphans.length) throw error('TEMP_CAPACITY_UNKNOWN', 'Orphan or malformed lease metadata is preserved.', { orphans: orphans.length });
  let total = 0n;
  let roots = 0;
  let retained = 0;
  for (const claimPath of claimPaths(ns)) {
    let record;
    try { record = load(ns, claimPath); }
    catch (caught) { throw error('TEMP_CAPACITY_UNKNOWN', 'Claim inventory is ambiguous.', { cause: caught }); }
    if (record.id === exclude) continue;
    total += BigInt(record.lease.reservation_bytes);
    if (record.lease.status !== 'REMOVED') roots += 1;
    if (record.lease.status === 'RETAINED') retained += 1;
  }
  return { total, roots, retained };
}
function capacity(root){let s;try{s=fs.statfsSync(root,{bigint:true});}catch(e){throw error('TEMP_CAPACITY_UNKNOWN','Actual temp-volume capacity is unavailable.',{cause:e});}if(s.bavail===undefined||s.bsize===undefined)throw error('TEMP_CAPACITY_UNKNOWN','Filesystem capacity result is incomplete.');return BigInt(s.bavail)*BigInt(s.bsize);}
function admit(ns,r){const other=inventory(ns,r.id),own=BigInt(r.c.reservation_bytes),sum=other.total+own;if(other.roots+1>LIMITS.roots||sum>BigInt(LIMITS.aggregate))throw error('TEMP_CAPACITY_LOW','Owned-temp reservation limit would be exceeded.');if(other.retained+(r.spec.retention?1:0)>LIMITS.retained)throw error('TEMP_CAPACITY_LOW','Retained-root limit would be exceeded.');const available=capacity(r.rp),required=BigInt(LIMITS.headroom)+sum;if(available<required)throw error('TEMP_CAPACITY_LOW','Temporary volume is below the required headroom.',{availableBytes:Number(available),requiredBytes:Number(required),otherReservations:Number(other.total),requiredBytesTotal:Number(required)});}

function parentDirs(r, parts, owner = null) {
  let p = r.rp;
  for (let i = 0; i < parts.length - 1; i += 1) {
    p = path.join(p, parts[i]);
    ensureDir(r, p, i + 1, owner);
  }
  return p;
}

function growthBudgetError(r, message, details) {
  if (r) r.admissionClosed = true;
  return error('TEMP_BUDGET_EXCEEDED', message, details);
}

function leasePath(r, value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw error('TEMP_PATH_ESCAPE', 'Use a relative owned-temp path.');
  }
  const parts = value.split(/[\/]+/);
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw error('TEMP_PATH_ESCAPE', 'Path has a traversal component.');
  }
  const p = contained(r.rp, path.resolve(r.rp, ...parts));
  return { p, parts };
}

function snapshotParents(r, parts) {
  let p = r.rp;
  const parents = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    p = contained(r.rp, path.join(p, parts[i]));
    const id = dir(p, null, 'Owned path parent');
    parents.push({ path: p, id });
  }
  return parents;
}

function revalidateParents(r, parents) {
  validate(r);
  for (const parent of parents) dir(parent.path, parent.id, 'Owned path parent');
}

function assertGrowthAllowed(r, owner = null) {
  assertMutationAccess(r, owner);
  const constructing = r.creator && r.lease && r.lease.status === 'ADMITTED';
  if (!constructing) assertUsable(r);
  if (r.admissionClosed) throw error('TEMP_BUDGET_EXCEEDED', 'Owned-temp growth admission is closed.');
}

function reserveEntries(r, count = 1, owner = null) {
  assertGrowthAllowed(r, owner);
  if (!Number.isSafeInteger(count) || count < 0 || r.entries + count > LIMITS.entries) {
    r.admissionClosed = true;
    throw error('TEMP_BUDGET_EXCEEDED', 'Maximum entry count exceeded.');
  }
  if (!count) return;
  try { setLease(r, { entries: r.entries + count }, owner); }
  catch (caught) { r.admissionClosed = true; throw caught; }
}

function ensureDir(r, p, depth, owner = null) {
  assertGrowthAllowed(r, owner);
  contained(r.rp, p);
  if (depth > LIMITS.depth) throw growthBudgetError(r, 'Maximum directory depth exceeded.');
  const parent = path.dirname(p);
  const parentId = dir(parent, null, 'Owned directory parent');
  let exists = false;
  try {
    const stats = fs.lstatSync(p, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Owned path component is not a directory.');
    }
    exists = true;
  } catch (caught) {
    if (caught.code !== 'ENOENT') throw caught;
  }
  if (!exists) {
    validate(r);
    dir(parent, parentId, 'Owned directory parent');
    reserveEntries(r, 1, owner);
    dir(parent, parentId, 'Owned directory parent');
    fs.mkdirSync(p, { mode: 0o700 });
    dir(parent, parentId, 'Owned directory parent');
    if (!win()) fs.chmodSync(p, 0o700);
  }
  const id = dir(p, null, 'Owned directory');
  if (win()) privateDir(p, id, false, false);
  return id;
}

function charge(r, amount, owner = null) {
  assertGrowthAllowed(r, owner);
  if (!Number.isSafeInteger(amount) || amount < 0 || r.bytes + amount > r.c.budget_bytes) {
    r.admissionClosed = true;
    throw error('TEMP_BUDGET_EXCEEDED', 'Owned-temp reserved byte allowance would be exceeded.', {
      usedBytes: r.bytes, requestedBytes: amount, budgetBytes: r.c.budget_bytes
    });
  }
  try { setLease(r, { bytes_reserved: r.bytes + amount }, owner); }
  catch (caught) { r.admissionClosed = true; throw caught; }
}

async function writeFile(r, rel, data, append = false, precharged = false, owner = null, retainDescriptor = false) {
  assertGrowthAllowed(r, owner);
  validate(r);
  const target = leasePath(r, rel);
  if (target.parts.length > LIMITS.depth) throw growthBudgetError(r, 'Maximum path depth exceeded.');
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (bytes.length > LIMITS.file) throw growthBudgetError(r, 'Maximum file size exceeded.');
  let existing = null;
  let parents;
  if (append) {
    parents = snapshotParents(r, target.parts);
    revalidateParents(r, parents);
    existing = file(target.p, null, 'Append target');
    if (Number(existing.stats.size) + bytes.length > LIMITS.file) {
      throw growthBudgetError(r, 'Maximum file size exceeded.');
    }
  }
  if (!precharged) charge(r, bytes.length, owner);
  if (!append) reserveEntries(r, 1, owner);
  const parent = append ? path.dirname(target.p) : parentDirs(r, target.parts, owner);
  if (!parents) parents = snapshotParents(r, target.parts);
  revalidateParents(r, parents);
  dir(parent, parents.length ? parents[parents.length - 1].id : r.lease.root_identity, 'Owned file parent');
  let fd;
  let fileId;
  let retainedFd;
  let retainOpenedDescriptor = false;
  try {
    revalidateParents(r, parents);
    dir(parent, parents.length ? parents[parents.length - 1].id : r.lease.root_identity, 'Owned file parent');
    fd = fs.openSync(target.p, append ? 'a' : 'wx', 0o600);
    fileId = identity(fs.fstatSync(fd, { bigint: true }));
    if (append && !sameId(fileId, existing.id)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Append target changed while opening.');
    }
    if (!append) file(target.p, fileId, 'New owned file');
    revalidateParents(r, parents);
    dir(parent, parents.length ? parents[parents.length - 1].id : r.lease.root_identity, 'Owned file parent');
    if (!sameId(identity(fs.fstatSync(fd, { bigint: true })), fileId)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Opened owned file identity changed before payload write.');
    }
    for (let offset = 0; offset < bytes.length; offset += LIMITS.chunk) {
      const part = bytes.subarray(offset, Math.min(bytes.length, offset + LIMITS.chunk));
      let written = 0;
      while (written < part.length) {
        const count = fs.writeSync(fd, part, written, part.length - written);
        if (!count) throw error('TEMP_WRITE_FAILED', 'Write stalled.');
        written += count;
      }
    }
    fs.fsyncSync(fd);
    revalidateParents(r, parents);
    file(target.p, fileId, 'Written owned file');
    retainOpenedDescriptor = retainDescriptor;
  } finally {
    if (fd !== undefined) {
      const closing = fd;
      fd = undefined;
      if (retainOpenedDescriptor) retainedFd = closing;
      else fs.closeSync(closing);
    }
  }
  try {
    revalidateParents(r, parents);
    dir(parent, parents.length ? parents[parents.length - 1].id : r.lease.root_identity, 'Owned file parent');
    file(target.p, fileId, retainDescriptor ? 'Written owned file after write' : 'Written owned file after close');
    if (retainedFd !== undefined && !sameId(identity(fs.fstatSync(retainedFd, { bigint: true })), fileId)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Opened owned file identity changed after write.');
    }
    return {
      path: target.p,
      bytes: bytes.length,
      identity: fileId,
      ...(retainedFd === undefined ? {} : { descriptor: retainedFd })
    };
  } catch (caught) {
    if (retainedFd !== undefined) {
      try { fs.closeSync(retainedFd); } catch (_) {}
    }
    throw caught;
  }
}

function planCopy(source, filter, growthRecord = null) {
  const src = realDir(source, 'Copy source');
  const list = [];
  let total = 0;
  function walk(dirPath, rel, depth) {
    for (const name of fs.readdirSync(dirPath).sort()) {
      const sourcePath = path.join(dirPath, name);
      if (filter && filter(sourcePath) === false) continue;
      const stats = fs.lstatSync(sourcePath, { bigint: true });
      if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Copy source has a symlink or special object.');
      }
      const relative = rel ? path.join(rel, name) : name;
      if (depth + 1 > LIMITS.depth || list.length + 1 > LIMITS.entries) {
        throw growthBudgetError(growthRecord, 'Copy source exceeds depth or entry limits.');
      }
      if (stats.isDirectory()) {
        list.push({ s: sourcePath, rp: relative, type: 'dir', id: identity(stats) });
        walk(sourcePath, relative, depth + 1);
      } else {
        const size = Number(stats.size);
        if (!Number.isSafeInteger(size) || size > LIMITS.file) {
          throw growthBudgetError(growthRecord, 'Copy source file exceeds size limit.');
        }
        total += size;
        list.push({ s: sourcePath, rp: relative, type: 'file', id: identity(stats), size });
      }
    }
  }
  walk(src.path, '', 0);
  return { src, list, total };
}

function verifyCopySource(plan, item) {
  dir(plan.src.path, plan.src.id, 'Copy source root');
  for (const ancestor of plan.list) {
    if (ancestor.type !== 'dir') continue;
    if (item.rp === ancestor.rp || item.rp.startsWith(ancestor.rp + path.sep)) {
      dir(ancestor.s, ancestor.id, 'Copy source ancestor');
    }
  }
  const stats = fs.lstatSync(item.s, { bigint: true });
  if (item.type === 'dir') {
    if (!stats.isDirectory() || stats.isSymbolicLink() || !sameId(identity(stats), item.id)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Copy source directory changed after preflight.');
    }
  } else if (!stats.isFile() || stats.isSymbolicLink()
      || !sameId(identity(stats), item.id) || Number(stats.size) !== item.size) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Copy source file changed after preflight.');
  }
}

async function copyTree(r, source, options = {}, owner = null) {
  assertGrowthAllowed(r, owner);
  validate(r);
  if (Object.keys(options).some((key) => key !== 'filter')) {
    throw error('TEMP_SPEC_INVALID', 'Unsupported copy option.');
  }
  const plan = planCopy(source, options.filter, r);
  if (within(plan.src.path, r.rp) || within(r.rp, plan.src.path)) {
    throw error('TEMP_PATH_ESCAPE', 'Copy roots overlap.');
  }
  if (r.entries + plan.list.length > LIMITS.entries) {
    throw growthBudgetError(r, 'Copy exceeds the remaining entry allowance.');
  }
  charge(r, plan.total, owner);
  const directories = plan.list.filter((item) => item.type === 'dir')
    .sort((a, b) => a.rp.split(path.sep).length - b.rp.split(path.sep).length);
  for (const item of directories) {
    assertGrowthAllowed(r, owner);
    verifyCopySource(plan, item);
    const target = leasePath(r, item.rp);
    const parent = parentDirs(r, target.parts, owner);
    const parents = snapshotParents(r, target.parts);
    revalidateParents(r, parents);
    ensureDir(r, target.p, target.parts.length, owner);
    revalidateParents(r, parents);
    dir(parent, parents.length ? parents[parents.length - 1].id : r.lease.root_identity, 'Copy destination parent');
  }
  for (const item of plan.list) {
    assertGrowthAllowed(r, owner);
    verifyCopySource(plan, item);
    if (item.type !== 'file') continue;
    const target = leasePath(r, item.rp);
    const parent = parentDirs(r, target.parts, owner);
    const parents = snapshotParents(r, target.parts);
    revalidateParents(r, parents);
    reserveEntries(r, 1, owner);
    let input;
    let output;
    let outputId;
    try {
      verifyCopySource(plan, item);
      input = await fs.promises.open(item.s, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      revalidateParents(r, parents);
      verifyCopySource(plan, item);
      const inputStats = await input.stat({ bigint: true });
      revalidateParents(r, parents);
      verifyCopySource(plan, item);
      if (!sameId(identity(inputStats), item.id) || Number(inputStats.size) !== item.size) {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Copy source changed while opening.');
      }
      revalidateParents(r, parents);
      dir(parent, parents.length ? parents[parents.length - 1].id : r.lease.root_identity, 'Copy destination parent');
      output = await fs.promises.open(target.p, 'wx', 0o600);
      revalidateParents(r, parents);
      outputId = identity(await output.stat({ bigint: true }));
      revalidateParents(r, parents);
      file(target.p, outputId, 'Copy destination');
      let position = 0;
      const buffer = Buffer.alloc(LIMITS.chunk);
      while (position < item.size) {
        assertGrowthAllowed(r, owner);
        verifyCopySource(plan, item);
        revalidateParents(r, parents);
        const read = await input.read(buffer, 0, Math.min(buffer.length, item.size - position), position);
        assertGrowthAllowed(r, owner);
        verifyCopySource(plan, item);
        revalidateParents(r, parents);
        if (!read.bytesRead) throw error('TEMP_COPY_FAILED', 'Source ended during copy.');
        let offset = 0;
        while (offset < read.bytesRead) {
          assertGrowthAllowed(r, owner);
          verifyCopySource(plan, item);
          revalidateParents(r, parents);
          file(target.p, outputId, 'Copy destination');
          const written = await output.write(buffer, offset, read.bytesRead - offset);
          assertGrowthAllowed(r, owner);
          verifyCopySource(plan, item);
          revalidateParents(r, parents);
          if (!sameId(identity(await output.stat({ bigint: true })), outputId)) {
            throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Opened copy destination identity changed.');
          }
          file(target.p, outputId, 'Copy destination');
          if (!written.bytesWritten) throw error('TEMP_WRITE_FAILED', 'Copy write stalled.');
          offset += written.bytesWritten;
        }
        position += read.bytesRead;
      }
      await output.sync();
      assertGrowthAllowed(r, owner);
      verifyCopySource(plan, item);
      revalidateParents(r, parents);
      file(target.p, outputId, 'Copy destination');
      const after = await input.stat({ bigint: true });
      verifyCopySource(plan, item);
      if (!sameId(identity(after), item.id) || Number(after.size) !== item.size) {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Copy source changed during copy.');
      }
      await input.close();
      input = null;
      await output.close();
      output = null;
      revalidateParents(r, parents);
      verifyCopySource(plan, item);
      file(target.p, outputId, 'Copy destination after close');
    } finally {
      if (input) await input.close();
      if (output) await output.close();
    }
  }
  return { entries: plan.list.length, bytes: plan.total };
}
function childEnvironment(r, profile, token) {
  const allowed = new Set([
    'PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'GITHUB_TOKEN', 'GH_TOKEN',
    'SOURCE_WATCH_GITHUB_API_BASE_URL', 'SOURCE_WATCH_GITHUB_TOKEN'
  ]);
  const env = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.TEMP = r.ct;
  env.TMP = r.ct;
  env.TMPDIR = r.ct;
  env.TOOLKIT_WORKSPACE_ROOT = profile === 'skill-portability' ? r.rp : path.join(r.rp, 'workspace');
  if (profile === 'source-update') {
    env.TOOLKIT_OWNED_TEMP_MODE = 'source-update-v1';
    env.TOOLKIT_OWNED_TEMP_REPORT_TOKEN = token;
  }
  return env;
}
function signalChild(rec, signal) {
  if (!rec || !rec.child) return;
  if (!win() && rec.group && rec.pid) {
    try {
      const current = getProcessStart(rec.pid);
      if (current !== null && rec.start !== null && current === rec.start) {
        try { process.kill(-rec.pid, signal); }
        catch (caught) { if (caught.code !== 'ESRCH') rec.signalError = caught; }
      }
    } catch (caught) { rec.signalError = caught; }
  }
  try { if (!rec.closed) rec.child.kill(signal); }
  catch (caught) { if (!rec.signalError) rec.signalError = caught; }
}
function groupAlive(rec) {
  if (win() || !rec.group || !rec.pid) return !rec.closed;
  const current = getProcessStart(rec.pid);
  if (current !== null && rec.start !== null && current !== rec.start) return true;
  try { process.kill(-rec.pid, 0); return true; }
  catch (caught) { return caught.code !== 'ESRCH'; }
}
function terminateRecord(rec, grace = 1000) {
  if (rec.termination) return rec.termination;
  const pending = (async () => {
    try {
      signalChild(rec, 'SIGTERM');
      await Promise.race([rec.done, wait(grace)]);
      if (!rec.closed || groupAlive(rec)) signalChild(rec, 'SIGKILL');
      await Promise.race([rec.done, wait(grace)]);
      return rec.closed && !groupAlive(rec);
    } catch (caught) {
      rec.terminationError = caught;
      return false;
    }
  })();
  rec.termination = pending;
  pending.then((closed) => { if (!closed && rec.termination === pending) rec.termination = null; });
  return pending;
}
function requestStop(rec) {
  const pending = terminateRecord(rec);
  pending.then((closed) => {
    if (rec.resolveStop) { rec.resolveStop(closed); rec.resolveStop = null; }
  }, (caught) => {
    rec.terminationError = caught;
    if (rec.resolveStop) { rec.resolveStop(false); rec.resolveStop = null; }
  });
  return pending;
}
function recordChild(r, token, patch, owner) {
  assertMutationAccess(r, owner);
  const rows = r.lease.owned_children || [];
  const index = rows.findIndex((row) => row.token === token);
  if (index < 0) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Owned child claim disappeared.');
  const next = rows.slice();
  if (patch === null) next.splice(index, 1);
  else next[index] = { ...next[index], ...patch };
  setLease(r, { owned_children: next }, owner);
}

function startOwnedChild(r, owner) {
  assertMutationOwner(r, owner);
  assertGrowthAllowed(r, owner);
  const token = crypto.randomBytes(16).toString('hex');
  const rows = r.lease.owned_children || [];
  if (rows.length >= LIMITS.entries) throw growthBudgetError(r, 'Owned child metadata limit exceeded.');
  setLease(r, {
    owned_children: [...rows, {
      phase: 'STARTING', pid: null, process_group: !win(),
      start_identity: null, token
    }]
  }, owner);
  return token;
}

function clearOwnedChild(r, token, owner) {
  const child = (r.lease.owned_children || []).find((row) => row.token === token);
  if (!child) return true;
  if (!win() && child.process_group) {
    const tracked = [...r.children.values()].find((record) => record.token === token);
    const protection = child.phase === 'RUNNING'
      ? { group: true, pid: child.pid, start: child.start_identity, closed: true } : tracked;
    if (protection && groupAlive(protection)) {
      if (child.phase === 'STARTING' && tracked && tracked.pid) {
        try { recordChild(r, token, { phase: 'RUNNING', pid: tracked.pid, start_identity: tracked.start }, owner); }
        catch (caught) { latchChildPersistenceFailure(tracked, caught, 'child-start-retirement'); }
      }
      return false;
    }
  }
  recordChild(r, token, null, owner);
  return true;
}

function noteChildEvent(rec, type) {
  rec.eventOrder = (rec.eventOrder || 0) + 1;
  rec.lastEvent = { order: rec.eventOrder, type, at: Date.now() };
  return rec.eventOrder;
}

function latchChildFailure(rec, caught, kind) {
  const eventOrder = noteChildEvent(rec, 'failure:' + kind);
  if (!rec.failure) {
    rec.failure = { error: caught, kind, eventOrder };
    if (!rec.primary) rec.primary = rec.failure;
    const r = rec.owner;
    if (rec.profile === 'source-update' && r && r.sourceUpdateAdmitted
        && !r.sourceUpdateSucceeded && !r.profileTerminalFailure) {
      r.profileTerminalFailure = rec.failure.error;
      rememberTerminalFailure(r, rec.failure.error);
    }
  }
  return rec.failure.error;
}

function latchChildOutcome(rec, caught, kind) {
  const eventOrder = noteChildEvent(rec, 'outcome:' + kind);
  if (!rec.outcome) {
    rec.outcome = { error: caught, kind, eventOrder };
    if (!rec.primary) rec.primary = rec.outcome;
  }
  return rec.outcome.error;
}

function latchChildPersistenceFailure(rec, caught, kind) {
  const eventOrder = noteChildEvent(rec, 'persistence-failure:' + kind);
  if (!rec.persistError) {
    rec.persistError = caught;
    rec.persistErrorEventOrder = eventOrder;
    rec.persistResolved = false;
  }
  return rec.persistError;
}

function confirmChildPersistence(r, rec, token) {
  if (rec.persistError && !(r.lease.owned_children || []).some((row) => row.token === token)) {
    rec.persistResolved = true;
  }
}

function childTerminalError(r, rec, chunks) {
  const primary = rec.primary || rec.failure || rec.outcome;
  const persistenceFirst = rec.persistError
    && (!primary || rec.persistErrorEventOrder < primary.eventOrder);
  if (persistenceFirst) {
    if (!rec.persistResolved) {
      closeMutationAdmission(r, 'owned child termination evidence could not be persisted', false, true);
    }
    return error('TEMP_OWNERSHIP_UNCERTAIN', 'Owned child termination evidence could not be persisted.', {
      cause: rec.persistError
    });
  }
  if (!primary) return null;
  const caught = primary.error;
  if (primary.kind === 'child-close' && caught.code === 'TEMP_CHILD_FAILED') {
    caught.stdout = Buffer.concat(chunks.stdout).toString('utf8');
    caught.stderr = Buffer.concat(chunks.stderr).toString('utf8');
  }
  if (rec.persistError) {
    closeMutationAdmission(r, 'owned child termination evidence could not be persisted', false, true);
    caught.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
    caught.cleanupStatus = { status: 'CLEANUP_INCOMPLETE', code: 'TEMP_OWNERSHIP_UNCERTAIN' };
    caught.cleanupCause = rec.persistError;
  }
  return caught;
}

function spawnProfileChild(r, profile, token, owner) {
  assertMutationOwner(r, owner);
  validateNamespace(r.ns);
  const repository = r.c.repository.path;
  dir(repository, r.c.repository.identity, 'Child profile repository');
  const source = path.join(repository, 'repo', 'scripts',
    profile === 'skill-portability' ? 'audit-skill-portability.cjs' : 'check-project-source-updates.cjs');
  file(source, null, 'Frozen child profile script');
  const args = [source];
  const stdio = profile === 'source-update'
    ? ['ignore', 'pipe', 'pipe', 'ipc']
    : ['ignore', 'pipe', 'pipe'];
  if (profile === 'source-update') args.push('--workspace', path.join(r.rp, 'workspace'));
  const options = {
    cwd: r.rp,
    env: childEnvironment(r, profile, token),
    shell: false,
    detached: !win(),
    windowsHide: true,
    stdio,
    ...(profile === 'source-update' ? { serialization: 'advanced' } : {})
  };
  const childToken = startOwnedChild(r, owner);
  let child;
  try {
    validate(r);
    dir(repository, r.c.repository.identity, 'Child profile repository');
    file(source, null, 'Frozen child profile script');
    child = spawnProcess(process.execPath, args, options);
  } catch (caught) {
    try { clearOwnedChild(r, childToken, owner); }
    catch (cleanup) { caught.cleanupCode = cleanup.code || 'TEMP_OWNERSHIP_UNCERTAIN'; }
    throw error('TEMP_CHILD_SPAWN_FAILED', 'Owned child profile could not be spawned.', { cause: caught });
  }
  const record = {
    child, pid: null, group: !win(), start: null, closed: false, termination: null,
    owner: r, token: childToken, mutationContext: owner,
    persistError: null, persistErrorEventOrder: null, persistResolved: false,
    primary: null, operationalError: null, brokerOperations: new Set(),
    brokerClosed: false, profile, phase: profile === 'source-update' ? 'SPAWNING' : null,
    eventOrder: 0, failure: null, outcome: null, reportSettled: false,
    terminalConsumed: false, acknowledgementAttempted: false
  };
  record.stopSignal = new Promise((resolve) => { record.resolveStop = resolve; });
  record.done = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      const previousPhase = record.phase;
      noteChildEvent(record, 'close');
      record.closed = true;
      record.exit = { code, signal };
      record.closePhase = previousPhase;
      if (profile === 'source-update' && !record.failure) {
        let caught = null;
        if (previousPhase === 'ACK_SENT' && code !== 0) {
          caught = error('TEMP_CHILD_FAILED', 'Owned child exited unsuccessfully after acknowledgement.', { exitCode: code, signal });
        } else if (previousPhase === 'SPAWNING' || previousPhase === 'ADMITTING') {
          caught = error('TEMP_CHILD_FAILED_BEFORE_ADMISSION', 'Owned child closed before broker admission.', { exitCode: code, signal });
        } else if (previousPhase === 'REQUEST_ACCEPTED' || previousPhase === 'PARENT_EFFECT_SETTLED') {
          caught = error('TEMP_CHILD_DISCONNECTED_BEFORE_ACK', 'Owned child closed before report acknowledgement.', { exitCode: code, signal });
        } else if (previousPhase === 'READY' && ((code !== 0 && code !== null) || signal)) {
          caught = error('TEMP_CHILD_FAILED', 'Owned source-update child exited before its terminal report request.', { exitCode: code, signal });
        } else if (previousPhase !== 'ACK_SENT') {
          caught = error('TEMP_CHILD_PROTOCOL', 'Owned child closed before its terminal report request.', { exitCode: code, signal });
        }
        if (caught) latchChildFailure(record, caught, 'child-close');
      } else if (profile !== 'source-update' && ((code !== 0 && code !== null) || signal)) {
        record.operationalError = error('TEMP_CHILD_FAILED', 'Owned child exited unsuccessfully.', { exitCode: code, signal });
        latchChildOutcome(record, record.operationalError, 'child-close');
      }
      if (profile === 'source-update') record.phase = 'CHILD_CLOSED';
      if (record.remove) record.remove();
      if (record.removeAbort) record.removeAbort();
      if (r.mutationOwner === owner) {
        try {
          clearOwnedChild(r, childToken, owner);
          confirmChildPersistence(r, record, childToken);
        } catch (caught) { latchChildPersistenceFailure(record, caught, 'child-close-retirement'); }
      } else {
        record.ledgerClearPending = true;
      }
      resolve({ code, signal });
    });
  });
  child.once('error', (caught) => {
    noteChildEvent(record, 'error');
    record.operationalError = caught;
    if (profile === 'source-update') {
      const beforeAdmission = record.phase === 'SPAWNING' || record.phase === 'ADMITTING';
      latchChildFailure(record,
        error(beforeAdmission ? 'TEMP_CHILD_SPAWN_FAILED' : 'TEMP_CHILD_OPERATIONAL_ERROR',
          beforeAdmission ? 'Owned child failed before broker admission.' : 'Owned child reported an operational error.',
          { cause: caught }),
        beforeAdmission ? 'spawn-failure' : 'operational-failure');
    } else {
      latchChildOutcome(record, error('TEMP_CHILD_OPERATIONAL_ERROR', 'Owned child reported an operational error.', { cause: caught }), 'operational-error');
    }
    void requestStop(record);
  });
  r.children.set(child, record);
  const stop = () => {
    noteChildEvent(record, 'abort');
    if (profile === 'source-update') {
      latchChildFailure(record, error('TEMP_CHILD_CANCELLED', 'Owned child was cancelled.'), 'cancelled');
    } else {
      latchChildOutcome(record, error('TEMP_CHILD_CANCELLED', 'Owned child was cancelled.'), 'cancelled');
    }
    void requestStop(record);
  };
  r.stop.signal.addEventListener('abort', stop, { once: true });
  record.removeAbort = () => r.stop.signal.removeEventListener('abort', stop);
  child.once('spawn', () => {
    noteChildEvent(record, 'spawn');
    if (!child.pid) return;
    record.pid = child.pid;
    record.start = getProcessStart(child.pid);
    if (profile === 'source-update') record.phase = 'ADMITTING';
    try {
      recordChild(r, childToken, {
        phase: 'RUNNING', pid: record.pid, start_identity: record.start
      }, owner);
    } catch (caught) {
      latchChildPersistenceFailure(record, caught, 'child-start-record');
      if (profile === 'source-update') {
        latchChildFailure(record, error('TEMP_OWNERSHIP_UNCERTAIN', 'Owned child termination evidence could not be persisted.', { cause: caught }), 'child-ledger-failure');
      }
      void requestStop(record);
    }
    if (r.stop.signal.aborted) void requestStop(record);
  });
  return record;
}
function frameJson(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}
function parseReportFrame(frame, token) {
  return require('./check-project-source-updates.cjs').parseOwnedReportFrame(frame, token);
}
function assertOpenResource(resourcePath, expectedIdentity, descriptor, label) {
  const descriptorIdentity = identity(fs.fstatSync(descriptor, { bigint: true }));
  if (!sameId(descriptorIdentity, expectedIdentity)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'File') + ' admitted identity changed.');
  }
  const current = file(resourcePath, expectedIdentity, label);
  if (!sameId(current.id, descriptorIdentity)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'File') + ' no longer names the admitted resource.');
  }
  return current;
}

async function assertOpenResourceAfterBoundary(resourcePath, expectedIdentity, descriptor, label) {
  let stats;
  try { stats = await fs.promises.lstat(resourcePath, { bigint: true }); }
  catch (caught) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'File') + ' is missing after an asynchronous boundary.', { cause: caught });
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'File') + ' is not ordinary after an asynchronous boundary.');
  }
  if (!sameId(identity(stats), expectedIdentity)) {
    throw error('TEMP_OWNERSHIP_UNCERTAIN', (label || 'File') + ' identity changed across an asynchronous boundary.');
  }
  return assertOpenResource(resourcePath, expectedIdentity, descriptor, label);
}

async function writeReservedReport(r, token, content, owner) {
  assertMutationOwner(r, owner);
  assertGrowthAllowed(r, owner);
  const destination = 'workspace/repo/source-watch/reviews/active-third-party-updates.md';
  const pending = destination + '.pending-' + token;
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > OWNED_REPORT_MAX_BYTES) throw growthBudgetError(r, 'Owned report exceeds its reserved payload.');
  const target = leasePath(r, destination);
  parentDirs(r, target.parts, owner);
  const parents = snapshotParents(r, target.parts);
  revalidateParents(r, parents);
  let oldId = null;
  try { oldId = file(target.p, null, 'Existing owned report').id; }
  catch (caught) { if (!caught.cause || caught.cause.code !== 'ENOENT') throw caught; }
  const staged = await writeFile(r, pending, bytes, false, true, owner, true);
  try {
    assertMutationOwner(r, owner);
    await assertOpenResourceAfterBoundary(staged.path, staged.identity, staged.descriptor, 'Staged owned report');
    revalidateParents(r, parents);
    if (oldId) file(target.p, oldId, 'Existing owned report');
    else if (!isMissing(target.p)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Report destination appeared during broker write.');
    assertMutationOwner(r, owner);
    revalidateParents(r, parents);
    assertOpenResource(staged.path, staged.identity, staged.descriptor, 'Staged owned report before publication');
    fs.renameSync(staged.path, target.p);
    assertMutationOwner(r, owner);
    revalidateParents(r, parents);
    file(target.p, staged.identity, 'Parent-written report');
  } finally {
    fs.closeSync(staged.descriptor);
  }
}

async function removeReservedReport(r, owner) {
  assertMutationOwner(r, owner);
  assertGrowthAllowed(r, owner);
  const rel = 'workspace/repo/source-watch/reviews/active-third-party-updates.md';
  const target = leasePath(r, rel);
  let parents;
  try { parents = snapshotParents(r, target.parts); }
  catch (caught) {
    if (caught.cause && caught.cause.code === 'ENOENT') return;
    throw caught;
  }
  revalidateParents(r, parents);
  let current;
  try { current = file(target.p, null, 'Existing owned report'); }
  catch (caught) {
    if (caught.cause && caught.cause.code === 'ENOENT') return;
    throw caught;
  }
  let descriptor;
  try {
    try { descriptor = fs.openSync(target.p, fs.constants.O_RDONLY); }
    catch (caught) { throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Existing owned report changed before removal.', { cause: caught }); }
    const openedIdentity = identity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameId(openedIdentity, current.id)) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Existing owned report changed while opening for removal.');
    }
    assertOpenResource(target.p, openedIdentity, descriptor, 'Existing owned report');
    await assertOpenResourceAfterBoundary(target.p, openedIdentity, descriptor, 'Existing owned report');
    assertMutationOwner(r, owner);
    revalidateParents(r, parents);
    assertOpenResource(target.p, openedIdentity, descriptor, 'Existing owned report before removal');
    fs.unlinkSync(target.p);
    assertMutationOwner(r, owner);
    revalidateParents(r, parents);
    if (!isMissing(target.p)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Removed report reappeared.');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sendChildIpcMessage(childRecord, frame, label) {
  const child = childRecord && childRecord.child;
  if (!child || typeof child.send !== 'function' || child.connected !== true) {
    return Promise.reject(error('TEMP_CHILD_ACK_SEND_FAILED', (label || 'Owned IPC send') + ' channel is closed.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (caught) => {
      if (settled) return;
      settled = true;
      if (caught) reject(error('TEMP_CHILD_ACK_SEND_FAILED', (label || 'Owned IPC send') + ' failed.', { cause: caught }));
      else resolve();
    };
    try { child.send(frame, done); }
    catch (caught) { done(caught); }
  });
}

function receiveOwnedReport(r, childRecord, token, owner) {
  assertMutationOwner(r, owner);
  const protocol = require('./check-project-source-updates.cjs');
  const child = childRecord.child;
  childRecord.phase = childRecord.phase || 'ADMITTING';
  let resolveReport;
  let rejectReport;
  let admissionStep = 'HELLO';
  let admissionTimer;
  const report = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
  childRecord.reportPromise = report;

  const rejectWithFirstFailure = (caught, kind, stop = true) => {
    const first = latchChildFailure(childRecord, caught, kind);
    if (!childRecord.reportSettled) {
      childRecord.reportSettled = true;
      rejectReport(first);
    }
    if (stop && !childRecord.closed) void requestStop(childRecord);
    return first;
  };
  const sendAck = (acknowledged) => {
    if (childRecord.acknowledgementAttempted) {
      throw error('TEMP_CHILD_PROTOCOL', 'Owned report acknowledgement was already attempted.');
    }
    childRecord.acknowledgementAttempted = true;
    return sendChildIpcMessage(
      childRecord,
      frameJson({ version: 1, token, acknowledged }),
      'Owned report acknowledgement'
    );
  };
  const onMessage = (message, handle) => {
    noteChildEvent(childRecord, 'message');
    if (childRecord.failure || childRecord.closed) return;
    if (handle !== undefined && handle !== null) {
      rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report IPC message transferred an unexpected handle.'), 'transferred-handle');
      return;
    }
    if (childRecord.phase === 'ADMITTING' && admissionStep === 'HELLO') {
      let control;
      try { control = protocol.parseAdmissionControlFrame(message, token); }
      catch (caught) {
        rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report broker admission failed.', { cause: caught }), 'malformed-hello');
        return;
      }
      if (control.type !== 'BROKER_HELLO') {
        rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report broker sent an unexpected admission phase.'), 'unexpected-hello-phase');
        return;
      }
      admissionStep = 'READY_SENT';
      void sendChildIpcMessage(
        childRecord,
        frameJson({ version: 1, token, type: 'BROKER_READY' }),
        'Owned report BROKER_READY'
      ).catch((caught) => {
        rejectWithFirstFailure(error('TEMP_CHILD_ADMISSION_SEND_FAILED', 'Owned report READY could not be sent.', { cause: caught }), 'ready-send-failure');
      });
      return;
    }
    if (childRecord.phase === 'ADMITTING' && admissionStep === 'READY_SENT') {
      let control;
      try { control = protocol.parseAdmissionControlFrame(message, token); }
      catch (caught) {
        rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report broker admission failed.', { cause: caught }), 'malformed-ready-ack');
        return;
      }
      if (control.type !== 'BROKER_READY_ACK') {
        rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report broker sent an unexpected admission phase.'), 'unexpected-ready-ack-phase');
        return;
      }
      admissionStep = 'ADMITTED';
      childRecord.phase = 'READY';
      if (admissionTimer) clearTimeout(admissionTimer);
      return;
    }
    if (childRecord.phase !== 'READY' || childRecord.terminalConsumed) {
      rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report terminal request arrived in an unexpected phase.'), 'unexpected-message-phase');
      return;
    }

    let request;
    try { request = protocol.parseOwnedReportFrame(message, token); }
    catch (caught) {
      rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report terminal request is malformed.', { cause: caught }), 'malformed-terminal-request');
      return;
    }

    childRecord.terminalConsumed = true;
    childRecord.phase = 'REQUEST_ACCEPTED';
    noteChildEvent(childRecord, 'request-accepted');
    const effect = trackBrokerOperation(r, childRecord, owner, async () => {
      assertMutationOwner(r, owner);
      if (request.type === 'PUT_REPORT') await writeReservedReport(r, token, request.content, owner);
      else await removeReservedReport(r, owner);
      assertMutationOwner(r, owner);
    });
    childRecord.reportEffect = effect;
    void effect.then(() => {
      noteChildEvent(childRecord, 'parent-effect-settled');
      if (childRecord.failure || childRecord.closed) {
        rejectWithFirstFailure(childRecord.failure
          ? childRecord.failure.error
          : error('TEMP_CHILD_DISCONNECTED_BEFORE_ACK', 'Owned child closed before report acknowledgement.'),
        childRecord.failure ? childRecord.failure.kind : 'closed-before-ack', false);
        return;
      }
      childRecord.phase = 'PARENT_EFFECT_SETTLED';
      void sendAck(true).then(() => {
        noteChildEvent(childRecord, 'ack-sent');
        childRecord.phase = 'ACK_SENT';
        if (!childRecord.reportSettled) {
          childRecord.reportSettled = true;
          resolveReport(request.type);
        }
      }, (caught) => {
        rejectWithFirstFailure(error('TEMP_CHILD_ACK_SEND_FAILED', 'Owned report acknowledgement could not be sent.', { cause: caught }), 'ack-send-failure');
      });
    }, (caught) => {
      noteChildEvent(childRecord, 'parent-effect-failed');
      const first = latchChildFailure(childRecord, caught, 'parent-effect-failure');
      if (childRecord.closed || child.connected !== true || childRecord.acknowledgementAttempted) {
        rejectWithFirstFailure(first, 'parent-effect-failure');
        return;
      }
      void sendAck(false).then(async () => {
        if (!childRecord.reportSettled) {
          childRecord.reportSettled = true;
          rejectReport(first);
        }
        const closed = await Promise.race([
          childRecord.done.then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), 1000))
        ]);
        if (!closed) void requestStop(childRecord);
      }, (sendError) => {
        latchChildFailure(childRecord, sendError, 'negative-ack-send-failure');
        if (!childRecord.reportSettled) {
          childRecord.reportSettled = true;
          rejectReport(first);
        }
        if (!childRecord.closed) void requestStop(childRecord);
      });
    });
  };
  const onDisconnect = () => {
    noteChildEvent(childRecord, 'disconnect');
    if (childRecord.phase === 'ACK_SENT' || childRecord.phase === 'CHILD_CLOSED') return;
    if (childRecord.phase === 'READY' && !childRecord.terminalConsumed) {
      childRecord.disconnectedBeforeTerminal = true;
      return;
    }
    const beforeAdmission = childRecord.phase === 'SPAWNING' || childRecord.phase === 'ADMITTING';
    rejectWithFirstFailure(
      error(beforeAdmission ? 'TEMP_CHILD_ADMISSION_FAILED' : 'TEMP_CHILD_DISCONNECTED_BEFORE_ACK',
        beforeAdmission
          ? 'Owned report IPC channel disconnected before admission.'
          : 'Owned report IPC channel disconnected before acknowledgement.'),
      beforeAdmission ? 'disconnect-before-admission' : 'disconnect-before-ack'
    );
  };
  const onError = (caught) => {
    noteChildEvent(childRecord, 'ipc-error');
    rejectWithFirstFailure(error('TEMP_CHILD_PROTOCOL', 'Owned report IPC channel failed.', { cause: caught }), 'ipc-error');
  };

  child.on('message', onMessage);
  child.on('disconnect', onDisconnect);
  child.on('error', onError);
  admissionTimer = setTimeout(() => {
    if (childRecord.phase !== 'READY' && childRecord.phase !== 'REQUEST_ACCEPTED'
        && childRecord.phase !== 'PARENT_EFFECT_SETTLED' && childRecord.phase !== 'ACK_SENT'
        && childRecord.phase !== 'CHILD_CLOSED') {
      rejectWithFirstFailure(error('TEMP_CHILD_ADMISSION_TIMEOUT', 'Owned report broker admission exceeded five seconds.'), 'admission-timeout');
    }
  }, 5000);
  childRecord.done.then(() => {
    if (admissionTimer) clearTimeout(admissionTimer);
    child.removeListener('message', onMessage);
    child.removeListener('disconnect', onDisconnect);
    child.removeListener('error', onError);
    if (childRecord.failure && !childRecord.reportSettled) {
      childRecord.reportSettled = true;
      rejectReport(childRecord.failure.error);
    }
  });
  if (childRecord.failure) {
    if (admissionTimer) clearTimeout(admissionTimer);
    childRecord.reportSettled = true;
    rejectReport(childRecord.failure.error);
    void requestStop(childRecord);
  }
  return report;
}
async function runCooperatingProfileAttempt(r, profile, owner) {
  if (arguments.length !== 3 || typeof profile !== 'string') throw error('TEMP_SPEC_INVALID', 'A fixed child profile is required.');
  assertMutationOwner(r, owner);
  const expectedPurpose = profile === 'skill-portability' ? 'portability'
    : profile === 'source-update' ? 'source-update' : null;
  if (!expectedPurpose || r.c.purpose !== expectedPurpose) throw error('TEMP_SPEC_INVALID', 'Child profile is not admitted for this owned-temp purpose.');
  const profileStartedAt = Date.now();
  const token = crypto.randomBytes(24).toString('hex');
  if (profile === 'source-update') {
    if (r.sourceUpdateStarted) throw error('TEMP_CHILD_PROTOCOL', 'The source-update writer profile is single-use per lease.');
    r.sourceUpdateStarted = true;
    charge(r, 65536, owner);
    r.sourceUpdateAdmitted = true;
  }
  const childRecord = spawnProfileChild(r, profile, token, owner);
  const child = childRecord.child;
  const chunks = { stdout: [], stderr: [], bytes: 0 };
  let overflow = false;
  const collect = (target, chunk) => {
    noteChildEvent(childRecord, 'output');
    chunks.bytes += chunk.length;
    if (chunks.bytes > 1024 * 1024) {
      overflow = true;
      if (profile === 'source-update') {
        latchChildFailure(childRecord, error('TEMP_CHILD_OUTPUT_LIMIT', 'Owned child output exceeded the fixed 1-MiB limit.'), 'output-limit');
      } else {
        latchChildOutcome(childRecord, error('TEMP_CHILD_OUTPUT_LIMIT', 'Owned child output exceeded the fixed 1-MiB limit.'), 'output-limit');
      }
      void requestStop(childRecord);
      return;
    }
    target.push(chunk);
  };
  child.stdout.on('data', (chunk) => collect(chunks.stdout, chunk));
  child.stderr.on('data', (chunk) => collect(chunks.stderr, chunk));
  const report = profile === 'source-update' ? receiveOwnedReport(r, childRecord, token, owner) : Promise.resolve(null);
  const remainingMs = Math.max(1, 30000 - (Date.now() - profileStartedAt));
  const timer = setTimeout(() => {
    noteChildEvent(childRecord, 'profile-timeout');
    childRecord.timedOut = true;
    if (profile === 'source-update') {
      latchChildFailure(childRecord, error('TEMP_CHILD_TIMEOUT', 'Owned child exceeded the fixed 30-second total profile deadline.'), 'profile-timeout');
    } else {
      latchChildOutcome(childRecord, error('TEMP_CHILD_TIMEOUT', 'Owned child exceeded the fixed 30-second total profile deadline.'), 'profile-timeout');
    }
    void requestStop(childRecord);
  }, remainingMs);
  const completion = Promise.allSettled([childRecord.done, report]);
  const first = await Promise.race([
    completion.then((results) => ({ kind: 'completion', results })),
    childRecord.stopSignal.then((terminated) => ({ kind: 'stop', terminated }))
  ]);
  if (first.kind === 'stop' && !first.terminated) {
    clearTimeout(timer);
    closeMutationAdmission(r, 'owned child termination is unconfirmed', false, true);
    await waitBrokerOperations(r, owner);
    if (childRecord.failure) {
      childRecord.failure.error.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
      childRecord.failure.error.cleanupStatus = { status: 'CLEANUP_INCOMPLETE', code: 'TEMP_CLEANUP_INCOMPLETE' };
      throw childRecord.failure.error;
    }
    throw error('TEMP_CLEANUP_INCOMPLETE', 'Owned child termination is not confirmed.');
  }
  const results = first.kind === 'completion' ? first.results : await completion;
  clearTimeout(timer);
  await waitBrokerOperations(r, owner);
  assertMutationOwner(r, owner);
  if (!childRecord.closed) throw error('TEMP_CLEANUP_INCOMPLETE', 'Owned child termination is not confirmed.');
  const terminalChildError = childTerminalError(r, childRecord, chunks);
  if (terminalChildError) throw terminalChildError;
  if (childRecord.operationalError) throw error('TEMP_CHILD_OPERATIONAL_ERROR', 'Owned child reported an operational error.', { cause: childRecord.operationalError });
  if (childRecord.timedOut) throw error('TEMP_CHILD_TIMEOUT', 'Owned child exceeded the fixed 30-second deadline.');
  if (r.abort.signal.aborted) throw error('TEMP_CHILD_CANCELLED', 'Owned child was cancelled.');
  if (overflow) throw error('TEMP_CHILD_OUTPUT_LIMIT', 'Owned child output exceeded the fixed 1-MiB limit.');
  const exitResult = results[0];
  const reportResult = results[1];
  if (reportResult.status === 'rejected') {
    const caught = reportResult.reason;
    if (childRecord.reportEmpty && childRecord.exit && Number.isInteger(childRecord.exit.code) && childRecord.exit.code !== 0) {
      throw error('TEMP_CHILD_FAILED', 'Owned child exited unsuccessfully before its terminal report request.', {
        exitCode: childRecord.exit.code, signal: childRecord.exit.signal,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'), cause: caught
      });
    }
    throw caught;
  }
  if (exitResult.status === 'rejected') throw exitResult.reason;
  if (childRecord.acknowledgementError) throw error('TEMP_CHILD_PROTOCOL', 'Owned report acknowledgement transport failed.', { cause: childRecord.acknowledgementError });
  const exit = childRecord.exit || exitResult.value;
  if (!exit) throw error('TEMP_CLEANUP_INCOMPLETE', 'Owned child exit status is not confirmed.');
  if (exit.code !== 0) throw error('TEMP_CHILD_FAILED', 'Owned child exited unsuccessfully.', {
    exitCode: exit.code, signal: exit.signal,
    stdout: Buffer.concat(chunks.stdout).toString('utf8'),
    stderr: Buffer.concat(chunks.stderr).toString('utf8')
  });
  if (profile === 'source-update') {
    if (childRecord.phase !== 'CHILD_CLOSED' || !childRecord.terminalConsumed
        || !childRecord.acknowledgementAttempted || childRecord.failure) {
      throw error('TEMP_CHILD_PROTOCOL', 'Owned report broker lifecycle did not complete successfully.');
    }
    childRecord.phase = 'SUCCESS';
  }
  return { pid: child.pid, code: exit.code, stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') };
}

async function runCooperatingProfile(r, profile, owner) {
  try {
    return await runCooperatingProfileAttempt(r, profile, owner);
  } catch (caught) {
    if (profile === 'source-update' && r.sourceUpdateAdmitted && !r.sourceUpdateSucceeded && !r.profileTerminalFailure) {
      r.profileTerminalFailure = caught;
      rememberTerminalFailure(r, caught);
    }
    throw caught;
  }
}

async function waitOperations(r) {
  while (r.operations.size) await Promise.allSettled([...r.operations]);
  await r.mutationTail;
  await waitBrokerOperations(r);
}

function leaseApi(r) {
  const runProfile = (...args) => {
    if (args.length !== 1) return Promise.reject(error('TEMP_SPEC_INVALID', 'Child profiles do not accept commands or options.'));
    const pending = operation(r, (owner) => runCooperatingProfile(r, args[0], owner));
    if (args[0] !== 'source-update') return pending;
    return pending.then((value) => {
      if (r.sourceUpdateAdmitted) r.sourceUpdateSucceeded = true;
      return value;
    }, (caught) => {
      if (r.sourceUpdateAdmitted && !r.sourceUpdateSucceeded && !r.profileTerminalFailure) {
        r.profileTerminalFailure = caught;
        rememberTerminalFailure(r, caught);
      }
      throw caught;
    });
  };
  return Object.freeze({
    root: r.rp,
    signal: r.abort.signal,
    path: (value) => { assertUsable(r); return leasePath(r, value).p; },
    mkdir: (value) => operation(r, (owner) => {
      const target = leasePath(r, value);
      if (target.parts.length > LIMITS.depth) throw growthBudgetError(r, 'Maximum directory depth exceeded.');
      parentDirs(r, target.parts, owner);
      return ensureDir(r, target.p, target.parts.length, owner);
    }),
    writeFile: (value, data) => operation(r, (owner) => writeFile(r, value, data, false, false, owner)),
    appendFile: (value, data) => operation(r, (owner) => writeFile(r, value, data, true, false, owner)),
    unlink: (value) => operation(r, (owner) => {
      assertMutationOwner(r, owner);
      const target = leasePath(r, value);
      const parents = snapshotParents(r, target.parts);
      revalidateParents(r, parents);
      const existing = file(target.p, null, 'Unlink target');
      revalidateParents(r, parents);
      file(target.p, existing.id, 'Unlink target');
      assertMutationOwner(r, owner);
      fs.unlinkSync(target.p);
      revalidateParents(r, parents);
      if (!isMissing(target.p)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Unlinked target reappeared.');
    }),
    copyTree: (value, options) => operation(r, (owner) => copyTree(r, value, options, owner)),
    runProfile,
    retain: () => {
      assertUsable(r);
      if (!r.c.retention) throw error('TEMP_SPEC_INVALID', 'Retention was not authorized in the spec.');
      r.retentionRequested = true;
    }
  });
}
function delays(){return win()?WIN_RETRY:[0];}
async function stopChildren(r, owner = null) {
  const children = [...r.children.values()];
  const results = children.length ? await Promise.all(children.map((child) => terminateRecord(child, 1000))) : [];
  const pending = children.filter((_, index) => !results[index]);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!results[index] || !child.closed) continue;
    if ((r.lease.owned_children || []).some((row) => row.token === child.token)) {
      if (r.ownershipFenced && child.persistError && !child.persistResolved) continue;
      try {
        clearOwnedChild(r, child.token, owner);
        confirmChildPersistence(r, child, child.token);
      } catch (caught) { latchChildPersistenceFailure(child, caught, 'stop-retirement'); }
    }
  }
  for (const child of children) {
    if (!pending.includes(child) && child.closed
        && !(r.lease.owned_children || []).some((row) => row.token === child.token)) {
      r.children.delete(child.child);
    }
  }
  const ledger = (r.lease && r.lease.owned_children) || [];
  if (pending.length || ledger.length) return { status: 'HOLD', count: Math.max(pending.length, ledger.length) };
  return { status: 'TERMINATED', count: children.length };
}
function assertCleanupMutation(r, owner) {
  if (r.live || owner) assertMutationOwner(r, owner);
}

function verifyCleanupParents(r, parents, owner, namespaceOwner) {
  assertCleanupMutation(r, owner);
  if (namespaceOwner) assertNamespaceOwner(namespaceOwner, r.ns);
  validate(r, { allowMissing: r.lease.root_removed });
  for (const parent of parents) dir(parent.path, parent.id, 'Cleanup parent');
}

async function removeFile(r, targetPath, expectedId, parents, owner = null, namespaceOwner = null) {
  for (const pause of delays()) {
    if (pause) await wait(pause);
    verifyCleanupParents(r, parents, owner, namespaceOwner);
    let stats;
    try { stats = fs.lstatSync(targetPath, { bigint: true }); }
    catch (caught) { if (caught.code === 'ENOENT') return; throw caught; }
    const actualId = identity(stats);
    if (expectedId && !sameId(actualId, expectedId)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup file identity changed.');
    if (!stats.isSymbolicLink() && !stats.isFile()) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup target changed type.');
    verifyCleanupParents(r, parents, owner, namespaceOwner);
    const finalStats = fs.lstatSync(targetPath, { bigint: true });
    if (!sameId(identity(finalStats), actualId)
        || finalStats.isSymbolicLink() !== stats.isSymbolicLink()
        || finalStats.isFile() !== stats.isFile()) {
      throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup target changed before unlink.');
    }
    assertCleanupMutation(r, owner);
    try {
      if (finalStats.isSymbolicLink() && win() && finalStats.isDirectory()) fs.rmdirSync(targetPath);
      else fs.unlinkSync(targetPath);
      verifyCleanupParents(r, parents, owner, namespaceOwner);
      if (!isMissing(targetPath)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup file reappeared after unlink.');
      return;
    } catch (caught) {
      if (caught.code === 'ENOENT') return;
      if (!RETRY.has(caught.code)) throw caught;
    }
  }
  throw error('TEMP_CLEANUP_INCOMPLETE', 'File removal retries exhausted.');
}

async function removeDir(r, targetPath, isRoot, expectedId, parents, owner = null, namespaceOwner = null) {
  const parentChain = parents || [{ path: r.ns.roots, id: r.ns.rootsId }];
  const expected = expectedId || (isRoot ? r.lease.root_identity : null);
  const marker = path.join(r.rp, MARKER);
  let last;
  for (const pause of delays()) {
    if (pause) await wait(pause);
    verifyCleanupParents(r, parentChain, owner, namespaceOwner);
    const id = dir(targetPath, expected, 'Cleanup directory');
    const names = fs.readdirSync(targetPath).sort();
    verifyCleanupParents(r, parentChain, owner, namespaceOwner);
    dir(targetPath, id, 'Cleanup directory');
    for (const name of names) {
      const child = contained(r.rp, path.join(targetPath, name));
      if (isRoot && samePath(child, marker)) continue;
      verifyCleanupParents(r, [...parentChain, { path: targetPath, id }], owner, namespaceOwner);
      const stats = fs.lstatSync(child, { bigint: true });
      const childId = identity(stats);
      if (stats.isSymbolicLink() || stats.isFile()) {
        await removeFile(r, child, childId, [...parentChain, { path: targetPath, id }], owner, namespaceOwner);
      } else if (stats.isDirectory()) {
        await removeDir(r, child, false, childId, [...parentChain, { path: targetPath, id }], owner, namespaceOwner);
      } else {
        throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup found a special filesystem object.');
      }
      verifyCleanupParents(r, [...parentChain, { path: targetPath, id }], owner, namespaceOwner);
      dir(targetPath, id, 'Cleanup directory');
    }
    if (isRoot) {
      let rootMarker;
      try { rootMarker = file(marker, r.lease.root_marker_identity, 'Root marker'); }
      catch (caught) {
        if (caught.cause && caught.cause.code === 'ENOENT' && r.lease.root_marker_removed) rootMarker = null;
        else throw caught;
      }
      if (rootMarker) {
        setLease(r, { status: 'CLEANING', root_marker_removed: true }, owner);
        await removeFile(r, marker, rootMarker.id, [...parentChain, { path: targetPath, id }], owner, namespaceOwner);
      }
    }
    verifyCleanupParents(r, parentChain, owner, namespaceOwner);
    dir(targetPath, id, 'Cleanup directory');
    if (fs.readdirSync(targetPath).length !== 0) {
      last = error('TEMP_CLEANUP_INCOMPLETE', 'Cleanup directory gained new contents.');
      continue;
    }
    verifyCleanupParents(r, parentChain, owner, namespaceOwner);
    dir(targetPath, id, 'Cleanup directory');
    assertCleanupMutation(r, owner);
    try {
      fs.rmdirSync(targetPath);
      if (!isMissing(targetPath)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup directory reappeared after removal.');
      if (isRoot) {
        setLease(r, { status: 'REMOVED', root_removed: true }, owner);
        r.rid = null;
      }
      return;
    } catch (caught) {
      if (caught.code === 'ENOENT') {
        if (!isMissing(targetPath)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cleanup directory reappeared after removal.');
        if (isRoot) setLease(r, { status: 'REMOVED', root_removed: true }, owner);
        return;
      }
      last = caught;
      if (!RETRY.has(caught.code)) throw caught;
    }
  }
  throw last || error('TEMP_CLEANUP_INCOMPLETE', 'Directory removal retries exhausted.');
}

function isMissing(p) {
  try { fs.lstatSync(p); return false; }
  catch (caught) { if (caught.code === 'ENOENT') return true; throw caught; }
}

async function unlinkMetadataWithRetry(ns, target, expectedId, label, namespaceOwner) {
  let last;
  for (const pause of delays()) {
    if (pause) await wait(pause);
    validateNamespace(ns);
    if (namespaceOwner) assertNamespaceOwner(namespaceOwner, ns);
    dir(ns.claims, ns.claimsId, 'Claims metadata parent');
    let current;
    try { current = privateFile(target, expectedId, label); }
    catch (caught) {
      if (caught.cause && caught.cause.code === 'ENOENT') return false;
      throw caught;
    }
    if (!sameId(current, expectedId)) throw error('TEMP_OWNERSHIP_UNCERTAIN', label + ' identity changed.');
    validateNamespace(ns);
    if (namespaceOwner) assertNamespaceOwner(namespaceOwner, ns);
    dir(ns.claims, ns.claimsId, 'Claims metadata parent');
    privateFile(target, expectedId, label);
    try {
      validateNamespace(ns);
      if (namespaceOwner) assertNamespaceOwner(namespaceOwner, ns);
      dir(ns.claims, ns.claimsId, 'Claims metadata parent');
      privateFile(target, expectedId, label);
      await fs.promises.unlink(target);
      validateNamespace(ns);
      if (namespaceOwner) assertNamespaceOwner(namespaceOwner, ns);
      dir(ns.claims, ns.claimsId, 'Claims metadata parent');
      if (!isMissing(target)) throw error('TEMP_OWNERSHIP_UNCERTAIN', label + ' reappeared after unlink.');
      return true;
    } catch (caught) {
      if (caught.code === 'ENOENT') return false;
      last = caught;
      if (!RETRY.has(caught.code)) throw caught;
    }
  }
  throw error('TEMP_CLEANUP_INCOMPLETE', (label || 'Metadata') + ' removal retries exhausted.', { cause: last });
}

async function cleanupMeta(r, owner = null, namespaceOwner) {
  assertCleanupMutation(r, owner);
  if (namespaceOwner) assertNamespaceOwner(namespaceOwner, r.ns);
  validateNamespace(r.ns);
  verifyClaim(r);
  if (!isMissing(r.rp)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Cannot remove metadata while the root exists.');
  if (r.lease.status !== 'REMOVED') {
    setLease(r, { status: 'REMOVED', root_removed: true, lease_expires_at_ms: Date.now() }, owner);
  }
  let phase = r.lease.metadata_cleanup_phase;
  if (phase === null || phase === 'MARKER_REMOVAL_PENDING') {
    if (r.mid || r.lease.marker_identity) {
      let marker = null;
      try {
        const read = readJson(r.mp, r.lease.marker_identity || r.mid, 'Marker');
        if (read.data.claim_id !== r.id) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Marker changed.');
        marker = read;
      } catch (caught) {
        const missing = caught.cause && caught.cause.code === 'ENOENT';
        if (!(missing && phase === 'MARKER_REMOVAL_PENDING')) throw caught;
      }
      if (phase === null) setLease(r, { metadata_cleanup_phase: 'MARKER_REMOVAL_PENDING' }, owner);
      if (marker) await unlinkMetadataWithRetry(r.ns, r.mp, marker.id, 'Marker', namespaceOwner);
    }
    setLease(r, { metadata_cleanup_phase: 'MARKER_REMOVED' }, owner);
    phase = 'MARKER_REMOVED';
  }
  if (phase === 'MARKER_REMOVED') {
    if (!isMissing(r.mp)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Marker reappeared after cleanup evidence was persisted.');
    setLease(r, { metadata_cleanup_phase: 'CLAIM_REMOVAL_PENDING' }, owner);
    phase = 'CLAIM_REMOVAL_PENDING';
  }
  if (phase !== 'CLAIM_REMOVAL_PENDING') throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Metadata cleanup phase is unsupported.');
  if (!isMissing(r.rp) || !isMissing(r.mp)) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Recovery evidence does not prove metadata-only cleanup.');
  const currentClaim = readJson(r.cp, r.cid, 'Claim');
  if (currentClaim.data.claim_id !== r.id) throw error('TEMP_OWNERSHIP_UNCERTAIN', 'Claim changed during metadata cleanup.');
  await unlinkMetadataWithRetry(r.ns, r.cp, r.cid, 'Claim', namespaceOwner);
  await unlinkMetadataWithRetry(r.ns, r.lp, r.lid, 'Lease', namespaceOwner);
}

async function cleanupLocked(r, reason, owner, namespaceOwner) {
  if (namespaceOwner) assertNamespaceOwner(namespaceOwner, r.ns);
  try {
    if (r.lease.status !== 'REMOVED' && !['TERMINAL', 'CLEANING', 'CLEANUP_INCOMPLETE'].includes(r.lease.status)) {
      setLease(r, { status: 'TERMINAL', terminal_reason: String(reason).slice(0, 128), lease_expires_at_ms: Date.now() }, owner);
    }
    if (r.timer) clearInterval(r.timer);
    try { r.stop.abort(reason || 'owned-temp cleanup'); } catch (_) {}
    const children = await stopChildren(r, owner);
    if (children.status !== 'TERMINATED') throw error('TEMP_CLEANUP_INCOMPLETE', 'Owned children are still running.');
    await waitOperations(r);
    if ((r.rid || r.lease.root_identity) && !r.lease.root_removed) {
      validate(r);
      setLease(r, { status: 'CLEANING' }, owner);
      await removeDir(r, r.rp, true, r.lease.root_identity, [{ path: r.ns.roots, id: r.ns.rootsId }], owner, namespaceOwner);
    }
    await cleanupMeta(r, owner, namespaceOwner);
    active.delete(r.id);
    return { status: 'REMOVED', claimId: r.id };
  } catch (caught) {
    try {
      if (r.lease.status !== 'REMOVED') {
        setLease(r, { status: 'CLEANUP_INCOMPLETE', last_error_code: caught.code || 'TEMP_CLEANUP_INCOMPLETE' }, owner);
      }
    } catch (_) {}
    return { status: 'CLEANUP_INCOMPLETE', claimId: r.id, code: caught.code || 'TEMP_CLEANUP_INCOMPLETE', rootPath: r.rp };
  }
}

function requestTerminal(r, kind, reason, namespaceOwner = null, taskAbort = true) {
  if (r.terminalPromise) {
    if (!r.terminalCommitted && kind === 'cleanup') {
      r.terminalKind = 'cleanup';
      r.terminalReason = reason;
    }
    return r.terminalPromise;
  }

  r.terminalKind = kind;
  r.terminalReason = reason;
  closeMutationAdmission(r, reason || 'owned-temp terminal transition', taskAbort, false, taskAbort ? abortError(null) : null);
  const pending = (async () => {
    try {
      await waitOperations(r);
      const owner = enterMutation(r, 'terminal-transition');
      try {
        const run = async (nsOwner) => {
          assertNamespaceOwner(nsOwner, r.ns);
          const children = await stopChildren(r, owner);
          if (children.status !== 'TERMINATED') {
            return { status: 'CLEANUP_INCOMPLETE', claimId: r.id, code: 'TEMP_CLEANUP_INCOMPLETE', rootPath: r.rp };
          }
          await waitOperations(r);
          let retentionError = null;
          if (r.terminalKind === 'retain' && (r.ownershipFenced || r.profileTerminalFailure || r.taskAbortRequested)) {
            r.terminalKind = 'cleanup';
          }
          if (r.terminalKind === 'retain') {
            try {
              if (!r.c.retention || r.c.retention.expiresAtMs <= Date.now()) {
                throw error('TEMP_SPEC_INVALID', 'Retention expired before it could be retained.');
              }
              const inventoryState = inventory(r.ns, r.id);
              if (inventoryState.retained >= LIMITS.retained) {
                throw error('TEMP_CAPACITY_LOW', 'Retained-root limit is full.');
              }
              const size = planCopy(r.rp, (item) => path.basename(item) !== MARKER).total;
              if (size > r.c.retention.maxBytes || size > LIMITS.retainedBytes) {
                throw error('TEMP_BUDGET_EXCEEDED', 'Retained root exceeds its byte limit.');
              }
              setLease(r, {
                status: 'RETAINED',
                retention: {
                  reason: r.c.retention.reason, owner: r.c.retention.owner,
                  max_bytes: r.c.retention.maxBytes, expires_at_ms: r.c.retention.expiresAtMs, bytes: size
                },
                lease_expires_at_ms: r.c.retention.expiresAtMs
              }, owner);
              r.terminalCommitted = true;
              r.retained = true;
              if (r.timer) clearInterval(r.timer);
              active.delete(r.id);
              return { status: 'RETAINED', claimId: r.id, retentionError: null };
            } catch (caught) {
              if (!['TEMP_SPEC_INVALID', 'TEMP_CAPACITY_LOW', 'TEMP_BUDGET_EXCEEDED'].includes(caught.code)) throw caught;
              retentionError = caught;
              r.terminalKind = 'cleanup';
            }
          }
          const result = await cleanupLocked(r, r.terminalReason || reason, owner, nsOwner);
          if (result.status === 'REMOVED') r.terminalCommitted = true;
          if (retentionError) result.retentionError = retentionError;
          return result;
        };
        return namespaceOwner
          ? await run(namespaceOwner)
          : await locked(r.ns, run);
      } finally {
        leaveMutation(r, owner);
      }
    } catch (caught) {
      return { status: 'CLEANUP_INCOMPLETE', claimId: r.id, code: caught.code || 'TEMP_CLEANUP_INCOMPLETE', rootPath: r.rp };
    }
  })();
  r.terminalPromise = pending;
  r.cleanup = pending;
  return pending;
}

async function cleanup(r, reason, namespaceOwner = null) {
  if (r.live) return requestTerminal(r, 'cleanup', reason, namespaceOwner);
  if (r.cleanup) return r.cleanup;
  const pending = namespaceOwner
    ? cleanupLocked(r, reason, null, namespaceOwner)
    : locked(r.ns, (nsOwner) => cleanupLocked(r, reason, null, nsOwner));
  r.cleanup = pending;
  return pending;
}
function makeRoot(spec) {
  const ns = namespace(true);
  return locked(ns, async (namespaceOwner) => {
    validateNamespace(ns);
    const r = claim(ns, spec);
    try {
      dir(ns.roots, ns.rootsId, 'Roots');
      fs.mkdirSync(r.rp, { mode: 0o700 });
      r.rid = identity(fs.lstatSync(r.rp, { bigint: true }));
      dir(ns.roots, ns.rootsId, 'Roots');
      setLease(r, { status: 'CREATED', root_identity: r.rid });
      privateDir(r.rp, r.rid, false, false);
      makeMarker(r);
      admit(ns, r);
      setLease(r, { status: 'ADMITTED', lease_expires_at_ms: Date.now() + LIMITS.lease });
      r.ct = path.join(r.rp, 'child-temp');
      ensureDir(r, r.ct, 1);
      r.ctId = identity(fs.lstatSync(r.ct, { bigint: true }));
      setLease(r, { status: 'ACTIVE', lease_expires_at_ms: Date.now() + LIMITS.lease, entries: r.entries });
      r.live = true;
      active.set(r.id, r);
      return r;
    } catch (caught) {
      const result = await cleanup(r, 'construction-failure', namespaceOwner);
      if (result.status !== 'REMOVED') caught.cleanupStatus = result;
      throw caught;
    }
  });
}

function startRenew(r) {
  r.timer = setInterval(() => {
    if (r.lease.status !== 'ACTIVE' || r.mutationClosed || r.renewPending) return;
    r.renewPending = true;
    operation(r, (owner) => {
      if (r.lease.status === 'ACTIVE' && !r.closing) {
        setLease(r, { lease_expires_at_ms: Date.now() + LIMITS.lease }, owner);
      }
    }).catch((caught) => {
      if (!['TEMP_LEASE_CLOSED', 'TEMP_MUTATION_COORDINATOR'].includes(caught.code)) r.renewFailed = true;
    }).finally(() => { r.renewPending = false; });
  }, LIMITS.renew);
  if (r.timer.unref) r.timer.unref();
}
function abortError(signal){const e=error('TEMP_ABORTED','Owned temporary task was aborted.');if(signal&&signal.reason!==undefined)e.abortReason=String(signal.reason).slice(0,256);return e;}
async function withOwnedTemp(spec, fn) {
  if (typeof fn !== 'function') throw error('TEMP_SPEC_INVALID', 'withOwnedTemp requires a callback.');
  spec = normalize(spec);
  if (spec.signal && spec.signal.aborted) throw abortError(spec.signal);
  if (!startupRecovery) {
    await recoverStaleOwnedTemps();
    startupRecovery = true;
  }
  const r = await makeRoot(spec);
  const onAbort = () => {
    closeMutationAdmission(r, 'external task abort', true, false, abortError(spec.signal));
  };
  if (spec.signal) {
    spec.signal.addEventListener('abort', onAbort, { once: true });
    if (spec.signal.aborted) onAbort();
  }
  startRenew(r);
  let value;
  let primary = null;
  r.callbackRunning = true;
  try {
    if ((spec.signal && spec.signal.aborted) || r.taskAbortRequested) throw abortError(spec.signal);
    value = await fn(leaseApi(r));
    if ((spec.signal && spec.signal.aborted) || r.taskAbortRequested) throw abortError(spec.signal);
  } catch (caught) {
    primary = rememberTerminalFailure(r, caught);
  } finally {
    r.callbackRunning = false;
    if (spec.signal) spec.signal.removeEventListener('abort', onAbort);
  }

  if (!r.terminalFailure && r.profileTerminalFailure) rememberTerminalFailure(r, r.profileTerminalFailure);
  if (r.terminalFailure) primary = r.terminalFailure;
  const transition = await requestTerminal(
    r,
    !primary && r.retentionRequested && !r.ownershipFenced && !r.profileTerminalFailure && !r.taskAbortRequested ? 'retain' : 'cleanup',
    primary ? 'failure' : 'success',
    null,
    false
  );
  if (!primary && r.terminalFailure) primary = r.terminalFailure;
  if (!primary && r.profileTerminalFailure) primary = rememberTerminalFailure(r, r.profileTerminalFailure);
  if (transition.status === 'RETAINED' && !primary) return value;
  if (transition.status !== 'REMOVED') {
    if (primary) {
      const ownershipCleanup = primary.cleanupCode === 'TEMP_CLEANUP_INCOMPLETE'
        && primary.cleanupStatus && primary.cleanupStatus.status === 'CLEANUP_INCOMPLETE'
        && primary.cleanupStatus.code === 'TEMP_OWNERSHIP_UNCERTAIN';
      if (!ownershipCleanup) {
        primary.cleanupStatus = transition;
        primary.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
      }
      throw primary;
    }
    if (transition.retentionError) {
      transition.retentionError.cleanupStatus = transition;
      transition.retentionError.cleanupCode = 'TEMP_CLEANUP_INCOMPLETE';
      throw transition.retentionError;
    }
    throw error('TEMP_CLEANUP_INCOMPLETE', 'Cleanup failed after successful work.', {
      primary: 'success', cleanupStatus: transition
    });
  }
  if (transition.retentionError) throw transition.retentionError;
  if (primary) throw primary;
  return value;
}
function inspectOwnedTemps() {
  const ns = namespace(false);
  if (!ns) return { schema: SCHEMA + '.inspection', records: [], outstandingReservationsBytes: 0, retainedRoots: 0 };
  const records = [];
  let total = 0n;
  let retained = 0;
  for (const orphan of orphanLeaseInventory(ns)) records.push({ state: 'HOLD', claimPath: orphan.path, code: 'TEMP_METADATA_ORPHAN' });
  for (const claimPath of claimPaths(ns)) {
    try {
      const record = load(ns, claimPath);
      if (record.lease.status !== 'REMOVED') total += BigInt(record.lease.reservation_bytes);
      if (record.lease.status === 'RETAINED') retained += 1;
      records.push({
        claimId: record.id, rootPath: record.rp, state: record.lease.status,
        episode: record.c.episode, purpose: record.c.purpose,
        budgetBytes: record.c.budget_bytes, reservationBytes: record.c.reservation_bytes,
        bytesReserved: record.lease.bytes_reserved,
        leaseExpiresAtMs: record.lease.lease_expires_at_ms,
        retained: record.lease.status === 'RETAINED',
        retentionExpiresAtMs: record.lease.retention && record.lease.retention.expires_at_ms
      });
    } catch (caught) {
      records.push({ state: 'HOLD', claimPath, code: caught.code || 'TEMP_OWNERSHIP_UNCERTAIN' });
    }
  }
  return { schema: SCHEMA + '.inspection', records, outstandingReservationsBytes: Number(total), retainedRoots: retained };
}
function recoverChildren(r,namespaceOwner){
 const remaining=[];
 for(const child of r.lease.owned_children||[]){
  if(child.phase!=='RUNNING')return'TEMP_CHILD_UNKNOWN';
  const status=processStatus(child.pid,child.start_identity);
  if(status==='live')return'TEMP_CHILD_LIVE';
  if(status==='unknown')return'TEMP_CHILD_UNKNOWN';
  if(!['dead','mismatched'].includes(status))return'TEMP_CHILD_UNKNOWN';
  if(child.process_group&&!win()){
   try{process.kill(-child.pid,0);return'TEMP_CHILD_LIVE';}
   catch(e){if(e.code!=='ESRCH')return'TEMP_CHILD_UNKNOWN';}
  }
 }
 if((r.lease.owned_children||[]).length){if(namespaceOwner)assertNamespaceOwner(namespaceOwner,r.ns);setLease(r,{owned_children:remaining});}
 return null;
}
async function recoverStaleOwnedTemps() {
  const ns = namespace(false);
  if (!ns) return [];
  return locked(ns, async (namespaceOwner) => {
    const out = [];
    let count = 0;
    for (const claimPath of claimPaths(ns)) {
      let record;
      try { record = load(ns, claimPath); }
      catch (caught) {
        out.push({ status: 'HOLD', claimPath, code: caught.code || 'TEMP_OWNERSHIP_UNCERTAIN' });
        continue;
      }
      const lease = record.lease;
      const now = Date.now();
      const retained = lease.status === 'RETAINED';
      if (now + 5000 < record.c.created_at_ms || lease.lease_expires_at_ms < record.c.created_at_ms
          || lease.lease_expires_at_ms > now + (retained ? LIMITS.retainedMs : LIMITS.lease * 2)) {
        out.push({ status: 'HOLD', claimId: record.id, code: 'TEMP_CLOCK_ANOMALY' });
        continue;
      }
      if (retained && now < lease.retention.expires_at_ms) {
        out.push({ status: 'HOLD', claimId: record.id, code: 'TEMP_RETENTION_ACTIVE' });
        continue;
      }
      const terminal = ['TERMINAL', 'CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED'].includes(lease.status);
      if (!retained && !terminal && lease.lease_expires_at_ms > now) {
        out.push({ status: 'HOLD', claimId: record.id, code: 'TEMP_LEASE_ACTIVE' });
        continue;
      }
      const evidence = retained ? 'retention-expired' : processStatus(record.c.process.pid, record.c.process.start_identity);
      if (!retained && !['dead', 'mismatched'].includes(evidence)) {
        out.push({ status: 'HOLD', claimId: record.id, code: evidence === 'unknown' ? 'TEMP_PROCESS_UNKNOWN' : 'TEMP_PROCESS_LIVE' });
        continue;
      }
      const childCode = recoverChildren(record, namespaceOwner);
      if (childCode) {
        out.push({ status: 'HOLD', claimId: record.id, code: childCode });
        continue;
      }
      if (count >= LIMITS.recoveryCount) {
        out.push({ status: 'HOLD', claimId: record.id, code: 'TEMP_RECOVERY_LIMIT' });
        continue;
      }
      if (!lease.root_identity) {
        try {
          if (!isMissing(record.rp)) throw error('TEMP_MARKER_MISSING', 'Unmarked partial root preserved.');
          await cleanupMeta(record, null, namespaceOwner);
          count += 1;
          out.push({ status: 'REMOVED', claimId: record.id, rootRemoved: false, evidence });
        } catch (caught) { out.push({ status: 'HOLD', claimId: record.id, code: caught.code || 'TEMP_CLEANUP_INCOMPLETE' }); }
        continue;
      }
      if (!record.mid) {
        out.push({ status: 'HOLD', claimId: record.id, code: 'TEMP_MARKER_MISSING' });
        continue;
      }
      if ((lease.root_removed || (['CLEANING', 'CLEANUP_INCOMPLETE', 'REMOVED'].includes(lease.status) && lease.root_marker_removed))
          && isMissing(record.rp)) {
        try {
          await cleanupMeta(record, null, namespaceOwner);
          count += 1;
          out.push({ status: 'REMOVED', claimId: record.id, rootRemoved: false, evidence });
        } catch (caught) {
          out.push({ status: 'CLEANUP_INCOMPLETE', claimId: record.id, code: caught.code || 'TEMP_CLEANUP_INCOMPLETE' });
        }
        continue;
      }
      const result = await cleanup(record, retained ? 'retention-expired' : 'stale-recovery', namespaceOwner);
      if (result.status === 'REMOVED') {
        count += 1;
        out.push({ status: 'REMOVED', claimId: record.id, rootRemoved: true, evidence });
      } else out.push({ status: 'CLEANUP_INCOMPLETE', claimId: record.id, code: result.code });
    }
    for (const orphan of orphanLeaseInventory(ns)) {
      if (count >= LIMITS.recoveryCount) {
        out.push({ status: 'HOLD', claimPath: orphan.path, code: 'TEMP_RECOVERY_LIMIT' });
        continue;
      }
      try {
        out.push(await recoverOrphanLease(ns, orphan, namespaceOwner));
        count += 1;
      } catch (caught) {
        out.push({ status: 'HOLD', claimPath: orphan.path, code: caught.code || 'TEMP_OWNERSHIP_UNCERTAIN' });
      }
    }
    return out;
  });
}
async function shutdownOwnedTemps(reason) {
  const result = [];
  for (const r of [...active.values()]) {
    if (r.retained) {
      result.push({ claimId: r.id, status: 'RETAINED' });
      continue;
    }
    r.shutdownRequested = true;
    const terminal = await requestTerminal(r, 'cleanup', reason || 'controlled-shutdown');
    result.push({ claimId: r.id, status: terminal.status, code: terminal.code || null });
  }
  return result;
}

module.exports={LIMITS,SPEC_SCHEMA:SPEC,withOwnedTemp,shutdownOwnedTemps,inspectOwnedTemps,recoverStaleOwnedTemps};
