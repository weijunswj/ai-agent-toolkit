'use strict';

function getIssueById(issues, id) {
  return issues.find(i => String(i.id) === String(id)) || null;
}

function isChildCategory(cat) {
  return ['active_multi_step_child', 'small_atomic_child'].includes(cat);
}

function getCanonicalParents(issues) {
  return issues.filter(i => i.category === 'canonical_parent_tracker');
}

function getChildren(issues) {
  return issues.filter(i => isChildCategory(i.category));
}

function normalizeId(id) {
  return String(id);
}

module.exports = {
  getIssueById, isChildCategory, getCanonicalParents, getChildren, normalizeId
};
