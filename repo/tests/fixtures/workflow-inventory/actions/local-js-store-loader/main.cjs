'use strict';
const registry = {};
registry.loader = require;
registry.loader('./target.cjs');
