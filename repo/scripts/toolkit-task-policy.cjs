'use strict';

// This list is used by the planner. Adding a job here does
// not enrol it or grant approval: the health job is computer-wide and the footer job is per repository.
const INDEPENDENT_JOBS = Object.freeze(['footer-sweep', 'task-health']);
const GOVERNED_JOBS = Object.freeze(['programme-sweep', 'shard-timings']);
const STANDING_APPROVAL = 'standing approval with verified ownership';

module.exports = { INDEPENDENT_JOBS, GOVERNED_JOBS, STANDING_APPROVAL };
