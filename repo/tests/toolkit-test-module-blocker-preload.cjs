'use strict';

// Test-only preload (node --require): makes the Toolkit modules named in
// TOOLKIT_TEST_BLOCKED_MODULES (comma-separated file names) fail to load, so a hook test can prove
// what the real hook file does when a decision module is missing, without copying files out of the
// checkout. Loaded only by tests that pass it explicitly.

const Module = require('node:module');
const path = require('node:path');

const blocked = new Set(String(process.env.TOOLKIT_TEST_BLOCKED_MODULES || '').split(',').map(name => name.trim()).filter(Boolean));
if (blocked.size > 0) {
  const load = Module._load;
  Module._load = function blockedLoad(request, parent, isMain) {
    if (!isMain && blocked.has(path.basename(String(request)))) {
      const error = new Error(`Cannot find module '${request}' (blocked by the test)`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return load.apply(this, arguments);
  };
}
