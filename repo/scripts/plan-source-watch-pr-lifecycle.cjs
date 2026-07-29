#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const ACTIONS = new Set([
  'none',
  'update-open',
  'reopen-and-update',
  'create',
  'fail-ambiguous-open'
]);

function requireExactString(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a non-empty exact string without surrounding whitespace`);
  }
  return value;
}

function requirePullRequestNumber(value, name = 'pull request number') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function targetFromInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('planner input must be an object');
  }
  return {
    repository: requireExactString(input.repository, 'repository'),
    owner: requireExactString(input.owner, 'owner'),
    head: requireExactString(input.head, 'head'),
    base: requireExactString(input.base, 'base')
  };
}

function isExactLifecycleMatch(pr, target) {
  return Boolean(
    pr &&
    typeof pr === 'object' &&
    pr.repository === target.repository &&
    pr.headRefName === target.head &&
    pr.baseRefName === target.base &&
    pr.headRepositoryOwner &&
    pr.headRepositoryOwner.login === target.owner &&
    pr.headRepository &&
    pr.headRepository.nameWithOwner === target.repository &&
    pr.isCrossRepository === false
  );
}

function exactPullRequests(input) {
  const target = targetFromInput(input);
  if (!Array.isArray(input.pullRequests)) {
    throw new Error('pullRequests must be an array');
  }
  if (input.pullRequests.length > 1000) {
    throw new Error('pullRequests exceeds the bounded limit of 1000');
  }
  return {
    target,
    pullRequests: input.pullRequests.filter((pr) => isExactLifecycleMatch(pr, target))
  };
}

function sortedNumbers(pullRequests) {
  return pullRequests
    .map((pr) => requirePullRequestNumber(pr.number))
    .sort((left, right) => left - right);
}

function closedSelectionOrder(left, right) {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  return requirePullRequestNumber(right.number) - requirePullRequestNumber(left.number);
}

function validateClosedPullRequest(pr) {
  requirePullRequestNumber(pr.number);
  if (!Number.isFinite(Date.parse(pr.updatedAt))) {
    throw new Error('matching closed pull requests require valid updatedAt timestamps');
  }
  return pr;
}

function assertPlan(plan) {
  if (!plan || typeof plan !== 'object' || !ACTIONS.has(plan.action)) {
    throw new Error('planner returned an invalid action');
  }
  const hasNumber = plan.prNumber !== null;
  if (hasNumber) requirePullRequestNumber(plan.prNumber, 'planned pull request number');
  if (!Array.isArray(plan.conflictingPrNumbers)) {
    throw new Error('planner conflicts must be an array');
  }
  for (const number of plan.conflictingPrNumbers) {
    requirePullRequestNumber(number, 'conflicting pull request number');
  }
  const expectsNumber = plan.action === 'update-open' || plan.action === 'reopen-and-update';
  if (hasNumber !== expectsNumber) {
    throw new Error(`${plan.action} has an invalid pull request number`);
  }
  if ((plan.action === 'fail-ambiguous-open') !== (plan.conflictingPrNumbers.length > 0)) {
    throw new Error(`${plan.action} has an invalid conflict list`);
  }
  return plan;
}

function planLifecycle(input) {
  targetFromInput(input);
  if (typeof input.actionable !== 'boolean') {
    throw new Error('actionable must be a boolean');
  }
  if (!input.actionable) {
    return assertPlan({ action: 'none', prNumber: null, conflictingPrNumbers: [] });
  }

  const { pullRequests } = exactPullRequests(input);
  const open = pullRequests.filter((pr) => pr.state === 'OPEN');
  if (open.length > 1) {
    return assertPlan({
      action: 'fail-ambiguous-open',
      prNumber: null,
      conflictingPrNumbers: sortedNumbers(open)
    });
  }
  if (open.length === 1) {
    return assertPlan({
      action: 'update-open',
      prNumber: requirePullRequestNumber(open[0].number),
      conflictingPrNumbers: []
    });
  }

  const closed = pullRequests
    .filter((pr) => pr.state === 'CLOSED')
    .map(validateClosedPullRequest)
    .sort(closedSelectionOrder);
  if (closed.length > 0) {
    return assertPlan({
      action: 'reopen-and-update',
      prNumber: requirePullRequestNumber(closed[0].number),
      conflictingPrNumbers: []
    });
  }

  return assertPlan({ action: 'create', prNumber: null, conflictingPrNumbers: [] });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`);
    if (Object.prototype.hasOwnProperty.call(args, name)) throw new Error(`duplicate argument: --${name}`);
    args[name] = value;
    index += 1;
  }
  return args;
}

function readPullRequests(inputPath, repository) {
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('GitHub pull request metadata must be an array');
  return parsed.map((pr) => ({ ...pr, repository }));
}

function appendGitHubOutput(outputPath, entries) {
  const lines = Object.entries(entries).map(([name, value]) => {
    const rendered = String(value);
    if (/[\r\n]/.test(rendered)) throw new Error(`GitHub output ${name} contains a newline`);
    return `${name}=${rendered}`;
  });
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function cliInput(args) {
  const repository = requireExactString(args.repository, 'repository');
  return {
    actionable: args.actionable === 'true',
    repository,
    owner: requireExactString(args.owner, 'owner'),
    head: requireExactString(args.head, 'head'),
    base: requireExactString(args.base, 'base'),
    pullRequests: readPullRequests(requireExactString(args.input, 'input'), repository)
  };
}

function runCli(argv) {
  const args = parseArgs(argv);
  const mode = args.mode || 'plan';
  const input = cliInput(args);
  if (mode === 'plan') {
    if (args.actionable !== 'true' && args.actionable !== 'false') {
      throw new Error('--actionable must be true or false');
    }
    const plan = planLifecycle(input);
    if (args['github-output']) {
      appendGitHubOutput(requireExactString(args['github-output'], 'github-output'), {
        action: plan.action,
        pr_number: plan.prNumber === null ? '' : plan.prNumber,
        conflicting_pr_numbers: plan.conflictingPrNumbers.join(',')
      });
    }
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return plan;
  }

  if (mode === 'verify-open') {
    input.actionable = true;
    const plan = planLifecycle(input);
    if (plan.action !== 'update-open') {
      throw new Error(`expected exactly one matching open pull request, planned ${plan.action}`);
    }
    if (args['expected-number'] !== undefined) {
      const expected = Number(args['expected-number']);
      requirePullRequestNumber(expected, 'expected pull request number');
      if (plan.prNumber !== expected) {
        throw new Error(`expected open pull request #${expected}, found #${plan.prNumber}`);
      }
    }
    process.stdout.write(`${plan.prNumber}\n`);
    return plan.prNumber;
  }

  throw new Error(`unsupported mode: ${mode}`);
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Source-watch PR lifecycle planner failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIONS,
  assertPlan,
  exactPullRequests,
  isExactLifecycleMatch,
  planLifecycle,
  runCli
};
