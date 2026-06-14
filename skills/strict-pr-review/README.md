<!--
Generated from toolkit project source. Do not edit directly.
Project: development.strict-pr-review
Source: _projects/development/strict-pr-review/_main/skill/README.md
Update the project source and run sync.
-->
# Strict PR Review

Compact review-only skill for serious GitHub PR, branch, diff, proposed-merge, and merge-readiness reviews.

## Use This Skill For

- Reviewing a GitHub pull request, branch, diff, patch, or proposed merge.
- Checking whether a PR is ready to merge.
- Performing a serious review when the user says to check the PR properly.

## Not For

- Do not use for ordinary implementation work without a requested review verdict.
- Do not edit files, push commits, update PRs, post reviews, rerun workflows, merge, deploy, or mutate external systems unless the user explicitly switches from review to fix or action mode.
- Do not duplicate generic coding-agent execution rules.

## Expected Output

Return blocking findings, non-blocking findings, verification limits, and exactly one merge verdict: `MERGE`, `MERGE AFTER FIXES`, `DO NOT MERGE`, or `NEEDS MORE INFO`.
