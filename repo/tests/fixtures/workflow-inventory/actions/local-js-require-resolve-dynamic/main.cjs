'use strict';
const value = process.env.TARGET || './target.cjs';
const resolved = require.resolve(value);
process.exitCode = 0;
