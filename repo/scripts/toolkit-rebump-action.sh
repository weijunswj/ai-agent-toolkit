#!/usr/bin/env bash
# The "Re-bump" step of .github/workflows/toolkit-rebump.yml. With no push key it re-bumps nothing:
# it lists, with the built-in read token, the listed authors' open pull requests that change the
# version file (they carry a bump that main's move made stale), ends green and silent when there are
# none, and fails naming each when there are, with the by-hand command, so a stale bump never waits
# behind a repeating note. With a key it signs git and gh in with that key, runs the re-bump command for the
# listed authors' pull requests and leaves the JSON report for the next step. A held pull request
# makes the command exit 1 with a full report, which is not a failure here; the report step fails
# the run when there is no readable report.
set -euo pipefail

report="${RUNNER_TEMP:?}/rebump-report.json"
version_file="repo/contracts/toolkit-local-bridge/version.json"
if [ -z "${TOOLKIT_REBUMP_TOKEN:-}" ]; then
  echo "ran=false" >> "${GITHUB_OUTPUT:?}"
  export GH_TOKEN="${READ_TOKEN:?}"
  repository="${REPOSITORY:?}"
  stale=""
  authors=",${AUTHORS:?},"
  if ! open="$(gh api "repos/${repository}/pulls?state=open&per_page=100" --jq '.[] | select((.draft | not) and .head.repo.full_name == .base.repo.full_name) | "\(.number) \(.user.login)"')"; then
    echo "::error title=Toolkit re-bump::No push key is set and the open pull requests could not be read, so stale version bumps cannot be checked. Run node repo/scripts/toolkit-rebump-prs.cjs by hand."
    exit 1
  fi
  while read -r number login; do
    [ -n "${number:-}" ] || continue
    case "$authors" in *",${login},"*) ;; *) continue ;; esac
    if ! files="$(gh api "repos/${repository}/pulls/${number}/files?per_page=100" --jq '.[].filename')"; then
      echo "::error title=Toolkit re-bump::Pull request ${number}'s files could not be read. Run node repo/scripts/toolkit-rebump-prs.cjs by hand."
      exit 1
    fi
    if printf '%s\n' "$files" | grep -qxF "$version_file"; then stale="${stale} #${number}"; fi
  done <<< "$open"
  if [ -n "$stale" ]; then
    echo "::error title=Toolkit re-bump::Main moved and these pull requests carry a version bump that is now stale:${stale}. No push key is set (repository secret TOOLKIT_REBUMP_TOKEN), so the merging agent re-bumps them by hand: node repo/scripts/toolkit-rebump-prs.cjs --apply after agreeing branch custody with each builder."
    exit 1
  fi
  exit 0
fi

export GH_TOKEN="$TOOLKIT_REBUMP_TOKEN"
gh auth setup-git
git config --global user.name "github-actions[bot]"
git config --global user.email "github-actions[bot]@users.noreply.${GITHUB_SERVER_URL#https://}"
echo "ran=true" >> "${GITHUB_OUTPUT:?}"
node repo/scripts/toolkit-rebump-prs.cjs --apply --authors "${AUTHORS:?}" > "$report" || true
cat "$report"
