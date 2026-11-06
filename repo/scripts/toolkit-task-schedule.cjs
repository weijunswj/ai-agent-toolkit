'use strict';

// The registry owns stable per-computer minutes and records the known job owner.
// A local registry cannot discover another computer; callers must carry its enrolment
// when moving a repository between computers. An unknown remote owner grants nothing.
function assignment(entries, repository, computerId) {
  const windows = entries.filter(e => e.host === 'windows' && !e.adopted);
  const ours = windows.filter(e => String(e.repository).toLowerCase() === repository.toLowerCase());
  const owners = [...new Set(ours.map(e => e.job_owner).filter(Boolean))];
  const minutes = [...new Set(ours.map(e => e.repo_minute).filter(m => Number.isInteger(m) && m >= 1 && m <= 9))];
  if (owners.length > 1 || minutes.length > 1) return { conflict: 'conflicting job-owner or minute records; ask the owner to reconcile them' };
  if (owners.length && owners[0] !== computerId) return { conflict: `Jobs are owned by ${owners[0]}; ask the owner to move them using the host question UI before registering here` };
  const local = windows.filter(e => !e.job_owner || e.job_owner === computerId);
  const used = new Set(local.filter(e => String(e.repository).toLowerCase() !== repository.toLowerCase()).map(e => e.repo_minute));
  const minute = minutes[0] || Array.from({ length: 9 }, (_, i) => i + 1).find(m => !used.has(m)) || 1;
  return { minute, computerId, collision: used.has(minute) };
}

function scheduleFor(job, minute) {
  const m = String(minute).padStart(2, '0');
  return job === 'shard-timings' ? { kind: 'weekly', day: 'Monday', at: `08:${m}` } : { kind: 'hourly', at: `00:${m}`, hours: 24 };
}

module.exports = { assignment, scheduleFor };
