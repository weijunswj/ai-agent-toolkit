#!/usr/bin/env bash
set -euo pipefail

: "${BRANCH:?BRANCH is required}"
: "${REPORT_TEMP:?REPORT_TEMP is required}"
: "${REPORT_PATH:?REPORT_PATH is required}"

readonly expected_branch='source-watch/review-active-third-party-updates'
readonly expected_report_path='repo/source-watch/reviews/active-third-party-updates.md'

if [[ "$BRANCH" != "$expected_branch" ]]; then
  echo "Refusing unexpected Source Watch branch: $BRANCH" >&2
  exit 1
fi
if [[ "$REPORT_PATH" != "$expected_report_path" ]]; then
  echo "Refusing unexpected Source Watch report path: $REPORT_PATH" >&2
  exit 1
fi
if [[ ! -f "$REPORT_TEMP" || -L "$REPORT_TEMP" ]]; then
  echo "Source Watch report is not a regular file: $REPORT_TEMP" >&2
  exit 1
fi

write_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

# The observation is deliberately tri-state. A malformed, ambiguous, or
# unavailable exact-ref response is never treated as absence.
observe_remote_branch() {
  local remote_lines line_count line observed_sha observed_ref
  OBS_STATE='unverified'
  OBS_SHA=''

  if ! remote_lines="$(git ls-remote --heads origin "refs/heads/$BRANCH")"; then
    return 0
  fi
  if [[ -z "$remote_lines" ]]; then
    OBS_STATE='absent'
    return 0
  fi

  line_count="$(printf '%s\n' "$remote_lines" | awk 'NF { count += 1 } END { print count + 0 }')"
  if [[ "$line_count" != '1' ]]; then
    return 0
  fi
  line="$(printf '%s\n' "$remote_lines" | awk 'NF { print; exit }')"
  if [[ "$line" != *$'\t'* ]]; then
    return 0
  fi
  observed_sha="${line%%$'\t'*}"
  observed_ref="${line#*$'\t'}"
  if [[ "$observed_ref" != "refs/heads/$BRANCH" || "$observed_ref" == *$'\t'* ]]; then
    return 0
  fi
  if ! [[ "$observed_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    return 0
  fi

  OBS_STATE='present'
  OBS_SHA="$observed_sha"
}

observe_remote_branch
if [[ "$OBS_STATE" == 'unverified' ]]; then
  echo 'Initial Source Watch branch observation was unverified; attempting one fresh exact-ref observation.' >&2
  observe_remote_branch
  if [[ "$OBS_STATE" == 'unverified' ]]; then
    echo 'Unable to establish a valid Source Watch branch authority.' >&2
    exit 1
  fi
fi

readonly remote_state="$OBS_STATE"
readonly remote_sha="$OBS_SHA"
generated_report_blob="$(git hash-object -- "$REPORT_TEMP")"

refuse() {
  echo "Refusing to update the Source Watch branch: $1" >&2
  echo 'Nothing was pushed. Close the notification PR and remove the branch with the owner'"'"'s OK, then let the next run recreate it.' >&2
  exit 1
}

# The branch only ever grows. Every commit after its merge-base with trusted main must be a
# single-parent commit that changes the report path and nothing else, leaving a regular report
# file. Any other shape is refused, never overwritten: the repository forbids force-pushes.
readonly max_report_commits=1000
report_tip_blob=''
verify_report_only_branch() {
  local tip="$1" base commit_lines line commit parent extra changed entry mode rest type blob path
  if git cat-file -e "origin/main:$REPORT_PATH" 2>/dev/null; then
    refuse 'trusted main already contains the report path.'
  fi
  if ! base="$(git merge-base origin/main "$tip" 2>/dev/null)" || [[ -z "$base" ]]; then
    refuse 'the branch shares no history with trusted main.'
  fi
  if ! commit_lines="$(git rev-list --parents --reverse "$base..$tip" 2>/dev/null)" || [[ -z "$commit_lines" ]]; then
    refuse 'the branch has no report commits after trusted main.'
  fi
  if (( $(printf '%s\n' "$commit_lines" | awk 'NF { count += 1 } END { print count + 0 }') > max_report_commits )); then
    refuse "the branch has more than $max_report_commits report commits."
  fi
  local expected_parent="$base"
  while IFS=' ' read -r commit parent extra; do
    if [[ -z "$commit" || -z "$parent" || -n "$extra" || "$parent" != "$expected_parent" ]]; then
      refuse "commit $commit is not a single-parent report commit on the branch line."
    fi
    changed="$(git diff-tree --no-commit-id --name-only --no-renames -r "$parent" "$commit" 2>/dev/null || true)"
    if [[ "$changed" != "$REPORT_PATH" ]]; then
      refuse "commit $commit changes paths other than the report."
    fi
    entry="$(git ls-tree "$commit" -- "$REPORT_PATH" 2>/dev/null || true)"
    mode="${entry%% *}"
    rest="${entry#* }"
    type="${rest%% *}"
    rest="${rest#* }"
    blob="${rest%%$'\t'*}"
    path=''
    if [[ "$rest" == *$'\t'* ]]; then
      path="${rest#*$'\t'}"
    fi
    if [[ "$mode" != '100644' || "$type" != 'blob' || "$path" != "$REPORT_PATH" ]] ||
       ! [[ "$blob" =~ ^[0-9a-fA-F]{40}$ ]] ||
       [[ "$(git cat-file -t "$blob" 2>/dev/null || true)" != 'blob' ]]; then
      refuse "commit $commit does not leave the report as a regular file."
    fi
    report_tip_blob="$blob"
    expected_parent="$commit"
  done <<< "$commit_lines"
  if [[ "$expected_parent" != "$tip" ]]; then
    refuse 'the report commits do not end at the branch tip.'
  fi
}

if [[ "$remote_state" == 'present' ]]; then
  inspection_ref="refs/source-watch/inspect/$remote_sha"
  if ! git fetch --no-tags origin "refs/heads/$BRANCH:$inspection_ref"; then
    refuse 'the remote branch could not be fetched for inspection.'
  fi
  fetched_sha="$(git rev-parse "$inspection_ref^{commit}" 2>/dev/null || true)"
  remote_object_type="$(git cat-file -t "$remote_sha" 2>/dev/null || true)"
  if [[ "$fetched_sha" != "$remote_sha" || "$remote_object_type" != 'commit' ]] ||
     ! git cat-file -e "$remote_sha^{tree}" 2>/dev/null; then
    refuse 'the fetched branch does not match the observed commit.'
  fi
  verify_report_only_branch "$remote_sha"

  if [[ "$generated_report_blob" == "$report_tip_blob" ]]; then
    # Re-read the exact ref immediately before accepting the no-op. A move,
    # deletion, malformed response, or ambiguous response is not authority.
    observe_remote_branch
    if [[ "$OBS_STATE" != 'present' || "$OBS_SHA" != "$remote_sha" ]]; then
      echo 'Source Watch branch changed or became unverifiable during no-op verification.' >&2
      exit 1
    fi
    echo 'Generated source-watch report matches the verified report-only remote commit; no commit or push.'
    write_output 'pushed=false'
    exit 0
  fi
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
if [[ "$remote_state" == 'present' ]]; then
  # Add one commit on top of the verified remote tip, so the push is a fast-forward.
  git switch -C "$BRANCH" "$remote_sha"
else
  git switch -C "$BRANCH" origin/main
fi
mkdir -p "$(dirname "$REPORT_PATH")"
if [[ -L "$REPORT_PATH" ]]; then
  echo "Refusing to overwrite symlink report path: $REPORT_PATH" >&2
  exit 1
fi
install -m 0644 "$REPORT_TEMP" "$REPORT_PATH"
if [[ ! -f "$REPORT_PATH" || -L "$REPORT_PATH" ]]; then
  echo "Report path is not a regular file: $REPORT_PATH" >&2
  exit 1
fi
git add -- "$REPORT_PATH"
staged_files="$(git diff --cached --name-only)"
if [[ "$staged_files" != "$REPORT_PATH" ]]; then
  echo 'Refusing to stage unexpected files:' >&2
  printf '%s\n' "$staged_files" >&2
  exit 1
fi
if git diff --cached --quiet; then
  write_output 'pushed=false'
  exit 0
fi

git commit -m 'Update active third-party source review report'

# The token reaches only this one push, through git's environment configuration: it is never
# written to .git/config, the remote URL or the command line.
push_review_branch() {
  if [[ -n "${GH_TOKEN:-}" ]]; then
    local header
    header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_0="$header" \
      git push "$@"
  else
    git push "$@"
  fi
}
# A plain push: the server accepts it only as a fast-forward of the current remote branch (or a
# new branch), so a competing update makes it fail instead of being overwritten. No retry.
push_review_branch origin "HEAD:refs/heads/$BRANCH"
write_output 'pushed=true'
