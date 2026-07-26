#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')); }
function fail(msg) { console.error('FAIL:', msg); process.exitCode = 1; }

function parseYaml(text) {
  var lines = text.split('\n');
  var result = {};
  var currentKey = null;
  var currentIndent = -1;
  var inRun = false;
  var runContent = [];
  var runIndent = -1;

  function getIndent(line) {
    var m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  function setValue(obj, key, value) {
    if (obj[key] !== undefined) {
      if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
      obj[key].push(value);
    } else {
      obj[key] = value;
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    var indent = getIndent(line);

    if (inRun) {
      if (indent > runIndent && (line.trim().startsWith('|') || line.trim().startsWith('>'))) continue;
      if (indent > runIndent || (indent === runIndent && line.trim() !== '')) {
        runContent.push(line.replace(new RegExp('^\\s{' + runIndent + '}'), ''));
        continue;
      }
      inRun = false;
      setValue(result, currentKey, runContent.join('\n'));
      runContent = [];
      i--;
      continue;
    }

    var parts = line.trim().split(/:\s+/);
    if (parts.length >= 2) {
      var key = parts[0].trim();
      var value = parts.slice(1).join(': ').trim();
      if (value === '|' || value === '>') {
        currentKey = key;
        inRun = true;
        runIndent = indent;
        runContent = [];
      } else {
        setValue(result, key, value);
      }
    } else if (line.trim().endsWith(':')) {
      currentKey = line.trim().slice(0, -1);
    } else if (line.trim().startsWith('- ')) {
      setValue(result, currentKey, line.trim().substring(2));
    }
  }
  if (inRun && runContent.length > 0) {
    setValue(result, currentKey, runContent.join('\n'));
  }
  return result;
}

function parseWorkflowSteps(yamlText) {
  var steps = [];
  var lines = yamlText.split('\n');
  var inSteps = false;
  var currentRun = [];
  var currentUses = null;
  var collectingRun = false;
  var runIndent = -1;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    var indent = line.length - line.trimStart().length;

    if (collectingRun) {
      if (indent > runIndent && (trimmed.startsWith('|') || trimmed.startsWith('>'))) continue;
      if (indent > runIndent || (indent === runIndent && trimmed !== '' && !trimmed.match(/^-\s+name:/) && !trimmed.match(/^-\s+uses:/) && !trimmed.match(/^-\s+run:/) && !trimmed.match(/^-\s+if:/) && !trimmed.match(/^-\s+with:/) && !trimmed.match(/^-\s+env:/))) {
        currentRun.push(trimmed);
        continue;
      }
      if (currentRun.length > 0) {
        steps[steps.length - 1].run = currentRun.join('\n');
      }
      collectingRun = false;
      currentRun = [];
      i--;
      continue;
    }

    if (trimmed.match(/^-\s+name:/)) inSteps = true;
    if (trimmed.match(/^-\s+uses:/)) {
      if (currentRun.length > 0 && steps.length > 0) {
        steps[steps.length - 1].run = currentRun.join('\n');
      }
      currentRun = [];
      collectingRun = false;
      steps.push({ uses: trimmed.replace(/^-\s+uses:\s*/, '').trim() });
    }
    if (trimmed.match(/^-\s+run:/)) {
      if (currentRun.length > 0 && steps.length > 0) {
        steps[steps.length - 1].run = currentRun.join('\n');
      }
      currentRun = [];
      var runVal = trimmed.replace(/^-\s+run:\s*/, '').trim();
      if (runVal === '|' || runVal === '>') {
        collectingRun = true;
        runIndent = indent;
        currentRun.push(runVal);
      } else {
        steps.push({ run: runVal });
      }
    }
  }
  if (collectingRun && currentRun.length > 0 && steps.length > 0) {
    steps[steps.length - 1].run = currentRun.join('\n');
  }
  return steps;
}

function isNodeExecution(step) {
  if (!step.run) return false;
  var run = step.run;
  if (typeof run === 'string') run = [run];
  if (Array.isArray(run)) run = run.join('\n');

  var patterns = [
    /\bnode\s+/,
    /npm\s+run\b/,
    /npm\s+exec\b/,
    /\bnpx\b/,
    /\.js\b/,
    /\.cjs\b/,
    /\.mjs\b/
  ];
  for (var p of patterns) {
    if (p.test(run)) return true;
  }
  return false;
}

function hasCheckoutBefore(steps, stepIndex) {
  for (var i = 0; i < stepIndex; i++) {
    if (steps[i].uses && steps[i].uses.match(/actions\/checkout/)) return true;
  }
  return false;
}

function hasSetupNodeBefore(steps, stepIndex) {
  for (var i = 0; i < stepIndex; i++) {
    if (steps[i].uses && steps[i].uses.match(/actions\/setup-node/)) return true;
  }
  return false;
}

function hasNpmCiBefore(steps, stepIndex) {
  var foundCheckout = -1;
  var foundSetupNode = -1;
  for (var i = 0; i < stepIndex; i++) {
    if (steps[i].uses && steps[i].uses.match(/actions\/checkout/)) foundCheckout = i;
    if (steps[i].uses && steps[i].uses.match(/actions\/setup-node/)) foundSetupNode = i;
  }
  if (foundCheckout < 0 || foundSetupNode < 0) return false;

  var lastCheckout = -1;
  for (var j = 0; j < stepIndex; j++) {
    if (steps[j].uses && steps[j].uses.match(/actions\/checkout/)) lastCheckout = j;
  }

  for (var k = Math.max(foundCheckout, foundSetupNode) + 1; k < stepIndex; k++) {
    if (steps[k].run && /npm\s+ci\b/.test(steps[k].run)) {
      for (var c = k + 1; c < stepIndex; c++) {
        if (steps[c].uses && steps[c].uses.match(/actions\/checkout/)) return false;
      }
      return true;
    }
  }
  return false;
}

var workflowFiles = fs.readdirSync(WORKFLOWS_DIR).filter(function(f) {
  return f.endsWith('.yml') || f.endsWith('.yaml');
});

var hasErrors = false;

for (var wf of workflowFiles) {
  var wfPath = path.join(WORKFLOWS_DIR, wf);
  var content = fs.readFileSync(wfPath, 'utf8');
  var steps = parseWorkflowSteps(content);

  for (var si = 0; si < steps.length; si++) {
    var step = steps[si];
    if (isNodeExecution(step)) {
      if (!hasCheckoutBefore(steps, si)) {
        fail(wf + ': Node execution step ' + si + ' has no prior checkout');
        hasErrors = true;
        continue;
      }
      if (!hasSetupNodeBefore(steps, si)) {
        fail(wf + ': Node execution step ' + si + ' has no prior setup-node');
        hasErrors = true;
        continue;
      }
      if (!hasNpmCiBefore(steps, si)) {
        fail(wf + ': Node execution step ' + si + ' has no npm ci after checkout/setup-node and before execution');
        hasErrors = true;
      }
    }
  }
}

if (hasErrors) {
  console.error('Workflow inventory check failed. Every job executing Node code must run npm ci --ignore-scripts after checkout and setup-node before execution.');
  process.exit(1);
}

console.log('Workflow inventory check passed: ' + workflowFiles.length + ' workflow(s), all Node execution paths have npm ci.');
process.exit(0);
