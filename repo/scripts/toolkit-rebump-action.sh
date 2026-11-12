#!/usr/bin/env bash
# The "Re-bump" step of .github/workflows/toolkit-rebump.yml. With no push token (the governance
# GitHub App is not set up) it prints a note and ends green. With one it signs git and gh in with
# it, runs the re-bump command for the listed authors' pull requests and leaves the JSON report for
# the next step. A held pull request
# makes the command exit 1 with a full report, which is not a failure here; the report step fails
# the run when there is no readable report.
set -euo pipefail

report="${RUNNER_TEMP:?}/rebump-report.json"
if [ -z "${PUSH_TOKEN:-}" ]; then
  echo "::notice title=Toolkit re-bump::No governance GitHub App is set (repository variable TOOLKIT_GOVERNANCE_APP_CLIENT_ID and secret TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY), so nothing was re-bumped. Run the re-bump command by hand."
  echo "ran=false" >> "${GITHUB_OUTPUT:?}"
  exit 0
fi

export GH_TOKEN="$PUSH_TOKEN"
gh auth setup-git
git config --global user.name "github-actions[bot]"
git config --global user.email "github-actions[bot]@users.noreply.${GITHUB_SERVER_URL#https://}"
echo "ran=true" >> "${GITHUB_OUTPUT:?}"
node repo/scripts/toolkit-rebump-prs.cjs --apply --installation --authors "${AUTHORS:?}" > "$report" || true
cat "$report"
