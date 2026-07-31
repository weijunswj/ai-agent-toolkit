'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./toolkit-guardrail-policy.cjs');

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
    case_sensitive: explicit.case_sensitive === undefined
      ? !win32
      : (typeof explicit.case_sensitive === 'boolean' ? explicit.case_sensitive : !win32),
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
  if (value === undefined || value === null) return 'none';
  if (typeof value !== 'string') return value;
  const normalized = value.toLowerCase().replaceAll('_', '-');
  if (normalized === 'junction') return 'junction';
  if (normalized === 'reparse' || normalized === 'reparse-point') return 'reparse-point';
  if (normalized === 'symlink' || normalized === 'symbolic-link') return 'symlink';
  return 'none';
}

function nullableString(value) {
  return value === undefined || value === null ? null : (typeof value === 'string' ? value : value);
}

function nullableDigest(value) {
  return value === undefined || value === null ? null : (typeof value === 'string' ? value : value);
}

function normalizeEvidenceMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).reduce((result, key) => {
    result[key] = normalizeResolutionEvidence(value[key]);
    return result;
  }, {});
}

function normalizeResolutionEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    status: nullableString(value.status),
    resolution_status: nullableString(value.resolution_status),
    source: nullableString(value.source),
    provenance: nullableString(value.provenance),
    filesystem_verified: value.filesystem_verified === undefined || value.filesystem_verified === null
      ? null
      : (typeof value.filesystem_verified === 'boolean' ? value.filesystem_verified : value.filesystem_verified),
    link_type: normalizeLinkType(value.link_type),
    resolved_path: nullableString(value.resolved_path),
    canonical_path: nullableString(value.canonical_path),
    target_class: nullableString(value.target_class),
    repository_root: nullableString(value.repository_root),
    worktree_root: nullableString(value.worktree_root),
    invocation_id: nullableDigest(firstDefined(value.invocation_id, value.resolver_invocation_id)),
    target_digest: nullableDigest(firstDefined(value.target_digest, value.input_target_digest)),
    repository_root_digest: nullableDigest(value.repository_root_digest),
    worktree_root_digest: nullableDigest(value.worktree_root_digest),
    roots: normalizeEvidenceMap(value.roots),
    targets: normalizeEvidenceMap(value.targets),
  };
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
  const evidence = normalizeResolutionEvidence(context?.resolution_evidence);
  const table = evidence?.targets && typeof evidence.targets === 'object' && !Array.isArray(evidence.targets) ? evidence.targets : {};
  return firstDefined(
    normalizeResolutionEvidence(target.resolution_evidence),
    normalizeResolutionEvidence(table[rawPath]),
    normalizeResolutionEvidence(table[rawPath?.replaceAll('\\', '/')]),
    trustedEvidence(evidence) ? evidence : null,
  );
}

function trustedEvidence(evidence) {
  const source = firstDefined(evidence?.source, evidence?.provenance, null);
  if (!evidence || typeof evidence !== 'object' || typeof source !== 'string' || !source.trim()) return false;
  if (/(?:caller|model|executor|transcript|untrusted|input)/i.test(source)) return false;
  return Boolean(
    (
    evidence.status === 'trusted' ||
    evidence.status === 'resolved' ||
    evidence.resolution_status === 'resolved' ||
    evidence.filesystem_verified === true
    )
  );
}

function normalizeGitEvidence(value, semantics, basePath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const canonicalize = (candidate) => {
    if (candidate === undefined || candidate === null || candidate === '') return null;
    try {
      return canonicalPath(String(candidate), semantics, basePath);
    } catch (error) {
      return null;
    }
  };
  const source = nullableString(value.source);
  const provenance = nullableString(value.provenance);
  const status = nullableString(value.status || value.resolution_status);
  const provenanceTrusted = Boolean(
    (source || provenance)
    && !/(?:caller|model|executor|transcript|untrusted|input)/i.test(String(source || provenance))
    && ['trusted', 'resolved', 'verified'].includes(String(status || '').toLowerCase()),
  );
  const trusted = provenanceTrusted && (value.trusted === true || ['trusted', 'resolved', 'verified'].includes(String(status || '').toLowerCase()));
  return {
    repository_root: canonicalize(value.repository_root || value.repo_root),
    common_directory: canonicalize(value.common_directory || value.git_common_dir),
    source,
    provenance,
    status: status || 'unresolved',
    trusted,
  };
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
  } else if (linkType !== 'none') {
    return {
      raw_path: rawPath,
      lexical_path: lexicalPath,
      canonical_path: null,
      link_type: linkType,
      status: 'unresolved',
      evidence: evidence || null,
    };
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

function unauthorisedAdditionalRootAuthority(kind) {
  return {
    authorization_status: 'unauthorized',
    authority_provenance: null,
    authority_binding: {
      canonical_path: null,
      canonical_path_digest: null,
      kind: typeof kind === 'string' && kind.trim() ? kind : null,
      trusted: false,
    },
  };
}

function safeAuthorityProvenance(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    && !/(?:secret|token|credential|password|private|untrusted|caller|input|executor)/i.test(value)
    ? value
    : null;
}

function verifyAdditionalRootAuthority(canonicalRoot, intendedKind, semantics, options = {}, stringOnly = false) {
  const denied = unauthorisedAdditionalRootAuthority(intendedKind);
  if (stringOnly || typeof options.additionalRootAuthorityVerifier !== 'function' || !canonicalRoot || !intendedKind) return denied;
  let evidence;
  try {
    evidence = options.additionalRootAuthorityVerifier(canonicalRoot, intendedKind);
  } catch (error) {
    return denied;
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return denied;
  const allowedKeys = new Set(['status', 'authorized', 'trusted', 'provenance', 'canonical_path', 'canonical_path_digest', 'kind']);
  if (Object.keys(evidence).some((key) => !allowedKeys.has(key))) return denied;
  if (
    evidence.status !== 'verified'
    || evidence.authorized !== true
    || evidence.trusted !== true
    || evidence.kind !== intendedKind
  ) return denied;
  const provenance = safeAuthorityProvenance(evidence.provenance);
  if (!provenance) return denied;
  const canonicalPathMatches = typeof evidence.canonical_path === 'string'
    && samePath(evidence.canonical_path, canonicalRoot, semantics);
  const digestMatches = typeof evidence.canonical_path_digest === 'string'
    && evidence.canonical_path_digest === sha256(canonicalRoot);
  if (!Object.hasOwn(evidence, 'canonical_path') && !Object.hasOwn(evidence, 'canonical_path_digest')) return denied;
  if (Object.hasOwn(evidence, 'canonical_path') && !canonicalPathMatches) return denied;
  if (Object.hasOwn(evidence, 'canonical_path_digest') && !digestMatches) return denied;
  if (!canonicalPathMatches && !digestMatches) return denied;
  return {
    authorization_status: 'authorized',
    authority_provenance: provenance,
    authority_binding: {
      canonical_path: canonicalPathMatches ? canonicalRoot : null,
      canonical_path_digest: digestMatches ? sha256(canonicalRoot) : null,
      kind: intendedKind,
      trusted: true,
    },
  };
}

function rootEvidence(context, name) {
  const evidence = normalizeResolutionEvidence(context?.resolution_evidence);
  if (!evidence || typeof evidence !== 'object') return null;
  return firstDefined(
    normalizeResolutionEvidence(evidence[name]),
    normalizeResolutionEvidence(evidence.roots?.[name]),
    trustedEvidence(evidence) ? evidence : null,
  );
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
    canonicalisation_evidence: normalizeResolutionEvidence(firstDefined(context.canonicalisation_evidence, context.resolution_evidence, null)),
    resolution_evidence: normalizeResolutionEvidence(context.resolution_evidence),
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
    baseResult.git_evidence = normalizeGitEvidence({
      repository_root: gitRoot,
      common_directory: gitCommon,
      source: 'injected-git-resolver',
      provenance: 'injected-git-resolver',
      status: gitRoot ? 'trusted' : 'unresolved',
      trusted: Boolean(gitRoot),
    }, semantics, cwd || proposedRepo);
    if (!baseResult.git_evidence?.trusted) {
      baseResult.path_resolution_status = 'ambiguous';
      return baseResult;
    }
    if (gitRoot && repo.canonical_path && !samePath(baseResult.git_evidence.repository_root, repo.canonical_path, semantics)) {
      baseResult.path_resolution_status = 'ambiguous';
      return baseResult;
    }
  } else if (context.git_evidence) {
    baseResult.git_evidence = normalizeGitEvidence(context.git_evidence, semantics, cwd || proposedRepo);
    if (!baseResult.git_evidence?.trusted) {
      baseResult.path_resolution_status = 'ambiguous';
      return baseResult;
    }
    if (baseResult.git_evidence.repository_root && repo.canonical_path && !samePath(baseResult.git_evidence.repository_root, repo.canonical_path, semantics)) {
      baseResult.path_resolution_status = 'ambiguous';
      return baseResult;
    }
  }

  const additional = firstDefined(context.approved_additional_roots, context.authorised_additional_roots, []);
  for (const entry of Array.isArray(additional) ? additional : []) {
    const raw = typeof entry === 'string' ? entry : firstDefined(entry?.path, entry?.root, null);
    const stringOnly = typeof entry === 'string';
    const intendedKind = typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'kind')
      ? (typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind : null)
      : 'approved-additional-root';
    if (!raw) {
      baseResult.approved_additional_roots.push({
        path: null,
        canonical_path: null,
        status: 'unresolved',
        link_type: 'none',
        kind: intendedKind || 'unknown',
        ...unauthorisedAdditionalRootAuthority(intendedKind),
      });
      continue;
    }
    const evidence = typeof entry === 'object'
      ? firstDefined(entry.resolution_evidence, context.resolution_evidence, null)
      : context.resolution_evidence;
    const resolved = resolveWithEvidence(raw, cwd || proposedRepo, semantics, evidence, fsResolver, options);
    const authority = resolved.status === 'resolved'
      ? verifyAdditionalRootAuthority(resolved.canonical_path, intendedKind, semantics, options, stringOnly)
      : unauthorisedAdditionalRootAuthority(intendedKind);
    baseResult.approved_additional_roots.push({
      path: raw,
      canonical_path: resolved.canonical_path,
      status: resolved.status,
      link_type: resolved.link_type,
      kind: intendedKind || 'unknown',
      ...authority,
    });
  }

  baseResult.authorised_directories = [
    baseResult.canonical_repository_root,
    baseResult.canonical_worktree_root,
    ...baseResult.approved_additional_roots
      .filter((entry) => entry.authorization_status === 'authorized')
      .map((entry) => entry.canonical_path),
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

  let lexicalPath;
  try {
    lexicalPath = canonicalPath(rawPath, semantics, operationCwd || context.cwd || context.repo_root || undefined);
  } catch (error) {
    return {
      raw_path: rawPath,
      lexical_path: null,
      canonical_path: null,
      status: 'missing-context',
      target_class: 'unresolved-target',
      link_type: 'none',
      resolved_inside: false,
      approved_root: null,
      evidence: null,
    };
  }
  const trustedResolver = options.trustedTargetResolver || options.trustedTargetResolutionResolver || options.targetResolutionResolver || options.targetResolver;
  const invocation = {
    invocation_id: sha256({
      raw_path: rawPath,
      lexical_path: lexicalPath,
      operation_cwd: operationCwd || null,
      repository_root: context.canonical_repository_root || null,
      worktree_root: context.canonical_worktree_root || null,
    }),
    raw_path: rawPath,
    lexical_path: lexicalPath,
    operation_cwd: operationCwd || null,
    repository_root: context.canonical_repository_root || null,
    worktree_root: context.canonical_worktree_root || null,
    target_digest: sha256(rawPath),
    repository_root_digest: sha256(context.canonical_repository_root || ''),
    worktree_root_digest: sha256(context.canonical_worktree_root || ''),
  };

  const unresolved = (status = 'unresolved', evidence = null) => ({
    raw_path: rawPath,
    lexical_path: lexicalPath,
    canonical_path: null,
    status: RESOLUTION_STATUSES.includes(status) ? status : 'unresolved',
    target_class: 'unresolved-target',
    link_type: 'none',
    resolved_inside: false,
    approved_root: null,
    evidence,
  });

  if (typeof trustedResolver !== 'function' && !(trustedResolver && typeof trustedResolver.resolve === 'function')) return unresolved();

  let supplied;
  try {
    const resolver = typeof trustedResolver === 'function' ? trustedResolver : trustedResolver.resolve.bind(trustedResolver);
    supplied = resolver(Object.freeze({ ...invocation }), context);
  } catch (error) {
    return unresolved('resolver-error');
  }
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return unresolved();
  const allowedKeys = new Set([
    'status', 'raw_path', 'lexical_path', 'canonical_path', 'resolved_path', 'link_type',
    'invocation_id', 'resolver_invocation_id', 'target_digest', 'input_target_digest',
    'repository_root_digest', 'source', 'provenance', 'trusted', 'fresh', 'stale',
    'ambiguous', 'filesystem_verified', 'worktree_root_digest',
  ]);
  if (Object.keys(supplied).some((key) => !allowedKeys.has(key))) return unresolved();
  const status = supplied.status;
  if (!RESOLUTION_STATUSES.includes(status)) return unresolved();
  if (status !== 'resolved') return unresolved(status, normalizeResolutionEvidence(supplied));
  const invocationMatches = (supplied.invocation_id !== undefined || supplied.resolver_invocation_id !== undefined)
    && (supplied.invocation_id === undefined || supplied.invocation_id === invocation.invocation_id)
    && (supplied.resolver_invocation_id === undefined || supplied.resolver_invocation_id === invocation.invocation_id);
  const targetDigestMatches = (supplied.target_digest === undefined || supplied.target_digest === invocation.target_digest)
    && (supplied.input_target_digest === undefined || supplied.input_target_digest === invocation.target_digest)
    && (supplied.target_digest !== undefined || supplied.input_target_digest !== undefined);
  if (
    supplied.raw_path !== rawPath
    || supplied.lexical_path !== lexicalPath
    || !invocationMatches
    || !targetDigestMatches
    || supplied.repository_root_digest !== invocation.repository_root_digest
    || supplied.worktree_root_digest !== invocation.worktree_root_digest
    || supplied.trusted !== true
    || supplied.fresh !== true
    || supplied.filesystem_verified !== true
    || supplied.stale === true
    || supplied.ambiguous === true
  ) return unresolved('ambiguous');
  const source = firstDefined(supplied.source, supplied.provenance, null);
  const provenance = firstDefined(supplied.provenance, supplied.source, null);
  if (
    typeof source !== 'string'
    || !source.trim()
    || typeof provenance !== 'string'
    || !provenance.trim()
    || /(?:caller|model|executor|transcript|untrusted|input)/i.test(`${source} ${provenance}`)
  ) return unresolved();
  const rawCanonical = firstDefined(supplied.canonical_path, supplied.resolved_path, null);
  if (typeof rawCanonical !== 'string' || !rawCanonical.trim()) return unresolved();
  if (supplied.canonical_path !== undefined && supplied.resolved_path !== undefined && supplied.canonical_path !== supplied.resolved_path) return unresolved('ambiguous');
  let canonical;
  try {
    canonical = canonicalPath(rawCanonical, semantics, operationCwd || context.cwd || context.repo_root || undefined);
  } catch (error) {
    return unresolved('unresolved');
  }
  const linkType = supplied.link_type === undefined || supplied.link_type === null ? 'none' : normalizeLinkType(supplied.link_type);
  if (supplied.link_type !== undefined && supplied.link_type !== null && (typeof supplied.link_type !== 'string' || !['none', 'symlink', 'junction', 'reparse-point'].includes(linkType))) return unresolved();
  if (!['none', 'symlink', 'junction', 'reparse-point'].includes(linkType)) return unresolved();
  const evidence = normalizeResolutionEvidence({
    status: 'resolved',
    source,
    provenance,
    filesystem_verified: true,
    link_type: linkType,
    resolved_path: canonical,
    canonical_path: canonical,
    invocation_id: invocation.invocation_id,
    target_digest: invocation.target_digest,
    repository_root_digest: invocation.repository_root_digest,
    worktree_root_digest: invocation.worktree_root_digest,
  });
  const result = {
    raw_path: rawPath,
    lexical_path: lexicalPath,
    canonical_path: canonical,
    status: 'resolved',
    target_class: 'unknown-target',
    link_type: linkType,
    resolved_inside: false,
    approved_root: null,
    evidence,
  };
  if (isWithin(context.canonical_repository_root, canonical, semantics)) {
    result.target_class = 'canonical-repository';
    result.resolved_inside = true;
  } else if (isWithin(context.canonical_worktree_root, canonical, semantics)) {
    result.target_class = 'canonical-worktree';
    result.resolved_inside = true;
  } else {
    const additional = (context.approved_additional_roots || []).find((entry) => (
      entry.status === 'resolved'
      && entry.authorization_status === 'authorized'
      && isWithin(entry.canonical_path, canonical, semantics)
    ));
    if (additional) {
      result.target_class = 'approved-additional-root';
      result.resolved_inside = true;
      result.approved_root = additional.canonical_path;
    } else if (linkType !== 'none') {
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
  normalizeResolutionEvidence,
  normalizeGitEvidence,
  trustedEvidence,
};
