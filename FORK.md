# Orca Fork (saltyfireball/orca)

This repository is upstream [stablyai/orca](https://github.com/stablyai/orca) at its newest
stable `vX.Y.Z` tag, plus a short series of fork commits on top. `main` is always
`<upstream tag> + fork commits`. Each fork commit message starts with `SLRM-1309 `.

## What the fork changes

- **Run button on chat shell code blocks.** In a chat transcript, fenced blocks tagged `sh`,
  `bash`, `zsh`, `shell` or `console` get a Run button next to Copy. It asks for confirmation
  and shows the exact command first, then opens a new terminal tab in the chat's workspace and
  runs the command there. For `console` fences, only the `$ ` prompt lines are run.
  This works on desktop and in the mobile and iOS session.
- **Its own updates and its own app identity.** The fork updates from
  `https://github.com/saltyfireball/orca/releases`, never from upstream. It installs as
  "Orca Fork" (`com.saltyfireball.orca`) next to stock Orca, with its own settings folder.

## Patch list

Apply these in this order. Each one is a single commit.

1. `SLRM-1309 fork: update from saltyfireball/orca and install beside stock Orca`
   - Repoints the updater feed and the publish target, and sets the app id and product name.
   - Fork code: `src/shared/fork/fork-release-repo.ts`.
2. `SLRM-1309 desktop: Run button on chat shell code blocks`
   - Fork code: `src/shared/fork/shell-fence.ts` and
     `src/renderer/src/components/native-chat/fork/NativeChatRunButton.tsx`.
   - Upstream hook: one line in `NativeChatCodeBlock.tsx`.
3. `SLRM-1309 mobile: Run button on chat shell code blocks`
   - Fork code: `mobile/src/components/fork/`.
   - Upstream hooks: one line in `MobileMarkdownCodeBlock.tsx`, and one provider wrap in
     `MobileSessionRouteScreen.tsx`.
4. `SLRM-1309 ci: fork sync workflow and FORK.md`
   - `.github/workflows/fork-sync.yml` and this file.

Fork-only code lives in `fork/` folders. Upstream files only get short hooks, which keeps
rebases small.

## How sync works

`.github/workflows/fork-sync.yml` runs every day at 09:17 UTC. You can also run it by hand
(Actions, Fork sync, Run workflow). Set `force_build` to rebuild without an upstream change.
It only runs in `saltyfireball/orca`.

1. **sync** (ubuntu-latest):
   - Finds the newest stable upstream tag with `git ls-remote --tags` and `sort -V`.
   - Finds the stable tag `main` is on now.
   - If the two tags differ, it rebases the fork commits (`<old tag>..main`) onto the new tag.
   - **If the rebase conflicts**, it aborts and opens an issue titled
     `fork-sync conflict on <tag>` that lists the conflicting files (or comments on the open
     one), and the run fails. To fix it, rebase by hand, resolve, run the checks below, and
     push `main`.
   - **If the rebase succeeds**, it installs and checks the result:
     - root typecheck
     - the fork and updater tests
     - mobile install and typecheck
   - Then it pushes with `git push --force-with-lease origin HEAD:main`.
2. **build-mac** (macos-15) runs after a successful sync that changed `main`, or when
   `force_build` is set:
   - Builds an unsigned `pnpm run build:mac`.
   - Publishes the dmg, the zip and `latest-mac.yml` as release
     `<upstream tag>-fork.<run number>`.

### Token

`GITHUB_TOKEN` cannot push commits that change `.github/workflows/`, and upstream changes
those often. Add a repository secret `FORK_SYNC_TOKEN` holding a fine-grained token with
Contents and Workflows write on this repo. The workflow uses it when it is set, and falls back
to `GITHUB_TOKEN` otherwise.

### Notes

- A rebase rewrites the fork commits, so CI's copies are unsigned and committed by
  `github-actions[bot]`.
- Builds are not signed or notarized. On first launch, macOS Gatekeeper asks you to approve
  the app.

## Upstream scheduled workflows to disable

Upstream's cron workflows would run here too and fail without upstream's secrets and runners.
Disable them once (this has not been run):

```sh
for wf in \
  ci-branch-cache-sweep.yml \
  ci-cache-warmup.yml \
  ci-runner-demand.yml \
  ci-xterm-cache.yml \
  computer-e2e.yml \
  computer-macos-native.yml \
  daily-mac-build.yml \
  e2e.yml \
  hourly-mac-build.yml \
  node-next-compat.yml \
  node-server-tests.yml \
  packaged-browser-e2e.yml \
  performance-contracts.yml \
  readme-downloads-badge.yml \
  terminal-ime-e2e.yml \
  wsl-orcad-e2e.yml; do
  gh workflow disable "$wf" -R saltyfireball/orca
done
```

`daily-mac-build.yml`, `hourly-mac-build.yml` and `readme-downloads-badge.yml` already check
for `stablyai/orca`, so disabling them only removes skipped runs from the list.
