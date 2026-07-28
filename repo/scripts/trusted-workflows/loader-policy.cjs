#!/usr/bin/env node
'use strict';

const VALID_SIGNALS = new Set([
  'TERM', 'KILL', 'INT', 'HUP', 'QUIT', 'USR1', 'USR2',
  'ALRM', 'PIPE', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'WINCH'
]);

const REQUIRE_MEMBER_SAFE = new Set(['main', 'resolve']);

function isRequireMainMember(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (node.computed || node.optional) return false;
  if (!node.object || node.object.type !== 'Identifier' || node.object.name !== 'require') return false;
  if (!node.property || node.property.type !== 'Identifier' || node.property.name !== 'main') return false;
  return true;
}

function isRequireResolveMember(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (node.computed || node.optional) return false;
  if (!node.object || node.object.type !== 'Identifier' || node.object.name !== 'require') return false;
  if (!node.property || node.property.type !== 'Identifier' || node.property.name !== 'resolve') return false;
  return true;
}

function isDirectRequireCallee(call) {
  if (!call || call.type !== 'CallExpression') return false;
  if (call.optional) return false;
  if (!call.callee || call.callee.type !== 'Identifier' || call.callee.name !== 'require') return false;
  return true;
}

function isValidStaticRequireCall(call) {
  if (!isDirectRequireCallee(call)) return false;
  if (call.arguments.length !== 1) return false;
  const arg = call.arguments[0];
  if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return false;
  return true;
}

function isRequireMainCompare(node, parent) {
  if (!isRequireMainMember(node)) return false;
  if (!parent || parent.type !== 'BinaryExpression') return false;
  if (parent.operator !== '===' && parent.operator !== '!==') return false;
  const other = parent.left === node ? parent.right : parent.left;
  return !!(other && other.type === 'Identifier' && other.name === 'module');
}

function isRequireResolveCall(node, parent) {
  if (!isRequireResolveMember(node)) return false;
  if (!parent || parent.type !== 'CallExpression' || parent.callee !== node) return false;
  if (parent.optional) return false;
  if (parent.arguments.length !== 1) return false;
  const arg = parent.arguments[0];
  return !!(arg && arg.type === 'Literal' && typeof arg.value === 'string');
}

function isSafeRequireMemberProperty(name) {
  return REQUIRE_MEMBER_SAFE.has(name);
}

function normaliseSignal(raw) {
  const upper = String(raw).toUpperCase();
  return upper.startsWith('SIG') ? upper.slice(3) : upper;
}

function isValidSignal(raw) {
  return VALID_SIGNALS.has(normaliseSignal(raw));
}

module.exports = {
  isDirectRequireCallee,
  isValidStaticRequireCall,
  isRequireMainMember,
  isRequireResolveMember,
  isRequireMainCompare,
  isRequireResolveCall,
  isSafeRequireMemberProperty,
  normaliseSignal,
  isValidSignal,
  VALID_SIGNALS
};
