'use strict';

// Confirmed selection only. Callers retain their own uncertain-state continuity policy.
function confirmedTaskShape({ certain, governanceState } = {}) {
  if (certain !== true) return null;
  if (governanceState === 'ENABLED') return ['programme-sweep', 'shard-timings'];
  if (['DISABLED', 'UNDECIDED'].includes(governanceState)) return ['footer-sweep'];
  return null;
}

module.exports = { confirmedTaskShape };
