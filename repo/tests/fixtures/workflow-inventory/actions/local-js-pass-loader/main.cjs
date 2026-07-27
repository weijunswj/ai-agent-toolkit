'use strict';
function run(loader) {
  loader('./target.cjs');
}
run(require);
