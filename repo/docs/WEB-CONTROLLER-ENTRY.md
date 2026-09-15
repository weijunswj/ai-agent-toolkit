# Web Controller Entry: G3

This document is the repository-side execution entry for the frozen G3 run
authorised by issue #386 comment `5646714874`.

```text
ROOT=S2-PRE-E4-STALE-AUTHORITY-ORCHESTRATION-RESIDUE-001
LOCK=DL-S2-PRE-E4-STALE-AUTHORITY-ORCHESTRATION-RESIDUE-001
GATE=G3
PACKAGE_VERSION=2.11.6
```

## Admission

Before mutation, re-read the live repository, canonical `main` commit/tree,
issues #240, #359, #384, #386, #319, the open pull-request inventory, and the
immutable Custom Instructions revision. The candidate must be created from the
admitted canonical `main` and must not reuse a stale branch or worktree.

The controlling implementation is the versioned role registry, the exact
resolved launch record, and the capability-proven host adapter feeding the
existing bounded execution loop. Depth-1 children resolve independently;
omitted child speed is Standard and never inherits a Priority root. Only the
explicit homogeneous G3 child authority may authorize a Priority child.

## Mutation boundary

The exact mutable, new, and delete paths are the machine-readable contract in
[`g3-implementation-allowlist-v1.json`](../contracts/route-resolution/g3-implementation-allowlist-v1.json).
Any path outside that union is an immediate `UNEXPECTED_PATH_CHANGE` return to
Web. Source locks, attribution files, Custom Instructions, package.json, and
`.agents/plugins/marketplace.json` remain untouched.

The OpenCode native package and migration/proof machinery may be implemented,
but live installation and native UAT are not part of G3. AG2 is skills-only and
proof-gated; unsupported discovery returns `AG2_PROOF_UNAVAILABLE` without an
invented destination or plugin authority. The existing OpenCode bridge remains
migration-only until Web accepts its transition.

## Publication stop

Run the frozen local validation matrix, public-surface/secret audit, exact
allowlist assertion, and `git diff --check`. Only after they pass may the
governed branch be committed, pushed, and published as exactly one Draft PR
using the production human-v2 PR body path. Bind the PR to the exact admitted
base, candidate head/tree, authority digest, and changed-path set.

After Draft creation, inspect only currently available exact-head hosted checks,
reviews, comments, inline comments, threads, requested reviewers, legacy
statuses, and check runs. Keep the PR Draft. Do not start E4 or G4, mark Ready,
merge, deploy, install a live host plugin, mutate #319, or delete retained
terminal branches.
