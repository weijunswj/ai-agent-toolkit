---
name: strict-pr-review
description: Use when a user asks to review a GitHub PR, branch, diff, proposed merge, merge readiness, or to check a PR properly. Do not use when the user asks to implement fixes or do ordinary coding without a review verdict.
---

<!--
Generated from toolkit project source. Do not edit directly.
Project: development.strict-pr-review
Source: _projects/development/strict-pr-review/_main/skill/SKILL.md
Update the project source and run sync.
-->
# Strict PR Review

## Overview

Perform an evidence-based review of a GitHub PR, branch, diff, patch, or proposed merge. Inspect the real changed files and merge context before giving a verdict. Do not perform implementation changes unless the user explicitly switches from review to fix or execute mode.

Keep this skill focused on PR review workflow. Do not repeat generic execution-first coding rules, persona guidance, or broad research rules.

## Gather Evidence

When tools and access are available, inspect:

- PR metadata: number, title, body, author, labels, reviewers, base ref, head ref, commit list, and mergeability signal.
- Changed files and full diff or patch, including generated files, deleted files, lockfiles, migrations, workflows, config, docs, and tests.
- The changed files directly in the working tree or fetched branch, not just the PR summary.
- CI/check status, failed or skipped jobs, and relevant run logs when accessible.
- Review comments, issue links, user-stated intent, repo instructions, and project docs relevant to the touched area.

If any source is inaccessible, continue with what is available and name the gap in the review.

## Review Procedure

1. State the user-stated intent and the base/head being reviewed.
2. Compare implementation against that intent, PR description, repo instructions, and local conventions.
3. Inspect changed files directly enough to understand runtime behavior, not only the rendered diff.
4. Check for functional regressions, security issues, product-direction drift, missing tests, stale docs, generated-output drift, unsafe dependencies, migration/schema assumptions, deployment risk, and CI gaps.
5. Separate blocking findings from non-blocking findings.
6. Give a merge verdict only after stating what was and was not verified.

## Finding Severity

Treat a finding as blocking when it can cause incorrect behavior, data loss, security/privacy exposure, broken deploys, failed required checks, missing required generated output, unreviewed migration risk, or a mismatch with explicit user/repo intent.

Treat a finding as non-blocking when it is a maintainability, clarity, optional coverage, or follow-up concern that should not prevent merge on its own.

Every finding must include evidence: file path and line when possible, observed behavior or diff detail, why it matters, and what needs to change.

## Output

Use this order:

1. Blocking Findings
2. Non-Blocking Findings
3. Verification Limits
4. Merge Verdict

The merge verdict must be exactly one of:

- `MERGE`
- `MERGE AFTER FIXES`
- `DO NOT MERGE`
- `NEEDS MORE INFO`

Avoid generic praise. Be direct, concise, and evidence-based. If no blocking findings are found, say that clearly while still naming residual risk or unverified areas.

## Safety Boundary

Review-only by default. Do not edit files, push commits, update PRs, post reviews, rerun workflows, merge, deploy, or mutate external systems unless the user explicitly switches from review to fix or action mode and normal repo approval/auth rules allow the requested action.
