'use strict';

// The registry owns stable per-computer minutes and records the known job owner.
// This is local ownership only; it neither discovers nor transfers remote jobs.
function assignment(entries, repository, computerId, { recoverStopped = false } = {}) {
  const windows = entries.filter(e => e.host === 'windows' && !e.adopted && e.job !== 'task-health');
  const ours = windows.filter(e => String(e.repository).toLowerCase() === repository.toLowerCase());
  const owners = [...new Set(ours.map(e => e.job_owner).filter(Boolean))];
  const minutes = [...new Set(ours.map(e => e.repo_minute).filter(m => Number.isInteger(m) && m >= 1 && m <= 9))];
  const { localTaskOwner, OWNER_RECOVERY } = require('./toolkit-tasks.cjs');
  const recovering = recoverStopped && ours.every(e => localTaskOwner(e.job_owner, computerId) || e.stopped_by_owner);
  const conflictingOwners = owners.length > 1 && owners.some(owner => !localTaskOwner(owner, computerId));
  if (conflictingOwners && !recovering || minutes.length > 1) return { conflict: 'conflicting job-owner or minute records; ask the owner to reconcile them' };
  const foreign = owners.find(owner => !localTaskOwner(owner, computerId));
  if (foreign && !recovering) return { conflict: `Jobs are owned by ${foreign}; ${OWNER_RECOVERY}` };
  const local = windows.filter(e => localTaskOwner(e.job_owner, computerId));
  const used = new Set(local.filter(e => String(e.repository).toLowerCase() !== repository.toLowerCase()).map(e => e.repo_minute));
  const minute = minutes[0] || Array.from({ length: 9 }, (_, i) => i + 1).find(m => !used.has(m)) || 1;
  return { minute, computerId, collision: used.has(minute) };
}

function scheduleFor(job, minute) {
  const m = String(minute).padStart(2, '0');
  if (job === 'task-health') return { kind: 'daily', at: `07:5${minute}` };
  return job === 'shard-timings' ? { kind: 'weekly', day: 'Monday', at: `08:${m}` } : { kind: 'hourly', at: `00:${m}`, hours: 24 };
}

module.exports = { assignment, scheduleFor };
