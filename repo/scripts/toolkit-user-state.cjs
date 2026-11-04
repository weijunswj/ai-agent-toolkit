'use strict';

// Resolves private operational state, never a governance decision. Overrides are test-only.
const os = require('node:os');
const path = require('node:path');
function userStateDirectory(options = {}) {
  const overridden = ['stateDirectory', 'registryPath', 'userHome'].some(key => options[key] !== undefined);
  if (overridden && options.testOnly !== true) throw Object.assign(new Error('STATE_PATH_OVERRIDE_FORBIDDEN'), { code: 'STATE_PATH_OVERRIDE_FORBIDDEN' });
  // registryPath is retained only for existing isolated test fixtures, never opened.
  const directory = options.stateDirectory ?? (options.registryPath === undefined ? null : path.dirname(options.registryPath));
  const home = options.userHome ?? os.homedir();
  const value = directory ?? path.join(home, '.ai-agent-toolkit', 'user-state');
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Object.assign(new Error('STATE_PATH_INVALID'), { code: 'STATE_PATH_INVALID' });
  return path.normalize(value);
}
module.exports = Object.freeze({ userStateDirectory });
