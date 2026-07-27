#!/usr/bin/env node
'use strict';

const VALID_SIGNALS = new Set([
  'TERM', 'KILL', 'INT', 'HUP', 'QUIT', 'USR1', 'USR2',
  'ALRM', 'PIPE', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'WINCH'
]);

function isRequireChainRoot(callee, stopProperty) {
  if (!callee || callee.type !== 'MemberExpression') return false;
  if (callee.computed) return true;
  if (callee.object && callee.object.type === 'Identifier' && callee.object.name === 'require') {
    return !(callee.property && callee.property.type === 'Identifier' && callee.property.name === stopProperty);
  }
  if (callee.object && callee.object.type === 'MemberExpression') {
    return isRequireChainRoot(callee.object, stopProperty);
  }
  return false;
}

function isRequireMainCompare(node, parent) {
  if (!parent || parent.type !== 'BinaryExpression') return false;
  if (parent.operator !== '===' && parent.operator !== '!==') return false;
  const other = parent.left === node ? parent.right : parent.left;
  return other && other.type === 'Identifier' && other.name === 'module';
}

function isRequireResolveCall(node, parent) {
  if (!parent || parent.type !== 'CallExpression' || parent.callee !== node) return false;
  if (parent.arguments.length !== 1) return false;
  const arg = parent.arguments[0];
  return arg && arg.type === 'Literal' && typeof arg.value === 'string';
}

function normaliseSignal(raw) {
  const upper = String(raw).toUpperCase();
  return upper.startsWith('SIG') ? upper.slice(3) : upper;
}

function isValidSignal(raw) {
  return VALID_SIGNALS.has(normaliseSignal(raw));
}

module.exports = {
  isRequireChainRoot,
  isRequireMainCompare,
  isRequireResolveCall,
  normaliseSignal,
  isValidSignal,
  VALID_SIGNALS
};
