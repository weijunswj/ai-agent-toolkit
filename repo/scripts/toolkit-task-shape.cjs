'use strict';

// Confirmed selection only. Callers retain their own uncertain-state continuity policy.
function confirmedTaskShape({ certain, governanceState } = {}) {
  if (certain !== true) return null;
  if (governanceState === 'ENABLED') return [...require('./toolkit-task-policy.cjs').GOVERNED_JOBS];
  if (['DISABLED', 'UNDECIDED'].includes(governanceState)) return [...require('./toolkit-task-policy.cjs').INDEPENDENT_JOBS];
  return null;
}

module.exports = { confirmedTaskShape };
