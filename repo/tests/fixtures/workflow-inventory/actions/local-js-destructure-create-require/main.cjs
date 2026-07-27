'use strict';
const { createRequire } = require('node:module');
const loader = createRequire(import.meta.url);
loader('./target.cjs');
