#!/usr/bin/env bash
# Keeps upstream workflows from running on the fork. Only fork-sync may run here.
#   fork-workflow-guard.sh disable          disable every active workflow except fork-sync
#   fork-workflow-guard.sh cancel-runs SHA  cancel unfinished runs of SHA from any other workflow
# Needs GH_TOKEN with actions: write.
set -euo pipefail

REPO="saltyfireball/orca"
KEEP=".github/workflows/fork-sync.yml"

disable_workflows() {
  local ids
  ids="$(gh api --paginate "repos/$REPO/actions/workflows" \
    --jq ".workflows[] | select(.path != \"$KEEP\") | select(.path | startswith(\".github/workflows/\")) | select(.state == \"active\") | .id")"
  for id in $ids; do
    echo "Disabling workflow $id"
    gh api -X PUT "repos/$REPO/actions/workflows/$id/disable"
  done
  echo "Disabled $(printf '%s\n' "$ids" | grep -c . || true) workflow(s)"
}

cancel_runs() {
  local sha="$1" pass ids
  # Push-triggered runs can take a few seconds to show up, so look more than once.
  for pass in 1 2 3; do
    ids="$(gh api --paginate "repos/$REPO/actions/runs?head_sha=$sha&per_page=100" \
      --jq ".workflow_runs[] | select(.path != \"$KEEP\") | select(.status != \"completed\") | .id")"
    for id in $ids; do
      echo "Cancelling run $id"
      # A run that finished in the meantime answers 409; that is not a failure here.
      gh api -X POST "repos/$REPO/actions/runs/$id/cancel" || echo "Run $id was not cancellable"
    done
    if [ "$pass" != 3 ]; then
      sleep 10
    fi
  done
}

case "${1:-}" in
  disable) disable_workflows ;;
  cancel-runs)
    if [ -z "${2:-}" ]; then
      echo "::error::cancel-runs needs a commit SHA"
      exit 1
    fi
    cancel_runs "$2"
    ;;
  *)
    echo "usage: $0 disable | cancel-runs SHA" >&2
    exit 2
    ;;
esac
