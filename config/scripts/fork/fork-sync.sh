#!/usr/bin/env bash
# The fork-sync workflow's git logic (FORK.md "How sync works"), kept out of the YAML so
# fork-sync.test.mjs can run it against throwaway repos.
#
#   fork-sync.sh detect      newest stable upstream tag, and the newest one already merged into main
#   fork-sync.sh merge       merge that tag into main as one merge commit; main is untouched on conflict
#   fork-sync.sh merged-tag  the newest stable upstream tag merged into HEAD (needs a detect first)
#   fork-sync.sh released    whether HEAD (or $SHA) already has a published fork release
#   fork-sync.sh release-line  one summary line: did a release of main go out despite a conflict or skip
#   fork-sync.sh publish     commit status.json to the status branch
#
# main is never rebased or force-pushed: each new upstream tag is merged in with `git merge --no-ff`.
#
# Values come from the environment, never from one owner's names:
#   FORK_SYNC_UPSTREAM_REMOTE  remote holding upstream (default upstream)
#   FORK_SYNC_ORIGIN_REMOTE    the fork's own remote (default origin)
#   FORK_SYNC_STATUS_BRANCH    branch holding status.json (default fork-sync-status)
#   GITHUB_OUTPUT              key=value outputs are appended here (default /dev/null)
set -euo pipefail

UPSTREAM_REMOTE="${FORK_SYNC_UPSTREAM_REMOTE:-upstream}"
ORIGIN_REMOTE="${FORK_SYNC_ORIGIN_REMOTE:-origin}"
STATUS_BRANCH="${FORK_SYNC_STATUS_BRANCH:-fork-sync-status}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
STATUS_REF='refs/fork-sync/status'
STABLE_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'

output() {
  printf '%s=%s\n' "$1" "$2" >>"$OUT"
}

is_ancestor() {
  git merge-base --is-ancestor "$1" "$2" 2>/dev/null
}

# The status branch's last commit, fetched to STATUS_REF; empty when the branch does not exist yet.
fetch_status_branch() {
  git update-ref -d "$STATUS_REF" 2>/dev/null || true
  if git fetch --no-tags --quiet "$ORIGIN_REMOTE" "+refs/heads/$STATUS_BRANCH:$STATUS_REF" 2>/dev/null; then
    git rev-parse --verify --quiet "$STATUS_REF^{commit}" || true
  fi
}

# The newest stable upstream tag whose commit is under main, as a SHA; empty when there is none.
newest_tag_under_main() {
  local tag
  for tag in $(git for-each-ref --format='%(refname:lstrip=2)' 'refs/upstream-tags/' \
    | grep -E "$STABLE_RE" | sort -V -r || true); do
    if is_ancestor "refs/upstream-tags/$tag^{commit}" HEAD; then
      git rev-parse "refs/upstream-tags/$tag^{commit}"
      return
    fi
  done
}

# package.json's version at HEAD when it names a stable upstream tag fetched here; else nothing.
moved_tag_version() {
  local version
  version="$(git show HEAD:package.json 2>/dev/null | sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -n 1 || true)"
  if [ -n "$version" ] && printf 'v%s' "$version" | grep -Eq "$STABLE_RE" \
    && git rev-parse --verify --quiet "refs/upstream-tags/v$version^{commit}" >/dev/null; then
    printf '%s\n' "$version"
  fi
}

# The upstream version of a commit: its stable tag when one points at it, else package.json.
version_at() {
  local sha="$1" tag
  tag="$(git for-each-ref --points-at "$sha" --format='%(refname:lstrip=2)' 'refs/upstream-tags/' \
    | grep -E "$STABLE_RE" | sort -V | tail -n 1 || true)"
  if [ -n "$tag" ]; then
    printf '%s\n' "${tag#v}"
  else
    git show "$sha:package.json" 2>/dev/null | sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -n 1
  fi
}

# The newest stable upstream tag merged into main is the fork base: its tag name gives the
# upstream version (the p in M.m.(p*1000+N)), and ancestry alone finds it, so nothing is recorded.
# A tag upstream moved to another commit counts as new until that commit is under main.
cmd_detect() {
  local latest latest_sha base
  output old_main "$(git rev-parse HEAD)"
  latest="$(git ls-remote --tags --refs "$UPSTREAM_REMOTE" 'v*' | sed 's#.*refs/tags/##' \
    | grep -E "$STABLE_RE" | sort -V | tail -n 1 || true)"
  if [ -z "$latest" ]; then
    echo "::error::No stable vX.Y.Z tag found upstream"
    output detect_error 'No stable vX.Y.Z tag was found upstream.'
    return 1
  fi
  # Forced (+), so a tag upstream moved to another commit is read at its new commit.
  git fetch --no-tags --quiet --filter=blob:none "$UPSTREAM_REMOTE" '+refs/tags/v*:refs/upstream-tags/v*'
  latest_sha="$(git rev-parse "refs/upstream-tags/$latest^{commit}")"
  base="$(newest_tag_under_main || true)"
  local base_version='' source='newest upstream tag merged into main'
  if [ -n "$base" ]; then
    base_version="$(version_at "$base")"
  else
    # Upstream moved the tag main was built on, so no tag commit is under main any more. The merged
    # tag's version is still in package.json (a tag merge takes the tag's version).
    base_version="$(moved_tag_version)"
    if [ -n "$base_version" ]; then
      base="$(git merge-base HEAD "refs/upstream-tags/v$base_version^{commit}" || true)"
      source='package.json version (its tag was moved upstream)'
    fi
  fi
  if [ -z "$base" ]; then
    echo "::error::No stable upstream tag is merged into main"
    output detect_error 'No stable upstream tag is merged into main; merge one by hand (FORK.md).'
    return 1
  fi
  local state='behind'
  if is_ancestor "$latest_sha" HEAD; then
    state='in-sync'
  fi
  output latest "$latest"
  output latest_sha "$latest_sha"
  output base_sha "$base"
  output base_source "$source"
  output base_version "$base_version"
  output state "$state"
  echo "main has merged $base ($base_version), newest upstream is $latest at $latest_sha: $state"
}

# The newest stable upstream tag under HEAD, without the v; empty when there is none.
cmd_merged_tag() {
  local sha
  sha="$(newest_tag_under_main || true)"
  if [ -n "$sha" ]; then
    version_at "$sha"
  else
    moved_tag_version
  fi
}

# Upstream releases a tag on its own commit beside its branch, and that commit bumps the "version"
# line of package.json. Main holds the previous release commit, so merging the next tag always
# conflicts on that one line. This settles it for the tag's version when the rest of the file
# merges cleanly (ours with that line set to theirs, 3-way merged against the base); any other
# difference in package.json stays a conflict. package.json in git keeps the upstream version:
# the build stamps the fork version on its own copy.
resolve_package_version_conflict() {
  local dir ours_version theirs_version
  dir="$(mktemp -d)"
  git show :1:package.json >"$dir/base" 2>/dev/null || { rm -rf "$dir"; return 1; }
  git show :2:package.json >"$dir/ours" 2>/dev/null || { rm -rf "$dir"; return 1; }
  git show :3:package.json >"$dir/theirs" 2>/dev/null || { rm -rf "$dir"; return 1; }
  theirs_version="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$dir/theirs" | head -n 1)"
  ours_version="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$dir/ours" | head -n 1)"
  if [ -z "$theirs_version" ] || [ -z "$ours_version" ]; then
    rm -rf "$dir"
    return 1
  fi
  sed "s/^  \"version\": \"[^\"]*\"/  \"version\": \"$theirs_version\"/" "$dir/ours" >"$dir/ours-bumped"
  sed -i.bak "s/^  \"version\": \"[^\"]*\"/  \"version\": \"$theirs_version\"/" "$dir/base"
  # With every side's version line equal, only real package.json differences can conflict.
  if git merge-file -p "$dir/ours-bumped" "$dir/base" "$dir/theirs" >"$dir/result"; then
    cp "$dir/result" package.json
    git add package.json
    rm -rf "$dir"
    echo "package.json: version $ours_version -> $theirs_version taken from $LATEST (the only difference)"
    return 0
  fi
  rm -rf "$dir"
  return 1
}

# Env: LATEST (the tag name), LATEST_SHA, SIGNING ('true' to require a good signature),
# CONFLICTS_FILE, CONFLICT_CONTINUES ('true' to exit 0 on a conflict: the workflow then goes on to
# release main as it is and fails the run in its last job). One merge commit on the local main; on a conflict the merge is aborted, the
# conflicted files are listed and nothing was changed. The step's first output line on a conflict
# is the marker an Orca automation matches: FORK-SYNC-CONFLICT <tag>.
cmd_merge() {
  : "${LATEST:?}" "${LATEST_SHA:?}"
  local conflicts_file="${CONFLICTS_FILE:-/dev/null}" conflicts unsigned log merged=0
  log="$(mktemp)"
  if git merge --no-ff --no-edit -m "Merge upstream $LATEST into main" "$LATEST_SHA" >"$log" 2>&1; then
    merged=1
  else
    conflicts="$(git diff --name-only --diff-filter=U || true)"
    if [ "$conflicts" = 'package.json' ] && resolve_package_version_conflict >>"$log" 2>&1 \
      && git commit -q --no-edit >>"$log" 2>&1; then
      merged=1
    fi
  fi
  if [ "$merged" != 1 ]; then
    git merge --abort 2>/dev/null || true
    if [ -z "$conflicts" ]; then
      cat "$log"
      rm -f "$log"
      echo "::error::Merging $LATEST ($LATEST_SHA) failed before any conflict"
      output merge_error 'true'
      return 1
    fi
    echo "FORK-SYNC-CONFLICT $LATEST"
    echo "Merging $LATEST into main stopped on conflicts in:"
    printf '%s\n' "$conflicts"
    echo '--- git output ---'
    cat "$log"
    rm -f "$log"
    printf '%s\n' "$conflicts" >"$conflicts_file"
    output conflict 'true'
    # A random delimiter, so no file name can end the multi-line output early.
    local eof="FORK_SYNC_EOF_${RANDOM}${RANDOM}${RANDOM}"
    { echo "conflicts<<$eof"; printf '%s\n' "$conflicts"; echo "$eof"; } >>"$OUT"
    echo "::error::FORK-SYNC-CONFLICT $LATEST: merging stopped on conflicts in: ${conflicts//$'\n'/, }"
    [ "${CONFLICT_CONTINUES:-}" = 'true' ] && return 0
    return 1
  fi
  cat "$log"
  rm -f "$log"
  if [ "${SIGNING:-}" = 'true' ]; then
    unsigned="$(git log -1 --format='%G? %h %s' HEAD | grep -v '^G ' || true)"
    if [ -n "$unsigned" ]; then
      printf '%s\n' "$unsigned"
      echo "::error::The merge commit has no good signature from FORK_GIT_SIGNING_KEY"
      output unsigned 'true'
      return 1
    fi
    echo "The merge commit is signed."
  fi
  output changed 'true'
}

# Env: SHA (default HEAD). Outputs released=true when a published, non-draft release carries a tag at
# that commit, else released=false. A main with commits newer than the last release has none.
cmd_released() {
  local sha="${SHA:-$(git rev-parse HEAD)}" tags_at_sha published
  tags_at_sha="$(git ls-remote --tags "$ORIGIN_REMOTE" 'v*' \
    | awk -v sha="$sha" '$1 == sha { sub("refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2 }' \
    | sort -u)"
  published="$(gh api --paginate "repos/$GITHUB_REPOSITORY/releases" \
    --jq '.[] | select(.draft == false) | .tag_name' | sort -u)"
  if [ -n "$tags_at_sha" ] && [ -n "$(comm -12 <(printf '%s\n' "$tags_at_sha") <(printf '%s\n' "$published"))" ]; then
    output released 'true'
    echo "$sha already has a fork release"
  else
    output released 'false'
    echo "$sha has no fork release yet"
  fi
}

# Env: WHY ('conflict' or 'skipped'), RELEASED (the sync job's released output), BUILD_RESULT
# (build-mac's result), VERSION, SHA. One line for the run summary and log: whether main was
# released although the upstream merge did not happen, and which release.
cmd_release_line() {
  local why="${WHY:?}" prefix='Release of main'
  [ "$why" = 'conflict' ] && prefix='Release of main despite the upstream conflict'
  [ "$why" = 'skipped' ] && prefix='Release of main with the upstream merge skipped'
  if [ "${RELEASED:-}" = 'true' ]; then
    echo "$prefix: none built, main already has a fork release."
  elif [ "${RELEASED:-}" = 'false' ] && [ "${BUILD_RESULT:-}" = 'success' ]; then
    echo "$prefix: yes, v${VERSION:-?} (${SHA:-?}) went out."
  elif [ "${RELEASED:-}" = 'false' ]; then
    echo "$prefix: v${VERSION:-?} (${SHA:-?}) was tried and did not go out (build ${BUILD_RESULT:-unknown})."
  else
    echo "$prefix: none, the sync job stopped before it could be built."
  fi
}

# Env: STATUS_FILE (the JSON to publish). Builds one commit on the status branch with plumbing, so the job's checkout and
# index are untouched, and pushes it without force: the workflow's concurrency group runs one
# sync at a time, so the fetched tip is the tip.
cmd_publish() {
  : "${STATUS_FILE:?}"
  local parent tree_entries=() blob commit message
  parent="$(fetch_status_branch)"
  blob="$(git hash-object -w "$STATUS_FILE")"
  tree_entries+=("100644 blob $blob	status.json")
  message="fork-sync status: $(sed -n 's/^  "state": "\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -n 1)"
  local tree
  tree="$(printf '%s\n' "${tree_entries[@]}" | git mktree)"
  # A bot commit on a data branch: no workflow files in its tree, so pushing it starts nothing.
  export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-github-actions[bot]}"
  export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
  export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$GIT_AUTHOR_NAME}"
  export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$GIT_AUTHOR_EMAIL}"
  if [ -n "$parent" ]; then
    commit="$(git -c commit.gpgsign=false commit-tree "$tree" -p "$parent" -m "$message")"
  else
    commit="$(git -c commit.gpgsign=false commit-tree "$tree" -m "$message")"
  fi
  git push --quiet "$ORIGIN_REMOTE" "$commit:refs/heads/$STATUS_BRANCH"
  echo "Published $message to $STATUS_BRANCH"
}

# The last published status.json on stdout; nothing when there is none yet.
cmd_previous() {
  if [ -n "$(fetch_status_branch)" ]; then
    git show "$STATUS_REF:status.json" 2>/dev/null || true
  fi
}

case "${1:-}" in
  detect) cmd_detect ;;
  merge) cmd_merge ;;
  merged-tag) cmd_merged_tag ;;
  released) cmd_released ;;
  release-line) cmd_release_line ;;
  publish) cmd_publish ;;
  previous) cmd_previous ;;
  *)
    echo "usage: $0 detect|merge|merged-tag|released|release-line|publish|previous" >&2
    exit 2
    ;;
esac
