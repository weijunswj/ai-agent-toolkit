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

readonly fix_shape='Close the notification PR and remove the branch with the owner'"'"'s OK; the next run recreates it from trusted main.'
readonly fix_main='Remove the report file from trusted main in a reviewed PR; until then the branch cannot be updated.'
readonly fix_retry='The branch probably moved during this run; nothing was overwritten and the next scheduled run retries.'

# Exits without pushing. The second argument says how to recover from this particular refusal.
refuse() {
  echo "Refusing to update the Source Watch branch: $1" >&2
  echo "Nothing was pushed. $2" >&2
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
    refuse 'trusted main already contains the report path.' "$fix_main"
  fi
  if ! base="$(git merge-base origin/main "$tip" 2>/dev/null)" || [[ -z "$base" ]]; then
    refuse 'the branch shares no history with trusted main.' "$fix_shape"
  fi
  if ! commit_lines="$(git rev-list --parents --reverse "$base..$tip" 2>/dev/null)" || [[ -z "$commit_lines" ]]; then
    refuse 'the branch has no report commits after trusted main.' "$fix_shape"
  fi
  if (( $(printf '%s\n' "$commit_lines" | awk 'NF { count += 1 } END { print count + 0 }') > max_report_commits )); then
    refuse "the branch has more than $max_report_commits report commits." "$fix_shape"
  fi
  local expected_parent="$base"
  while IFS=' ' read -r commit parent extra; do
    if [[ -z "$commit" || -z "$parent" || -n "$extra" || "$parent" != "$expected_parent" ]]; then
      refuse "commit $commit is not a single-parent report commit on the branch line." "$fix_shape"
    fi
    changed="$(git diff-tree --no-commit-id --name-only --no-renames -r "$parent" "$commit" 2>/dev/null || true)"
    if [[ "$changed" != "$REPORT_PATH" ]]; then
      refuse "commit $commit changes paths other than the report." "$fix_shape"
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
      refuse "commit $commit does not leave the report as a regular file." "$fix_shape"
    fi
    report_tip_blob="$blob"
    expected_parent="$commit"
  done <<< "$commit_lines"
  if [[ "$expected_parent" != "$tip" ]]; then
    refuse 'the report commits do not end at the branch tip.' "$fix_shape"
  fi
}

if [[ "$remote_state" == 'present' ]]; then
  inspection_ref="refs/source-watch/inspect/$remote_sha"
  if ! git fetch --no-tags origin "refs/heads/$BRANCH:$inspection_ref"; then
    refuse 'the remote branch could not be fetched for inspection.' "$fix_retry"
  fi
  fetched_sha="$(git rev-parse "$inspection_ref^{commit}" 2>/dev/null || true)"
  remote_object_type="$(git cat-file -t "$remote_sha" 2>/dev/null || true)"
  if [[ "$fetched_sha" != "$remote_sha" || "$remote_object_type" != 'commit' ]] ||
     ! git cat-file -e "$remote_sha^{tree}" 2>/dev/null; then
    refuse 'the fetched branch does not match the observed commit.' "$fix_retry"
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

# Build the new report commit without touching the checkout: the later workflow steps must keep
# running trusted main's code, so the working tree, index and HEAD never move. A temporary index
# holds the parent tree plus the new report blob.
if [[ "$remote_state" == 'present' ]]; then
  parent_commit="$remote_sha"
else
  parent_commit="$(git rev-parse --verify 'origin/main^{commit}')"
fi
report_blob="$(git hash-object -w -- "$REPORT_TEMP")"
temp_index="$(mktemp)"
trap 'rm -f "$temp_index"' EXIT
GIT_INDEX_FILE="$temp_index" git read-tree "$parent_commit"
GIT_INDEX_FILE="$temp_index" git update-index --add --cacheinfo "100644,$report_blob,$REPORT_PATH"
new_tree="$(GIT_INDEX_FILE="$temp_index" git write-tree)"
if [[ "$new_tree" == "$(git rev-parse "$parent_commit^{tree}")" ]]; then
  write_output 'pushed=false'
  exit 0
fi
new_commit="$(
  GIT_AUTHOR_NAME='github-actions[bot]' GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com' \
  GIT_COMMITTER_NAME='github-actions[bot]' GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com' \
    git commit-tree "$new_tree" -p "$parent_commit" -m 'Update active third-party source review report'
)"
changed_files="$(git diff-tree --no-commit-id --name-only --no-renames -r "$parent_commit" "$new_commit")"
if [[ "$changed_files" != "$REPORT_PATH" ]]; then
  echo 'Refusing to push a commit that changes unexpected files:' >&2
  printf '%s\n' "$changed_files" >&2
  exit 1
fi

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
# new branch), so a competing update makes it fail instead of being overwritten. One attempt, no
# retry and no fallback.
if ! push_review_branch origin "$new_commit:refs/heads/$BRANCH"; then
  echo "Source Watch branch push was rejected. $fix_retry" >&2
  exit 1
fi
write_output 'pushed=true'
