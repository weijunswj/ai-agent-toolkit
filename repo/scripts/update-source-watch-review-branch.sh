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
remote_no_op_verified=false

if [[ "$remote_state" == 'present' ]]; then
  inspection_ref="refs/source-watch/inspect/$remote_sha"
  remote_object_verified=false
  if git fetch --no-tags --force origin "refs/heads/$BRANCH:$inspection_ref"; then
    fetched_sha="$(git rev-parse "$inspection_ref^{commit}" 2>/dev/null || true)"
    remote_object_type="$(git cat-file -t "$remote_sha" 2>/dev/null || true)"
    if [[ "$fetched_sha" == "$remote_sha" && "$remote_object_type" == 'commit' ]] &&
       git cat-file -e "$remote_sha^{tree}" 2>/dev/null; then
      remote_object_verified=true
    fi
  fi

  if [[ "$remote_object_verified" == true ]]; then
    remote_commit_line="$(git rev-list --parents -n 1 "$remote_sha" 2>/dev/null || true)"
    remote_parent_count="$(printf '%s\n' "$remote_commit_line" | awk '{ print NF - 1 }')"
    remote_parent="$(printf '%s\n' "$remote_commit_line" | awk 'NF == 2 { print $2 }')"
    if [[ "${remote_commit_line%% *}" == "$remote_sha" && "$remote_parent_count" == '1' && -n "$remote_parent" ]] &&
       git merge-base --is-ancestor "$remote_parent" origin/main; then
      remote_changed_paths="$(git diff-tree --no-commit-id --name-only --no-renames -r "$remote_parent" "$remote_sha" 2>/dev/null || true)"
      if [[ "$remote_changed_paths" == "$REPORT_PATH" ]]; then
        remote_report_entry="$(git ls-tree "$remote_sha" -- "$REPORT_PATH" 2>/dev/null || true)"
        if [[ -n "$remote_report_entry" ]]; then
          remote_report_mode="${remote_report_entry%% *}"
          remote_report_rest="${remote_report_entry#* }"
          remote_report_type="${remote_report_rest%% *}"
          remote_report_rest="${remote_report_rest#* }"
          remote_report_blob="${remote_report_rest%%$'\t'*}"
          remote_report_path=''
          if [[ "$remote_report_rest" == *$'\t'* ]]; then
            remote_report_path="${remote_report_rest#*$'\t'}"
          fi
          remote_report_blob_type="$(git cat-file -t "$remote_report_blob" 2>/dev/null || true)"
          if [[ "$remote_report_mode" == '100644' && "$remote_report_type" == 'blob' &&
                "$remote_report_path" == "$REPORT_PATH" ]] &&
             [[ "$remote_report_blob" =~ ^[0-9a-fA-F]{40}$ ]] &&
             [[ "$remote_report_blob_type" == 'blob' && "$generated_report_blob" == "$remote_report_blob" ]]; then
            remote_no_op_verified=true
          fi
        fi
      fi
    fi
  fi
fi

if [[ "$remote_no_op_verified" == true ]]; then
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

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git switch -C "$BRANCH" origin/main
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
if [[ -n "${GH_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
fi
if [[ "$remote_state" == 'present' ]]; then
  git push --force-with-lease="refs/heads/$BRANCH:$remote_sha" origin "HEAD:$BRANCH"
else
  git push --force-with-lease="refs/heads/$BRANCH:" origin "HEAD:$BRANCH"
fi
write_output 'pushed=true'
