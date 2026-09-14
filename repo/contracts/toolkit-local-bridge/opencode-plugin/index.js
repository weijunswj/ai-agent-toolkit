'use strict';

const manifest = Object.freeze({
  name: 'ai-agent-toolkit-opencode',
  version: '2.11.1',
  host: 'opencode',
  authority: 'capability-proven-host-adapter',
  skills_only: true,
  selects_models: false,
  selects_speed: false,
  legacy_bridge_removal: 'separately-authorised-transition'
});

function createPlugin(context = {}) {
  return Object.freeze({
    manifest,
    context: Object.freeze({ host: context.host || 'opencode' }),
    resolveRoute: context.resolveRoute,
    proveCapability: context.proveCapability,
    executeExactLaunch: context.executeExactLaunch
  });
}

module.exports = Object.freeze({ manifest, createPlugin });
