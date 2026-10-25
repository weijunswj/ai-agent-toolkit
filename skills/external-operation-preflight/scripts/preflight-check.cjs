#!/usr/bin/env node
'use strict';

// Preflight check for one live change on an outside system (a hosting provider, database, bucket,
// deployment platform or any other external service). It reads one JSON operation plan and returns
// ALLOW, ALLOW_WITH_NOTICE or HOLD with typed reasons. The controller runs it before asking the
// owner to approve; the approval names the plan hash it prints, and a changed plan goes back to
// planning.
//
// Read-only and offline: it never calls a provider, reads no credentials and writes nothing. It
// checks what the plan says, so every environment value in the plan must come from the provider's
// own read-back, never from a name or label.
//
// Usage: node preflight-check.cjs <plan.json> [--now <ISO date>]
//        node preflight-check.cjs --stdin [--now <ISO date>]
// Exit codes: 0 ALLOW or ALLOW_WITH_NOTICE, 2 HOLD, 1 usage error.

const crypto = require('node:crypto');
const fs = require('node:fs');

const PLAN_SCHEMA = 'toolkit.external-operation-plan.v1';
const RESULT_SCHEMA = 'toolkit.external-operation-preflight.v1';

const ROUTES = Object.freeze(['connector', 'mcp', 'api', 'cli', 'browser', 'computer_use']);
const ROUTE_OUTCOMES = Object.freeze(['selected', 'failed_before_effect', 'failed_after_effect', 'outcome_unknown']);
const TRIGGERS = Object.freeze(['NONE', 'MANUAL', 'AUTO_ON_MERGE', 'AUTO_ON_BRANCH_UPDATE', 'UNKNOWN']);
const ACCESS = Object.freeze(['read', 'write']);
const EFFECTS = Object.freeze(['allow', 'deny']);

const REASONS = Object.freeze({
  PLAN_INVALID: 'PLAN_INVALID',
  SECRET_IN_PLAN: 'SECRET_IN_PLAN',
  RESOURCE_IDENTITY_MISMATCH: 'RESOURCE_IDENTITY_MISMATCH',
  TEMPORARY_RESOURCE_INCOMPLETE: 'TEMPORARY_RESOURCE_INCOMPLETE',
  RESOURCE_AUTHORITY_PROJECTION_CONFLICT: 'RESOURCE_AUTHORITY_PROJECTION_CONFLICT',
  NOT_AUTHORISED: 'NOT_AUTHORISED',
  DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED: 'DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED',
  DEFER_MERGE: 'DEFER_MERGE',
  EVIDENCE_FREEZE_ACTIVE: 'EVIDENCE_FREEZE_ACTIVE',
  ROUTE_FALLBACK_REFUSED: 'ROUTE_FALLBACK_REFUSED',
  PRIOR_ATTEMPT_AMBIGUOUS: 'PRIOR_ATTEMPT_AMBIGUOUS'
});

// Secrets never enter a plan: only names and references. These shapes refuse the whole plan.
const SECRET_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /:\/\/[^/\s:@]+:[^/\s@]+@/
]);
const SECRET_KEY_NAME = /(?:^|_)(?:password|passwd|secret|token|api_?key|private_?key|credential)s?$/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function envName(value) {
  return text(value).toLowerCase();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function planHash(plan) {
  return crypto.createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

function findSecrets(value, trail, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSecrets(item, `${trail}[${index}]`, found));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const where = trail ? `${trail}.${key}` : key;
      // A key named like a secret may only hold a reference (a key name such as COOLIFY_TOKEN), never a value.
      if (SECRET_KEY_NAME.test(key) && typeof item === 'string' && item && !/^[A-Z][A-Z0-9_]*$/.test(item)) {
        found.push(where);
      }
      findSecrets(item, where, found);
    }
  } else if (typeof value === 'string' && SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    found.push(trail);
  }
  return found;
}

function parseDate(value) {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function hold(reasons, code, detail) {
  reasons.push({ code, detail });
}

function validateShape(plan) {
  const problems = [];
  if (!isObject(plan)) return ['the plan must be a JSON object'];
  if (plan.schema !== PLAN_SCHEMA) problems.push(`schema must be ${PLAN_SCHEMA}`);
  const op = plan.operation;
  if (!isObject(op)) problems.push('operation is required');
  else {
    if (!text(op.action)) problems.push('operation.action is required');
    if (!envName(op.environment)) problems.push('operation.environment is required (one environment name)');
    if (!Array.isArray(op.targets) || op.targets.length === 0) problems.push('operation.targets must name at least one target id');
  }
  for (const key of ['targets', 'resources', 'bindings', 'authority']) {
    if (!Array.isArray(plan[key])) problems.push(`${key} must be a list`);
  }
  for (const key of ['exceptions', 'routes']) {
    if (plan[key] !== undefined && !Array.isArray(plan[key])) problems.push(`${key} must be a list when present`);
  }
  if (problems.length) return problems;

  const ids = new Set();
  for (const [index, item] of [...plan.targets, ...plan.resources].entries()) {
    if (!isObject(item) || !text(item.id)) {
      problems.push(`target or resource ${index + 1} needs an id`);
      continue;
    }
    if (ids.has(item.id)) problems.push(`id ${item.id} is used twice`);
    ids.add(item.id);
    if (!envName(item.provider_environment)) problems.push(`${item.id}: provider_environment (read back from the provider) is required`);
  }
  for (const target of plan.targets) {
    if (isObject(target) && !envName(target.environment)) problems.push(`${target.id}: environment is required`);
  }
  for (const resource of plan.resources) {
    if (isObject(resource) && !envName(resource.name_environment)) problems.push(`${resource.id}: name_environment is required`);
  }
  const targetIds = new Set(plan.targets.filter(isObject).map((target) => target.id));
  const resourceIds = new Set(plan.resources.filter(isObject).map((resource) => resource.id));
  for (const id of op.targets) {
    if (!targetIds.has(id)) problems.push(`operation.targets names unknown target ${id}`);
  }
  for (const [index, binding] of plan.bindings.entries()) {
    if (!isObject(binding) || !targetIds.has(binding.target) || !resourceIds.has(binding.resource)) {
      problems.push(`binding ${index + 1} must name a known target and resource`);
    } else if (!ACCESS.includes(binding.access)) {
      problems.push(`binding ${index + 1}: access must be one of ${ACCESS.join(', ')}`);
    }
  }
  for (const [index, entry] of plan.authority.entries()) {
    if (!isObject(entry) || !text(entry.resource) || !text(entry.action) || !envName(entry.scope) || !EFFECTS.includes(entry.effect)) {
      problems.push(`authority entry ${index + 1} needs resource, action, scope and effect (allow or deny)`);
    }
  }
  if (op.actions !== undefined) {
    if (!Array.isArray(op.actions)) problems.push('operation.actions must be a list when present');
    else {
      for (const [index, action] of op.actions.entries()) {
        if (!isObject(action) || !text(action.resource) || !text(action.action)) {
          problems.push(`operation.actions entry ${index + 1} needs resource and action`);
        }
      }
    }
  }
  const downstream = plan.downstream;
  if (downstream !== undefined) {
    if (!isObject(downstream)) problems.push('downstream must be an object when present');
    else if (!TRIGGERS.includes(downstream.trigger)) problems.push(`downstream.trigger must be one of ${TRIGGERS.join(', ')}`);
  }
  for (const [index, route] of (plan.routes || []).entries()) {
    if (!isObject(route) || !ROUTES.includes(route.route) || !ROUTE_OUTCOMES.includes(route.outcome)) {
      problems.push(`route ${index + 1} needs route (${ROUTES.join(', ')}) and outcome (${ROUTE_OUTCOMES.join(', ')})`);
    }
  }
  return problems;
}

function exceptionCovers(exception, resourceId, environment, now) {
  if (!isObject(exception)) return false;
  const resources = Array.isArray(exception.resources) ? exception.resources : [];
  const environments = Array.isArray(exception.environments) ? exception.environments.map(envName) : [];
  const end = parseDate(exception.end_date);
  return resources.includes(resourceId) &&
    environments.includes(environment) &&
    Boolean(text(exception.reason)) &&
    end !== null && end >= now;
}

function checkIdentity(plan, reasons, notices, now) {
  const op = plan.operation;
  const opEnv = envName(op.environment);
  const targets = new Map(plan.targets.map((target) => [target.id, target]));
  const resources = new Map(plan.resources.map((resource) => [resource.id, resource]));

  for (const target of plan.targets) {
    if (envName(target.environment) !== envName(target.provider_environment)) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `target ${target.id}: the plan says ${envName(target.environment)} but the provider says ${envName(target.provider_environment)}`);
    }
  }
  for (const id of op.targets) {
    const target = targets.get(id);
    if (envName(target.environment) !== opEnv) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `target ${id} is ${envName(target.environment)}, but the operation is bound to ${opEnv}; one operation changes one environment`);
    }
  }
  for (const resource of plan.resources) {
    if (envName(resource.name_environment) !== envName(resource.provider_environment)) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `resource ${resource.id}: its name says ${envName(resource.name_environment)} but the provider says ${envName(resource.provider_environment)}`);
    }
  }

  // Every binding stays inside one environment unless an owner exception names the resource,
  // the environment, a reason and an end date that has not passed.
  const writersByResource = new Map();
  for (const binding of plan.bindings) {
    const target = targets.get(binding.target);
    const resource = resources.get(binding.resource);
    const targetEnv = envName(target.environment);
    const resourceEnv = envName(resource.provider_environment);
    if (binding.access === 'write') {
      if (!writersByResource.has(resource.id)) writersByResource.set(resource.id, new Set());
      writersByResource.get(resource.id).add(targetEnv);
    }
    if (targetEnv === resourceEnv) continue;
    const exception = (plan.exceptions || []).find((item) => exceptionCovers(item, resource.id, targetEnv, now));
    if (exception) {
      notices.push(`owner exception: ${targetEnv} target ${target.id} uses ${resourceEnv} resource ${resource.id} until ${exception.end_date} (${text(exception.reason)})`);
    } else {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `${targetEnv} target ${target.id} is bound (${binding.access}) to ${resourceEnv} resource ${resource.id}`);
    }
  }
  for (const [resourceId, environments] of writersByResource) {
    if (environments.size < 2) continue;
    const covered = [...environments].every((environment) =>
      environment === envName(resources.get(resourceId).provider_environment) ||
      (plan.exceptions || []).some((item) => exceptionCovers(item, resourceId, environment, now)));
    if (!covered) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `resource ${resourceId} is writable from more than one environment (${[...environments].sort().join(', ')})`);
    }
  }
}

function checkTemporary(plan, reasons, now) {
  for (const resource of plan.resources) {
    if (resource.temporary !== true) continue;
    const missing = [];
    if (resource.temporary_name !== true) missing.push('a temporary name');
    if (!text(resource.data_rule)) missing.push('a data rule');
    if (!text(resource.cleanup_owner)) missing.push('a cleanup owner');
    const end = parseDate(resource.end_date);
    if (end === null) missing.push('an end date');
    else if (end < now) missing.push('an end date that has not passed');
    if (resource.removal_read_back !== 'provider') missing.push('a provider read-back on removal');
    if (missing.length) {
      hold(reasons, REASONS.TEMPORARY_RESOURCE_INCOMPLETE, `temporary resource ${resource.id} needs ${missing.join(', ')}`);
    }
  }
}

function checkAuthority(plan, reasons) {
  const op = plan.operation;
  const scope = envName(op.environment);
  const requested = Array.isArray(op.actions)
    ? op.actions.map((item) => ({ resource: item.resource, action: item.action }))
    : op.targets.map((id) => ({ resource: id, action: op.action }));
  for (const request of requested) {
    // Exact match only: anything not listed is refused.
    const matches = plan.authority.filter((entry) =>
      entry.resource === request.resource && entry.action === request.action && envName(entry.scope) === scope);
    const effects = new Set(matches.map((entry) => entry.effect));
    if (effects.size > 1) {
      hold(reasons, REASONS.RESOURCE_AUTHORITY_PROJECTION_CONFLICT,
        `authority entries both allow and deny ${request.action} on ${request.resource} in ${scope}`);
    } else if (!effects.has('allow')) {
      hold(reasons, REASONS.NOT_AUTHORISED, `no authority entry allows ${request.action} on ${request.resource} in ${scope}`);
    }
  }
}

function checkDownstream(plan, reasons, result) {
  const downstream = plan.downstream;
  const isMerge = envName(plan.operation.action) === 'merge';
  if (downstream === undefined) {
    if (isMerge) {
      hold(reasons, REASONS.DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED,
        'a merge must state what it sets off (downstream.trigger); an unknown coupling stops the action');
    }
    return;
  }
  const trigger = downstream.trigger;
  if (trigger === 'UNKNOWN') {
    hold(reasons, REASONS.DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED, 'the downstream trigger is unknown; find out what this action sets off first');
    return;
  }
  if (trigger === 'NONE' || trigger === 'MANUAL') {
    result.outcome = 'NO_COUPLED_EFFECT';
    return;
  }
  // An automatic trigger: the action is also a deployment.
  if (downstream.deployment_approved === true) {
    if (downstream.evidence_freeze === true && downstream.freeze_end_approved !== true) {
      hold(reasons, REASONS.EVIDENCE_FREEZE_ACTIVE,
        'an evidence freeze is active and the approval does not say this deployment ends it');
      return;
    }
    result.outcome = 'MERGE_WITH_COUPLED_DEPLOYMENT_ACCEPTED';
    result.required_read_back.push('after the action: read back the running revision and health from the provider');
    if (downstream.evidence_freeze === true) result.required_read_back.push('record that this deployment ended the evidence freeze');
    return;
  }
  if (downstream.pause_read_back === true) {
    result.outcome = 'PAUSE_TRIGGER_THEN_MERGE';
    result.required_read_back.push('after the action: prove from the provider that no deployment ran');
    result.required_read_back.push('then restore the trigger, or keep the pause as its own recorded change, with before and after read-back');
    return;
  }
  hold(reasons, REASONS.DEFER_MERGE,
    `the ${trigger} trigger would deploy, and neither the deployment nor a read-back trigger pause is approved; hold the action`);
}

function checkRoutes(plan, reasons, notices) {
  const routes = plan.routes || [];
  if (routes.length === 0) return;
  const selected = routes.filter((route) => route.outcome === 'selected');
  if (selected.length !== 1 || routes[routes.length - 1].outcome !== 'selected') {
    hold(reasons, REASONS.PLAN_INVALID, 'routes must end with exactly one selected route');
    return;
  }
  const unclear = routes.filter((route) => route.outcome === 'failed_after_effect' || route.outcome === 'outcome_unknown');
  if (unclear.length) {
    hold(reasons, REASONS.PRIOR_ATTEMPT_AMBIGUOUS,
      `an earlier route (${unclear.map((route) => route.route).join(', ')}) may have changed something; recover and read back before any retry`);
    return;
  }
  if (routes.length === 1) return;
  const first = routes[0];
  const chosen = selected[0];
  const same = ['target', 'privilege', 'effect'].every((key) => text(chosen[key]) && text(chosen[key]) === text(first[key]));
  if (chosen.pre_approved !== true || !same) {
    hold(reasons, REASONS.ROUTE_FALLBACK_REFUSED,
      `fallback route ${chosen.route} must be pre-approved and keep the same target, privilege and effect as ${first.route}`);
    return;
  }
  const failed = routes.slice(0, -1).map((route) => route.route).join(', ');
  notices.push(`degraded route: ${failed} failed before doing anything; ${chosen.route} runs instead; tell the user about the failure`);
}

function checkPlan(plan, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  const result = {
    schema: RESULT_SCHEMA,
    verdict: 'HOLD',
    reasons: [],
    notices: [],
    outcome: null,
    required_read_back: [],
    plan_sha256: isObject(plan) ? planHash(plan) : null
  };
  const problems = validateShape(plan);
  if (problems.length) {
    for (const problem of problems) hold(result.reasons, REASONS.PLAN_INVALID, problem);
    return result;
  }
  const secrets = findSecrets(plan, '', []);
  if (secrets.length) {
    for (const where of secrets) {
      hold(result.reasons, REASONS.SECRET_IN_PLAN, `${where} looks like a secret value; plans carry key names and references only`);
    }
    return result;
  }
  checkIdentity(plan, result.reasons, result.notices, now);
  checkTemporary(plan, result.reasons, now);
  checkAuthority(plan, result.reasons);
  checkDownstream(plan, result.reasons, result);
  checkRoutes(plan, result.reasons, result.notices);
  if (result.reasons.length) {
    result.outcome = null;
    result.required_read_back = [];
    return result;
  }
  result.verdict = result.notices.length ? 'ALLOW_WITH_NOTICE' : 'ALLOW';
  return result;
}

function parseArgs(argv) {
  const args = { file: '', stdin: false, now: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--stdin') args.stdin = true;
    else if (arg === '--now') args.now = argv[++index];
    else if (arg.startsWith('--now=')) args.now = arg.slice('--now='.length);
    else if (!arg.startsWith('-') && !args.file) args.file = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.stdin === Boolean(args.file)) throw new Error('usage: preflight-check.cjs <plan.json> | --stdin [--now <ISO date>]');
  if (args.now !== undefined) {
    const now = parseDate(args.now);
    if (now === null) throw new Error('--now needs an ISO date such as 2026-10-25');
    args.now = now;
  }
  return args;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(args.stdin ? 0 : args.file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    process.stderr.write(`could not read the plan as JSON: ${error.message}\n`);
    return 1;
  }
  const result = checkPlan(plan, { now: args.now });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.verdict === 'HOLD' ? 2 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { PLAN_SCHEMA, REASONS, TRIGGERS, checkPlan, planHash };
