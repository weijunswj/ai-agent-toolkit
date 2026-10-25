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
// own read-back, never from a name or label. It fails closed: a missing, unknown or malformed field
// that could restrict the change holds the plan instead of being read as "no restriction".
//
// Usage: node preflight-check.cjs <plan.json> [--now <YYYY-MM-DD>]
//        node preflight-check.cjs --stdin [--now <YYYY-MM-DD>]
// Exit codes: 0 ALLOW or ALLOW_WITH_NOTICE, 2 HOLD, 1 usage error.

const crypto = require('node:crypto');
const fs = require('node:fs');

const PLAN_SCHEMA = 'toolkit.external-operation-plan.v1';
const RESULT_SCHEMA = 'toolkit.external-operation-preflight.v1';

const ROUTES = Object.freeze(['connector', 'mcp', 'api', 'cli', 'browser', 'computer_use']);
const ROUTE_OUTCOMES = Object.freeze(['selected', 'failed_before_effect', 'failed_after_effect', 'outcome_unknown']);
const TRIGGERS = Object.freeze(['NONE', 'MANUAL', 'AUTO_ON_MERGE', 'AUTO_ON_BRANCH_UPDATE', 'UNKNOWN']);
const AUTO_TRIGGERS = Object.freeze(['AUTO_ON_MERGE', 'AUTO_ON_BRANCH_UPDATE']);
const DOWNSTREAM_FLAGS = Object.freeze(['deployment_approved', 'pause_read_back', 'evidence_freeze', 'freeze_end_approved']);
const ACCESS = Object.freeze(['read', 'write']);
const EFFECTS = Object.freeze(['allow', 'deny']);
// Environment names are split into words (prod-eu is prod and eu). A name with any of these words is
// always temporary: it needs cleanup, whatever the plan says.
const TEMPORARY_WORDS = Object.freeze(['test', 'testing', 'preview', 'restore', 'drill']);
// A name is non-production only when it has one of these words and no production word. Every other
// name, including an unknown one such as main or prd, counts as production.
const NON_PRODUCTION_WORDS = Object.freeze([
  'alpha', 'beta', 'staging', 'stage', 'dev', 'development', 'test', 'testing', 'qa', 'uat', 'sandbox',
  'preview', 'restore', 'drill', 'local'
]);
const PRODUCTION_WORDS = Object.freeze(['production', 'prod', 'prd', 'live']);
// Production actions that cannot change stored data. Every other production action, including a
// deploy or merge that may run migrations, needs backup evidence.
const NO_DATA_ACTIONS = Object.freeze(['restart', 'pause_trigger', 'resume_trigger']);
// The backup evidence ladder from references/backup-and-recovery.md, lowest first.
const BACKUP_LEVELS = Object.freeze([
  'configured', 'local_copy', 'uploaded', 'retrievable', 'database_recoverable', 'fully_recoverable'
]);
const MIN_BACKUP_LEVEL = 'retrievable';

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
  ROLLBACK_EVIDENCE_MISSING: 'ROLLBACK_EVIDENCE_MISSING',
  BACKUP_EVIDENCE_MISSING: 'BACKUP_EVIDENCE_MISSING',
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
// Matches snake_case, kebab-case and camelCase key names that hold a secret.
const SECRET_KEY_NAME = /(?:password|passwd|passphrase|secret|token|api_?key|apikey|private_?key|credential)s?$/i;
// A reference is a key name in the toolkit-env shape: upper case, at least three parts.
const KEY_REFERENCE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}$/;

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
      if (SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
        found.push(trail || '(top level key)');
        continue;
      }
      // A key named like a secret may only hold a key-name reference such as COOLIFY_ALPHA_TOKEN.
      if (SECRET_KEY_NAME.test(key) &&
          (typeof item === 'number' || (typeof item === 'string' && item !== '' && !KEY_REFERENCE.test(item)))) {
        found.push(where);
        continue;
      }
      findSecrets(item, where, found);
    }
  } else if (typeof value === 'string' && SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    found.push(trail || '(top level)');
  }
  return found;
}

// A real calendar date (YYYY-MM-DD, optional time); 2026-02-30 is refused.
function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text(value));
  if (!match) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (day.getUTCFullYear() !== Number(match[1]) || day.getUTCMonth() !== Number(match[2]) - 1 || day.getUTCDate() !== Number(match[3])) {
    return null;
  }
  return time;
}

function hold(reasons, code, detail) {
  reasons.push({ code, detail });
}

function environmentWords(environment) {
  return envName(environment).split(/[^a-z0-9]+/).filter(Boolean);
}

function isProduction(environment) {
  const words = environmentWords(environment);
  if (words.some((word) => PRODUCTION_WORDS.includes(word))) return true;
  return !words.some((word) => NON_PRODUCTION_WORDS.includes(word));
}

function isTemporaryEnvironment(environment) {
  return environmentWords(environment).some((word) => TEMPORARY_WORDS.includes(word));
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
  if (!isObject(plan.downstream)) {
    problems.push('downstream is required: state what this action sets off (trigger NONE when nothing)');
  }
  if (problems.length) return problems;

  const ids = new Set();
  for (const [index, item] of [...plan.targets, ...plan.resources].entries()) {
    if (!isObject(item) || !text(item.id)) {
      problems.push(`target or resource ${index + 1} needs an id`);
      continue;
    }
    if (ids.has(item.id)) problems.push(`target or resource ${index + 1}: its id is used twice`);
    ids.add(item.id);
    if (!envName(item.provider_environment)) problems.push(`${item.id}: provider_environment (read back from the provider) is required`);
    if (typeof item.temporary !== 'boolean') problems.push(`${item.id}: temporary must be true or false`);
  }
  for (const target of plan.targets) {
    if (isObject(target) && !envName(target.environment)) problems.push(`${target.id}: environment is required`);
  }
  for (const resource of plan.resources) {
    if (isObject(resource) && !envName(resource.name_environment)) problems.push(`${resource.id}: name_environment is required`);
  }
  if (problems.length) return problems;

  const targetIds = new Set(plan.targets.map((target) => target.id));
  op.targets.forEach((id, index) => {
    if (!targetIds.has(id)) problems.push(`operation.targets entry ${index + 1} is not a declared target`);
  });
  if (op.actions !== undefined) {
    if (!Array.isArray(op.actions) || op.actions.length === 0) {
      problems.push('operation.actions must list at least one action when present');
    } else {
      op.actions.forEach((action, index) => {
        if (!isObject(action) || !text(action.resource) || !text(action.action)) {
          problems.push(`operation.actions entry ${index + 1} needs resource and action`);
        } else if (!ids.has(action.resource)) {
          problems.push(`operation.actions entry ${index + 1} names an undeclared target or resource`);
        }
      });
    }
  }
  const resourceIds = new Set(plan.resources.map((resource) => resource.id));
  plan.bindings.forEach((binding, index) => {
    if (!isObject(binding) || !targetIds.has(binding.target) || !resourceIds.has(binding.resource)) {
      problems.push(`binding ${index + 1} must name a declared target and resource`);
    } else if (!ACCESS.includes(binding.access)) {
      problems.push(`binding ${index + 1}: access must be one of ${ACCESS.join(', ')}`);
    }
  });
  plan.authority.forEach((entry, index) => {
    if (!isObject(entry) || !text(entry.resource) || !text(entry.action) || !envName(entry.scope) || !EFFECTS.includes(entry.effect)) {
      problems.push(`authority entry ${index + 1} needs resource, action, scope and effect (allow or deny)`);
    }
  });
  (plan.exceptions || []).forEach((exception, index) => {
    const strings = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === 'string' && item.trim());
    if (!isObject(exception) || !strings(exception.resources) || !strings(exception.environments)) {
      problems.push(`exception ${index + 1} needs resources and environments lists, a reason and an end date`);
    }
  });

  const downstream = plan.downstream;
  if (!TRIGGERS.includes(downstream.trigger)) problems.push(`downstream.trigger must be one of ${TRIGGERS.join(', ')}`);
  for (const flag of DOWNSTREAM_FLAGS) {
    const value = downstream[flag];
    if (AUTO_TRIGGERS.includes(downstream.trigger) && typeof value !== 'boolean') {
      problems.push(`downstream.${flag} must be true or false for an automatic trigger`);
    } else if (value !== undefined && typeof value !== 'boolean') {
      problems.push(`downstream.${flag} must be true or false`);
    }
  }

  (plan.routes || []).forEach((route, index) => {
    if (!isObject(route) || !ROUTES.includes(route.route) || !ROUTE_OUTCOMES.includes(route.outcome)) {
      problems.push(`route ${index + 1} needs route (${ROUTES.join(', ')}) and outcome (${ROUTE_OUTCOMES.join(', ')})`);
    } else if (route.pre_approved !== undefined && typeof route.pre_approved !== 'boolean') {
      problems.push(`route ${index + 1}: pre_approved must be true or false`);
    }
  });

  if (op.rollback !== undefined && !isObject(op.rollback)) problems.push('operation.rollback must be an object when present');
  if (op.backup_evidence !== undefined && !isObject(op.backup_evidence)) {
    problems.push('operation.backup_evidence must be an object when present');
  }
  return problems;
}

function exceptionCovers(exception, resourceId, environment, now) {
  const end = parseDate(exception.end_date);
  return exception.resources.includes(resourceId) &&
    exception.environments.map(envName).includes(environment) &&
    Boolean(text(exception.reason)) &&
    end !== null && end >= now;
}

function environmentOf(plan, id) {
  const target = plan.targets.find((item) => item.id === id);
  if (target) return envName(target.environment);
  return envName(plan.resources.find((item) => item.id === id).provider_environment);
}

// Every action the operation takes: its own action on each target, plus any extra actions listed.
function requestedActions(plan) {
  const op = plan.operation;
  const requested = op.targets.map((id) => ({ resource: id, action: op.action }));
  for (const item of op.actions || []) {
    if (!requested.some((entry) => entry.resource === item.resource && entry.action === item.action)) {
      requested.push({ resource: item.resource, action: item.action });
    }
  }
  return requested;
}

function checkIdentity(plan, reasons, notices, now) {
  const opEnv = envName(plan.operation.environment);
  const targets = new Map(plan.targets.map((target) => [target.id, target]));
  const resources = new Map(plan.resources.map((resource) => [resource.id, resource]));

  for (const target of plan.targets) {
    if (envName(target.environment) !== envName(target.provider_environment)) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `target ${target.id}: the plan says ${envName(target.environment)} but the provider says ${envName(target.provider_environment)}`);
    }
  }
  for (const resource of plan.resources) {
    if (envName(resource.name_environment) !== envName(resource.provider_environment)) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `resource ${resource.id}: its name says ${envName(resource.name_environment)} but the provider says ${envName(resource.provider_environment)}`);
    }
  }
  // One operation changes one environment: every action's target or resource must be in it.
  for (const request of requestedActions(plan)) {
    const environment = environmentOf(plan, request.resource);
    if (environment !== opEnv) {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `${request.action} on ${request.resource} touches ${environment}, but the operation is bound to ${opEnv}`);
    }
  }
  // Every binding stays inside one environment unless an owner exception names the resource, the
  // environment, a reason and an end date that has not passed. A store writable from two
  // environments always has a binding that crosses, so this also refuses shared stores.
  for (const binding of plan.bindings) {
    const target = targets.get(binding.target);
    const resource = resources.get(binding.resource);
    const targetEnv = envName(target.environment);
    const resourceEnv = envName(resource.provider_environment);
    if (targetEnv === resourceEnv) continue;
    const exception = (plan.exceptions || []).find((item) => exceptionCovers(item, resource.id, targetEnv, now));
    if (exception) {
      notices.push(`owner exception: ${targetEnv} target ${target.id} uses ${resourceEnv} resource ${resource.id} until ${exception.end_date} (${text(exception.reason)})`);
    } else {
      hold(reasons, REASONS.RESOURCE_IDENTITY_MISMATCH,
        `${targetEnv} target ${target.id} is bound (${binding.access}) to ${resourceEnv} resource ${resource.id}`);
    }
  }
}

function checkTemporary(plan, reasons, now) {
  for (const item of [...plan.targets, ...plan.resources]) {
    const environment = envName(item.provider_environment);
    if (item.temporary !== true) {
      if (isTemporaryEnvironment(environment)) {
        hold(reasons, REASONS.TEMPORARY_RESOURCE_INCOMPLETE,
          `${item.id} is in the ${environment} environment, so it must be marked temporary with cleanup details`);
      }
      continue;
    }
    const missing = [];
    if (item.temporary_name !== true) missing.push('a temporary name');
    if (!text(item.data_rule)) missing.push('a data rule');
    if (!text(item.cleanup_owner)) missing.push('a cleanup owner');
    const end = parseDate(item.end_date);
    if (end === null) missing.push('an end date');
    else if (end < now) missing.push('an end date that has not passed');
    if (item.removal_read_back !== 'provider') missing.push('a provider read-back on removal');
    if (missing.length) {
      hold(reasons, REASONS.TEMPORARY_RESOURCE_INCOMPLETE, `temporary ${item.id} needs ${missing.join(', ')}`);
    }
  }
}

function checkAuthority(plan, reasons) {
  const scope = envName(plan.operation.environment);
  for (const request of requestedActions(plan)) {
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
  if (downstream.deployment_approved) {
    if (downstream.evidence_freeze && !downstream.freeze_end_approved) {
      hold(reasons, REASONS.EVIDENCE_FREEZE_ACTIVE,
        'an evidence freeze is active and the approval does not say this deployment ends it');
      return;
    }
    result.outcome = 'MERGE_WITH_COUPLED_DEPLOYMENT_ACCEPTED';
    result.required_read_back.push('after the action: read back the running revision and health from the provider');
    if (downstream.evidence_freeze) result.required_read_back.push('record that this deployment ended the evidence freeze');
    return;
  }
  if (downstream.pause_read_back) {
    result.outcome = 'PAUSE_TRIGGER_THEN_MERGE';
    result.required_read_back.push('after the action: prove from the provider that no deployment ran');
    result.required_read_back.push('then restore the trigger, or keep the pause as its own recorded change, with before and after read-back');
    return;
  }
  hold(reasons, REASONS.DEFER_MERGE,
    `the ${trigger} trigger would deploy, and neither the deployment nor a read-back trigger pause is approved; hold the action`);
}

// Production changes need a way back and proof the data can be got back.
function checkRecovery(plan, reasons, result) {
  const op = plan.operation;
  const coupledDeploy = AUTO_TRIGGERS.includes(plan.downstream.trigger) && plan.downstream.deployment_approved;
  // Any production target or resource in the plan counts, including one reached through an owner exception.
  const touchesProduction = isProduction(op.environment) ||
    plan.targets.some((target) => isProduction(target.environment) || isProduction(target.provider_environment)) ||
    plan.resources.some((resource) => isProduction(resource.provider_environment) || isProduction(resource.name_environment));
  if (!touchesProduction) return;
  const rollback = op.rollback;
  if (!rollback || !text(rollback.plan) || envName(rollback.environment) !== envName(op.environment)) {
    hold(reasons, REASONS.ROLLBACK_EVIDENCE_MISSING,
      'a change that touches production needs operation.rollback with a plan and an environment equal to the operation\'s');
  }
  const actions = requestedActions(plan).map((request) => envName(request.action));
  const needsBackup = coupledDeploy || actions.some((action) => !NO_DATA_ACTIONS.includes(action));
  if (!needsBackup) return;
  const evidence = op.backup_evidence;
  const level = evidence ? BACKUP_LEVELS.indexOf(text(evidence.level)) : -1;
  if (level < BACKUP_LEVELS.indexOf(MIN_BACKUP_LEVEL) || !text(evidence.reference)) {
    hold(reasons, REASONS.BACKUP_EVIDENCE_MISSING,
      `a production change that can touch data needs operation.backup_evidence with a level of at least ${MIN_BACKUP_LEVEL} and a reference to the evidence`);
    return;
  }
  result.required_read_back.push('after the action: confirm the backup referenced in backup_evidence is still retrievable if the change must be undone');
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
  const same = ['target', 'privilege', 'credential', 'effect'].every((key) => text(chosen[key]) && text(chosen[key]) === text(first[key]));
  if (chosen.pre_approved !== true || !same) {
    hold(reasons, REASONS.ROUTE_FALLBACK_REFUSED,
      `fallback route ${chosen.route} must be pre-approved and keep the same target, privilege, credential and effect as ${first.route}`);
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
    checked_at: new Date(now).toISOString(),
    reasons: [],
    notices: [],
    outcome: null,
    required_read_back: [],
    plan_sha256: isObject(plan) ? planHash(plan) : null
  };
  // Secrets first, so no later message can echo one.
  const secrets = findSecrets(plan, '', []);
  if (secrets.length) {
    for (const where of secrets) {
      hold(result.reasons, REASONS.SECRET_IN_PLAN, `${where} looks like a secret value; plans carry key names and references only`);
    }
    return result;
  }
  const problems = validateShape(plan);
  if (problems.length) {
    for (const problem of problems) hold(result.reasons, REASONS.PLAN_INVALID, problem);
    return result;
  }
  checkIdentity(plan, result.reasons, result.notices, now);
  checkTemporary(plan, result.reasons, now);
  checkAuthority(plan, result.reasons);
  checkDownstream(plan, result.reasons, result);
  checkRecovery(plan, result.reasons, result);
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
    else if (arg === '--now') {
      if (index + 1 >= argv.length) throw new Error('--now needs a date such as 2026-10-25');
      args.now = argv[++index];
    } else if (arg.startsWith('--now=')) args.now = arg.slice('--now='.length);
    else if (!arg.startsWith('-') && !args.file) args.file = arg;
    else throw new Error('unknown argument');
  }
  if (args.stdin === Boolean(args.file)) throw new Error('usage: preflight-check.cjs <plan.json> | --stdin [--now <YYYY-MM-DD>]');
  if (args.now !== undefined) {
    const now = parseDate(args.now);
    if (now === null) throw new Error('--now needs a real date such as 2026-10-25');
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
  let raw;
  try {
    raw = fs.readFileSync(args.stdin ? 0 : args.file, 'utf8').replace(/^﻿/, '');
  } catch (error) {
    process.stderr.write(`could not read the plan file (${error.code || 'read error'})\n`);
    return 1;
  }
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch {
    // Never echo the input: a pasted secret would end up in the log.
    process.stderr.write('the plan is not valid JSON\n');
    return 1;
  }
  const result = checkPlan(plan, { now: args.now });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.verdict === 'HOLD' ? 2 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { BACKUP_LEVELS, PLAN_SCHEMA, REASONS, TRIGGERS, checkPlan, planHash };
