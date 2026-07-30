'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESOLUTION_STATUSES = Object.freeze([
  'resolved',
  'missing-context',
  'unresolved',
  'ambiguous',
  'stale',
  'outside',
  'resolver-error',
]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function detectPathSemantics(value, explicit = {}) {
  const text = String(value || '');
  const platform = explicit.platform || (/[A-Za-z]:[\\/]/.test(text) || text.includes('\\') ? 'win32' : process.platform);
  const win32 = platform === 'win32' || platform === 'windows';
  return {
    platform: win32 ? 'win32' : platform,
    case_sensitive: explicit.case_sensitive === undefined ? !win32 : Boolean(explicit.case_sensitive),
    separator: win32 ? '\\' : '/',
  };
}

function apiFor(semantics) {
  return semantics.platform === 'win32' ? path.win32 : path.posix;
}

function canonicalPath(value, semantics, basePath = undefined) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('PATH_REQUIRED');
  const api = apiFor(semantics);
  const normalized = semantics.platform === 'win32' ? value.replaceAll('/', '\\') : value;
  if (api.isAbsolute(normalized)) return api.normalize(normalized);
  if (typeof basePath !== 'string' || !basePath) throw new Error('RELATIVE_PATH_BASE_REQUIRED');
  return api.resolve(basePath, normalized);
}

function trimRoot(value, semantics) {
  const api = apiFor(semantics);
  const normalized = api.normalize(value);
  if (normalized === api.parse(normalized).root) return normalized;
  return normalized.replace(/[\\/]$/, '');
}

function comparePath(value, semantics) {
  return semantics.case_sensitive ? value : value.toLowerCase();
}

function isWithin(root, candidate, semantics) {
  if (!root || !candidate) return false;
  const api = apiFor(semantics);
  const rootValue = trimRoot(root, semantics);
  const candidateValue = api.normalize(candidate);
  const rootKey = comparePath(rootValue, semantics);
  const candidateKey = comparePath(candidateValue, semantics);
  if (rootKey === candidateKey) return true;
  if (rootKey === api.parse(rootValue).root) return candidateKey.startsWith(rootKey);
  return candidateKey.startsWith(`${rootKey}${semantics.separator}`);
}

function samePath(left, right, semantics) {
  return Boolean(left && right) && comparePath(trimRoot(left, semantics), semantics) === comparePath(trimRoot(right, semantics), semantics);
}

function pathParent(value, semantics) {
  return apiFor(semantics).dirname(value);
}

function isSiblingOfRepository(candidate, repoRoot, semantics) {
  if (!candidate || !repoRoot) return false;
  const parent = pathParent(trimRoot(repoRoot, semantics), semantics);
  if (!isWithin(parent, candidate, semantics) || isWithin(repoRoot, candidate, semantics)) return false;
  const relative = apiFor(semantics).relative(parent, candidate);
  const parts = relative.split(/[\\/]/).filter(Boolean);
  return parts.length === 1 || parts.length > 1;
}

function isParentWorkspace(candidate, repoRoot, semantics) {
  if (!candidate || !repoRoot) return false;
  const parent = pathParent(trimRoot(repoRoot, semantics), semantics);
  if (samePath(candidate, parent, semantics)) return true;
  if (!isWithin(parent, candidate, semantics) || isWithin(repoRoot, candidate, semantics)) return false;
  const relative = apiFor(semantics).relative(parent, candidate);
  const parts = relative.split(/[\\/]/).filter(Boolean);
  return parts.length === 1 && /\.[^\\/]+$/.test(parts[0]);
}

function normalizeLinkType(value) {
  const normalized = String(value || 'none').toLowerCase().replaceAll('_', '-');
  if (normalized === 'junction') return 'junction';
  if (normalized === 'reparse' || normalized === 'reparse-point') return 'reparse-point';
  if (normalized === 'symlink' || normalized === 'symbolic-link') return 'symlink';
  return 'none';
}

function defaultFsResolver() {
  return {
    realpath(value) {
      return fs.realpathSync.native(value);
    },
    lstat(value) {
      return fs.lstatSync(value);
    },
  };
}

function readLinkType(stats) {
  if (!stats) return 'none';
  if (stats.link_type) return normalizeLinkType(stats.link_type);
  if (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink()) return 'symlink';
  if (typeof stats.isJunction === 'function' && stats.isJunction()) return 'junction';
  if (stats.isJunction) return 'junction';
  if (typeof stats.isReparsePoint === 'function' && stats.isReparsePoint()) return 'reparse-point';
  if (stats.isReparsePoint) return 'reparse-point';
  return 'none';
}

function evidenceForPath(context, rawPath, target = {}) {
  const evidence = context?.resolution_evidence;
  const table = evidence && typeof evidence.targets === 'object' ? evidence.targets : {};
  return firstDefined(target.resolution_evidence, table[rawPath], table[rawPath?.replaceAll('\\', '/')], trustedEvidence(evidence) ? evidence : null);
}

function trustedEvidence(evidence) {
  return Boolean(evidence && (
    evidence.status === 'trusted' ||
    evidence.status === 'resolved' ||
    evidence.resolution_status === 'resolved' ||
    evidence.filesystem_verified === true
  ));
}

function resolveWithEvidence(rawPath, basePath, semantics, evidence, fsResolver, options = {}) {
  const lexicalPath = canonicalPath(rawPath, semantics, basePath);
  let linkType = normalizeLinkType(evidence?.link_type);
  let resolvedPath = firstDefined(evidence?.resolved_path, evidence?.canonical_path, null);

  if (!resolvedPath && options.use_filesystem === true && fsResolver?.realpath) {
    resolvedPath = fsResolver.realpath(lexicalPath);
  }

  if (resolvedPath) {
    resolvedPath = canonicalPath(String(resolvedPath), semantics, basePath);
  } else if (!trustedEvidence(evidence)) {
    return {
      raw_path: rawPath,
      lexical_path: lexicalPath,
      canonical_path: null,
      link_type: linkType,
      status: 'unresolved',
      evidence: evidence || null,
    };
  } else {
    resolvedPath = lexicalPath;
  }

  if (linkType === 'none' && options.use_filesystem === true && fsResolver?.lstat) {
    linkType = readLinkType(fsResolver.lstat(lexicalPath));
  }

  return {
    raw_path: rawPath,
    lexical_path: lexicalPath,
    canonical_path: resolvedPath,
    link_type: linkType,
    status: 'resolved',
    evidence: evidence || null,
  };
}

function rootEvidence(context, name) {
  const evidence = context?.resolution_evidence;
  if (!evidence || typeof evidence !== 'object') return null;
  return firstDefined(evidence[name], evidence.roots?.[name], trustedEvidence(evidence) ? evidence : null);
}

function resolveRepositoryContext(input, options = {}) {
  const context = input && typeof input === 'object' ? input : {};
  const cwd = firstDefined(context.host_working_directory, context.cwd, context.repository?.cwd, null);
  const proposedRepo = firstDefined(context.proposed_repository_root, context.repo_root, context.repository?.repo_root, null);
  const proposedWorktree = firstDefined(context.proposed_worktree_root, context.worktree_root, context.repository?.worktree_root, proposedRepo);
  const semantics = detectPathSemantics(firstDefined(proposedRepo, cwd, ''), context.path_semantics || options.path_semantics || {});
  const baseResult = {
    context_version: 'toolkit.guardrail.repository-context.v1',
    cwd: typeof cwd === 'string' ? cwd : null,
    repo_root: null,
    worktree_root: null,
    canonical_repository_root: null,
    canonical_worktree_root: null,
    authorised_directories: [],
    approved_additional_roots: [],
    canonical_target_paths: [],
    canonicalisation_evidence: context.canonicalisation_evidence || context.resolution_evidence || null,
    resolution_evidence: context.resolution_evidence || null,
    path_resolution_status: 'missing-context',
    path_semantics: semantics,
    git_evidence: null,
  };

  if (typeof proposedRepo !== 'string' || !proposedRepo.trim()) return baseResult;

  const fsResolver = options.fsResolver || null;
  const repo = resolveWithEvidence(proposedRepo, cwd || undefined, semantics, rootEvidence(context, 'repository_root'), fsResolver, options);
  const worktree = resolveWithEvidence(proposedWorktree || proposedRepo, cwd || undefined, semantics, rootEvidence(context, 'worktree_root'), fsResolver, options);
  baseResult.repo_root = repo.canonical_path;
  baseResult.worktree_root = worktree.canonical_path;
  baseResult.canonical_repository_root = repo.canonical_path;
  baseResult.canonical_worktree_root = worktree.canonical_path;

  if (options.gitResolver) {
    const resolver = options.gitResolver;
    const gitRoot = typeof resolver.showTopLevel === 'function'
      ? resolver.showTopLevel(cwd || proposedRepo)
      : (typeof resolver.resolve === 'function' ? resolver.resolve(cwd || proposedRepo) : null);
    const gitCommon = typeof resolver.showCommonDir === 'function' ? resolver.showCommonDir(cwd || proposedRepo) : null;
    baseResult.git_evidence = { repository_root: gitRoot || null, common_directory: gitCommon || null, source: 'injected-git-resolver' };
    if (gitRoot && repo.canonical_path && !samePath(canonicalPath(gitRoot, semantics, cwd || undefined), repo.canonical_path, semantics)) {
      baseResult.path_resolution_status = 'ambiguous';
      return baseResult;
    }
  } else if (context.git_evidence) {
    baseResult.git_evidence = context.git_evidence;
  }

  const additional = firstDefined(context.approved_additional_roots, context.authorised_additional_roots, []);
  for (const entry of Array.isArray(additional) ? additional : []) {
    const raw = typeof entry === 'string' ? entry : firstDefined(entry?.path, entry?.root, null);
    if (!raw) {
      baseResult.approved_additional_roots.push({ path: null, canonical_path: null, status: 'unresolved', kind: 'unknown' });
      continue;
    }
    const evidence = typeof entry === 'object' ? entry.resolution_evidence : null;
    const resolved = resolveWithEvidence(raw, cwd || proposedRepo, semantics, evidence, fsResolver, options);
    baseResult.approved_additional_roots.push({
      path: raw,
      canonical_path: resolved.canonical_path,
      status: resolved.status,
      link_type: resolved.link_type,
      kind: typeof entry === 'object' ? (entry.kind || 'approved-additional-root') : 'approved-additional-root',
    });
  }

  baseResult.authorised_directories = [
    baseResult.canonical_repository_root,
    baseResult.canonical_worktree_root,
    ...baseResult.approved_additional_roots.map((entry) => entry.canonical_path),
  ].filter(Boolean);

  const targetInputs = Array.isArray(context.canonical_target_paths) ? context.canonical_target_paths : [];
  baseResult.canonical_target_paths = targetInputs.map((entry) => resolveTarget(entry, baseResult, options));

  const rootsResolved = Boolean(repo.canonical_path && worktree.canonical_path && repo.status === 'resolved' && worktree.status === 'resolved');
  const additionsResolved = baseResult.approved_additional_roots.every((entry) => entry.status === 'resolved');
  const evidenceStatus = context.path_resolution_status || context.resolution_status || context.resolution_evidence?.status;
  baseResult.path_resolution_status = rootsResolved && additionsResolved && (
    evidenceStatus === 'resolved' || evidenceStatus === 'trusted' || trustedEvidence(context.resolution_evidence) || options.use_filesystem === true
  ) ? 'resolved' : (repo.status === 'unresolved' || worktree.status === 'unresolved' ? 'unresolved' : 'ambiguous');

  return baseResult;
}

function resolveTarget(targetInput, repositoryContext, options = {}) {
  const context = repositoryContext || {};
  const semantics = context.path_semantics || detectPathSemantics(context.repo_root || context.cwd || '', options.path_semantics || {});
  const target = typeof targetInput === 'string' ? { path: targetInput } : (targetInput && typeof targetInput === 'object' ? targetInput : {});
  const rawPath = firstDefined(target.path, target.target, target.value, null);
  const operationCwd = firstDefined(target.operation_cwd, options.operation_cwd, context.cwd, context.repo_root, null);
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return {
      raw_path: null,
      lexical_path: null,
      canonical_path: null,
      status: 'unresolved',
      target_class: 'unresolved-target',
      link_type: 'none',
      resolved_inside: false,
      evidence: null,
    };
  }

  const evidence = evidenceForPath(context, rawPath, target);
  const fsResolver = options.fsResolver || null;
  const resolved = resolveWithEvidence(rawPath, operationCwd || undefined, semantics, evidence, fsResolver, options);
  const result = {
    raw_path: rawPath,
    lexical_path: resolved.lexical_path,
    canonical_path: resolved.canonical_path,
    status: resolved.status,
    target_class: 'unknown-target',
    link_type: resolved.link_type,
    resolved_inside: false,
    approved_root: null,
    evidence: resolved.evidence,
  };

  if (resolved.status !== 'resolved' || !resolved.canonical_path) {
    result.target_class = resolved.link_type !== 'none' ? 'unresolved-target' : 'unresolved-target';
    return result;
  }

  const canonical = resolved.canonical_path;
  const explicitClass = firstDefined(target.target_class, target.safe_target_class, evidence?.target_class, null);
  if (explicitClass && ['sibling-repository', 'parent-workspace', 'outside-repository', 'approved-additional-root', 'canonical-repository', 'canonical-worktree'].includes(explicitClass)) {
    result.target_class = explicitClass;
    result.resolved_inside = ['approved-additional-root', 'canonical-repository', 'canonical-worktree'].includes(explicitClass);
  } else if (isWithin(context.canonical_repository_root, canonical, semantics)) {
    result.target_class = 'canonical-repository';
    result.resolved_inside = true;
  } else if (isWithin(context.canonical_worktree_root, canonical, semantics)) {
    result.target_class = 'canonical-worktree';
    result.resolved_inside = true;
  } else {
    const additional = (context.approved_additional_roots || []).find((entry) => (
      entry.status === 'resolved' && isWithin(entry.canonical_path, canonical, semantics)
    ));
    if (additional) {
      result.target_class = 'approved-additional-root';
      result.resolved_inside = true;
      result.approved_root = additional.canonical_path;
    } else if (resolved.link_type !== 'none') {
      result.target_class = 'outside-repository';
    } else if (isParentWorkspace(canonical, context.canonical_repository_root, semantics)) {
      result.target_class = 'parent-workspace';
    } else if (isSiblingOfRepository(canonical, context.canonical_repository_root, semantics)) {
      result.target_class = 'sibling-repository';
    } else {
      result.target_class = 'outside-repository';
    }
  }
  return result;
}

function resolveTargets(targets, repositoryContext, options = {}) {
  return (Array.isArray(targets) ? targets : []).map((target) => resolveTarget(target, repositoryContext, options));
}

function targetSetClass(targets) {
  const list = Array.isArray(targets) ? targets : [];
  if (!list.length) return 'unknown-target';
  if (list.some((target) => target.status !== 'resolved')) return 'unresolved-target';
  const classes = new Set(list.map((target) => target.target_class));
  if (classes.size === 1) return [...classes][0];
  if ([...classes].every((value) => value === 'canonical-repository' || value === 'canonical-worktree' || value === 'approved-additional-root')) {
    return 'canonical-worktree';
  }
  return 'mixed-targets';
}

function targetsInsideAuthorisedRoots(targets) {
  return Array.isArray(targets) && targets.length > 0 && targets.every((target) => target.status === 'resolved' && target.resolved_inside === true);
}

module.exports = {
  RESOLUTION_STATUSES,
  detectPathSemantics,
  canonicalPath,
  isWithin,
  samePath,
  isSiblingOfRepository,
  isParentWorkspace,
  resolveRepositoryContext,
  resolveTarget,
  resolveTargets,
  targetSetClass,
  targetsInsideAuthorisedRoots,
  defaultFsResolver,
};
