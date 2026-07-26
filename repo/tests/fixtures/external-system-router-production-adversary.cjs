'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const [scenario, publishedRouterPath, authoritativeRouterPath, syntheticRoot] = process.argv.slice(2);
const coreCalls = [];

function patchCoreExports() {
  const originalRealpath = fs.realpathSync;
  const originalNativeRealpath = fs.realpathSync.native;
  os.userInfo = () => {
    coreCalls.push('os.userInfo');
    return Object.freeze({
      uid: -1,
      gid: -1,
      username: 'synthetic-user',
      homedir: syntheticRoot,
      shell: null
    });
  };
  fs.realpathSync = (value) => {
    coreCalls.push('fs.realpathSync');
    return originalRealpath(value);
  };
  fs.realpathSync.native = (value) => {
    coreCalls.push('fs.realpathSync.native');
    return originalNativeRealpath(value);
  };
  for (const name of ['lstatSync', 'openSync', 'fstatSync', 'readFileSync']) {
    const original = fs[name];
    fs[name] = (...args) => {
      coreCalls.push(`fs.${name}`);
      return original(...args);
    };
  }
}

function attemptPublicAuthority(router) {
  const results = {
    authority: false,
    plan: false,
    route: false,
    receipt: false,
    codes: []
  };
  let authority;
  try {
    authority = router.loadTrustedInventorySnapshot();
    results.authority = Boolean(authority);
  } catch (error) {
    results.codes.push(error.code || 'UNCLASSIFIED');
  }
  try {
    router.buildHostAdapterPlan(authority || {}, {
      provider: 'synthetic',
      targetAlias: 'synthetic-target',
      environment: 'production'
    }, 'codex', []);
    results.plan = true;
  } catch (error) {
    results.codes.push(error.code || 'UNCLASSIFIED');
  }
  try {
    router.selectStrongestAdmissibleInterface({}, [], {
      inventoryAuthority: authority || {}
    });
    results.route = true;
  } catch (error) {
    results.codes.push(error.code || 'UNCLASSIFIED');
  }
  try {
    router.createOperationReceipt({
      authorisationEnvelope: {},
      selectedRoute: {}
    });
    results.receipt = true;
  } catch (error) {
    results.codes.push(error.code || 'UNCLASSIFIED');
  }
  return results;
}

let published;
let authoritative;
if (scenario === 'before-require') {
  patchCoreExports();
  published = require(publishedRouterPath);
} else if (scenario === 'after-require') {
  published = require(publishedRouterPath);
  patchCoreExports();
} else if (scenario === 'module-load') {
  const originalLoad = Module._load;
  Module._load = function patchedModuleLoad(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    if (request === 'node:fs' || request === 'fs' || request === 'node:os' || request === 'os') {
      return loaded;
    }
    return loaded;
  };
  patchCoreExports();
  published = require(publishedRouterPath);
} else if (scenario === 'cache-reload') {
  published = require(publishedRouterPath);
  patchCoreExports();
  delete require.cache[require.resolve(publishedRouterPath)];
  published = require(publishedRouterPath);
} else if (scenario === 'cross-copy') {
  authoritative = require(authoritativeRouterPath);
  patchCoreExports();
  published = require(publishedRouterPath);
} else if (scenario === 'reverse-cross-copy') {
  published = require(publishedRouterPath);
  patchCoreExports();
  authoritative = require(authoritativeRouterPath);
} else {
  throw new Error('Unsupported deterministic adversary scenario.');
}

const moduleLoadCoreCalls = [...coreCalls];
coreCalls.length = 0;
const publishedAttempt = attemptPublicAuthority(published);
const authoritativeAttempt = authoritative ? attemptPublicAuthority(authoritative) : null;
const report = {
  scenario,
  published: publishedAttempt,
  authoritative: authoritativeAttempt,
  moduleLoadCoreCalls,
  authorityCoreCalls: coreCalls,
  exportsMatch: authoritative
    ? JSON.stringify(Object.keys(published).sort()) === JSON.stringify(Object.keys(authoritative).sort())
    : true
};
process.stdout.write(`${JSON.stringify(report)}\n`);
