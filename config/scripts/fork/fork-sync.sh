#!/usr/bin/env bash
# The fork-sync workflow's git logic (FORK.md "How sync works"), kept out of the YAML so
# fork-sync.test.mjs can run it against throwaway repos.
#
#   fork-sync.sh detect    newest stable upstream tag, and the upstream commit main sits on
#   fork-sync.sh rebase    replay the fork commits onto that tag; main is untouched on conflict
#   fork-sync.sh publish   commit status.json (and the base record) to the status branch
#
# Values come from the environment, never from one owner's names:
#   FORK_SYNC_UPSTREAM_REMOTE  remote holding upstream (default upstream)
#   FORK_SYNC_UPSTREAM_BRANCH  upstream branch for the base fallback (default: its HEAD)
#   FORK_SYNC_ORIGIN_REMOTE    the fork's own remote (default origin)
#   FORK_SYNC_STATUS_BRANCH    branch holding status.json and the base record (default fork-sync-status)
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

upstream_default_branch() {
  if [ -n "${FORK_SYNC_UPSTREAM_BRANCH:-}" ]; then
    printf '%s\n' "$FORK_SYNC_UPSTREAM_BRANCH"
    return
  fi
  git ls-remote --symref "$UPSTREAM_REMOTE" HEAD | sed -n 's#^ref: refs/heads/\(.*\)[[:space:]]HEAD$#\1#p'
}

# Of two ancestors of main, the one nearer to main; the first when neither contains the other.
newer_of() {
  if [ -z "$2" ] || { [ -n "$1" ] && is_ancestor "$2" "$1"; }; then
    printf '%s\n' "$1"
  else
    printf '%s\n' "$2"
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

cmd_detect() {
  local latest latest_sha branch record recorded mb_branch='' mb_tag tag_base merge_base fallback base source
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
  branch="$(upstream_default_branch)"
  if [ -n "$branch" ] && git fetch --no-tags --quiet --filter=blob:none "$UPSTREAM_REMOTE" \
    "+refs/heads/$branch:refs/upstream-branch/$branch"; then
    mb_branch="$(git merge-base HEAD "refs/upstream-branch/$branch" || true)"
  fi
  mb_tag="$(git merge-base HEAD "$latest_sha" || true)"
  tag_base="$(newest_tag_under_main)"

  # Base detection. The fork line is <upstream commit> + fork commits, and the rebase must replay
  # exactly the fork commits, so it needs that upstream commit's SHA.
  # - A tag name is not enough: upstream has re-cut a tag to another commit, and `rebase --onto
  #   <new> <tag>` then replayed upstream's own commits as if they were the fork's.
  # - So each successful sync records the SHA it rebased onto, in the file `base` on the status
  #   branch. It is used when it is still an ancestor of main.
  # - Without a record (first run, or a branch someone deleted) the base is the fallback: the
  #   nearest to main of three upstream commits under it. Two are merge-bases of main, with the
  #   upstream branch and with the newest tag. The third is the newest stable tag under main.
  #   It is needed because upstream tags release commits that are not on its branch: a fork
  #   sitting on such a tag has both merge-bases below it, and a rebase from there would replay
  #   upstream's release commit as a fork commit.
  # - A record older than the fallback is stale (main moved on by hand, or the run that pushed
  #   main died before it recorded), so the fallback wins. A moved tag never makes the fallback
  #   newer than the record: the dropped commit is not on upstream, so both merge-bases fall
  #   below it, and the tag at its new commit is not under main.
  record="$(fetch_status_branch)"
  recorded=''
  if [ -n "$record" ]; then
    recorded="$(git show "$STATUS_REF:base" 2>/dev/null | tr -d '[:space:]' || true)"
    if [ -n "$recorded" ] && ! { git cat-file -e "$recorded^{commit}" 2>/dev/null && is_ancestor "$recorded" HEAD; }; then
      echo "::warning::Recorded base $recorded is not under main; using the fallback instead"
      recorded=''
    fi
  fi
  merge_base="$(newer_of "$mb_branch" "$mb_tag")"
  fallback="$(newer_of "$merge_base" "$tag_base")"
  local fallback_source='merge-base'
  if [ -n "$fallback" ] && [ "$fallback" != "$merge_base" ]; then
    fallback_source='newest tag under main'
  fi
  if [ -n "$recorded" ]; then
    base="$recorded"
    source='record'
    if [ -n "$fallback" ] && [ "$fallback" != "$recorded" ] && is_ancestor "$recorded" "$fallback"; then
      base="$fallback"
      source="$fallback_source (record was stale)"
    fi
  else
    base="$fallback"
    source="$fallback_source"
  fi
  if [ -z "$base" ]; then
    echo "::error::main shares no history with upstream"
    output detect_error 'main shares no history with upstream.'
    return 1
  fi

  local state='behind'
  if [ "$base" = "$latest_sha" ]; then
    state='in-sync'
  elif is_ancestor "$latest_sha" "$base"; then
    # The newest tag sits below the fork base (re-cut to an older commit). Rebasing would drop
    # upstream commits the fork already ships, so this waits for a person.
    state='error'
    output detect_error "Upstream $latest now points at a commit older than the fork base; not rebasing backwards."
  fi
  output latest "$latest"
  output latest_sha "$latest_sha"
  output base_sha "$base"
  output base_source "$source"
  output base_version "$(version_at "$base")"
  output upstream_branch "$branch"
  output state "$state"
  echo "main sits on $base ($source), newest upstream is $latest at $latest_sha: $state"
  [ "$state" != 'error' ]
}

# Env: BASE_SHA, LATEST_SHA, SIGNING ('true' to require good signatures), CONFLICTS_FILE.
cmd_rebase() {
  : "${BASE_SHA:?}" "${LATEST_SHA:?}"
  local conflicts_file="${CONFLICTS_FILE:-/dev/null}" conflicts unsigned
  echo "Fork commits:"
  git log --oneline "$BASE_SHA..main"
  # `rebase --onto X Y main` moves the local main only when it finishes; the abort puts it back,
  # and the remote main is pushed by a later step that a failure skips.
  if ! git rebase --onto "$LATEST_SHA" "$BASE_SHA" main; then
    conflicts="$(git diff --name-only --diff-filter=U || true)"
    git rebase --abort 2>/dev/null || true
    if [ -z "$conflicts" ]; then
      echo "::error::Rebase onto $LATEST_SHA failed before any conflict"
      output rebase_error 'true'
      return 1
    fi
    printf '%s\n' "$conflicts" >"$conflicts_file"
    output conflict 'true'
    # A random delimiter, so no file name can end the multi-line output early.
    local eof="FORK_SYNC_EOF_${RANDOM}${RANDOM}${RANDOM}"
    { echo "conflicts<<$eof"; printf '%s\n' "$conflicts"; echo "$eof"; } >>"$OUT"
    echo "::error::Rebase onto $LATEST_SHA stopped on conflicts in: ${conflicts//$'\n'/, }"
    return 1
  fi
  if [ "${SIGNING:-}" = 'true' ]; then
    unsigned="$(git log --format='%G? %h %s' "$LATEST_SHA..HEAD" | grep -v '^G ' || true)"
    if [ -n "$unsigned" ]; then
      printf '%s\n' "$unsigned"
      echo "::error::Rebased commits without a good signature from FORK_GIT_SIGNING_KEY"
      output unsigned 'true'
      return 1
    fi
    echo "Every rebased commit is signed."
  fi
  output changed 'true'
}

# Env: STATUS_FILE (the JSON to publish), BASE_RECORD (a SHA to record, or empty to keep the
# old record). Builds one commit on the status branch with plumbing, so the job's checkout and
# index are untouched, and pushes it without force: the workflow's concurrency group runs one
# sync at a time, so the fetched tip is the tip.
cmd_publish() {
  : "${STATUS_FILE:?}"
  local parent tree_entries=() blob commit message
  parent="$(fetch_status_branch)"
  if [ -n "$parent" ] && git cat-file -e "$STATUS_REF:base" 2>/dev/null; then
    tree_entries+=("100644 blob $(git rev-parse "$STATUS_REF:base")	base")
  fi
  if [ -n "${BASE_RECORD:-}" ]; then
    # Checked by shape only: the status job's shallow checkout does not hold upstream's commits.
    if ! printf '%s' "$BASE_RECORD" | grep -Eq '^[0-9a-f]{40}([0-9a-f]{24})?$'; then
      echo "::error::BASE_RECORD is not a commit SHA: $BASE_RECORD"
      return 1
    fi
    blob="$(printf '%s\n' "$BASE_RECORD" | git hash-object -w --stdin)"
    tree_entries=("100644 blob $blob	base")
  fi
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
  echo "Published $message to $STATUS_BRANCH${BASE_RECORD:+ (base $BASE_RECORD)}"
}

# The last published status.json on stdout; nothing when there is none yet.
cmd_previous() {
  if [ -n "$(fetch_status_branch)" ]; then
    git show "$STATUS_REF:status.json" 2>/dev/null || true
  fi
}

case "${1:-}" in
  detect) cmd_detect ;;
  rebase) cmd_rebase ;;
  publish) cmd_publish ;;
  previous) cmd_previous ;;
  *)
    echo "usage: $0 detect|rebase|publish|previous" >&2
    exit 2
    ;;
esac
