'use strict';

function isNegatedContext(body, matchIndex, matchLength) {
  if (!body) return false;
  const before = body.substring(Math.max(0, matchIndex - 150), matchIndex).toLowerCase();
  const after = body.substring(matchIndex + (matchLength || 0), matchIndex + (matchLength || 0) + 80).toLowerCase();
  const negations = ['not','never','must not','does not','do not',"isn't","doesn't","don't",'shall not'];
  for (const neg of negations) {
    const idx = before.lastIndexOf(neg);
    if (idx >= 0) {
      const between = before.substring(idx + neg.length).trim();
      if (between.length < 30) return true;
    }
    const afterIdx = after.indexOf(neg);
    if (afterIdx >= 0 && afterIdx < 30) return true;
  }
  return false;
}

module.exports = { isNegatedContext };
