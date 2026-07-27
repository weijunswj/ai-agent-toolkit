'use strict';
const { createRequire } = require('node:module');
const r = createRequire(import.meta.url);
r('./target.cjs');
