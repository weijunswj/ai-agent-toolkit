'use strict';
const consume = (m) => m.require('./target.cjs');
consume(require.main);
