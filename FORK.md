# Blackfish (saltyfireball/orca)

This repository is upstream [stablyai/orca](https://github.com/stablyai/orca) at its newest
stable `vX.Y.Z` tag, plus a short series of fork commits on top. The app is Blackfish; it was
named Orca Fork until SLRM-1367. `main` is always
`<upstream tag> + fork commits`. Each fork commit message starts with its slrm Jira key
(`SLRM-1309 ` for the original series).

## What the fork changes

- **Run button on chat shell code blocks.** In a chat transcript, fenced blocks tagged `sh`,
  `bash`, `zsh`, `shell` or `console` get a Run button next to Copy.
  - The button flattens the fence to the one-line command that quick commands run.
  - The confirm shows that exact string, and the new terminal tab runs that same string.
  - It runs in the chat's workspace, on the host the chat had when the confirm opened.
  - For `console` fences, only the `$ ` prompt lines are run.
  - Run is hidden for fences that flattening would change, such as heredocs, compound
    commands, or lines that continue onto the next. It is also hidden for fences with control,
    bidi or invisible characters. The policy is in `src/shared/fork/shell-fence.ts`.
  - This works on desktop and in the mobile and iOS session.
- **Its own updates and its own app identity.**
  - The fork lists builds and updates only from `https://github.com/saltyfireball/orca/releases`.
  - The main-process updater rejects any other repository or feed URL. The local build feed
    on `127.0.0.1` is the one exception.
  - The build picker offers only the Stable channel.
  - It installs as "Blackfish" (`Blackfish.app`, `com.saltyfireball.orca`) next to stock Orca,
    with its own settings folder. See Name and data folder below.
  - It is built for Apple Silicon (arm64) only. Upstream's x64 slice has to boot its terminal
    host under Rosetta to pass packaging checks, and no fork Mac needs it.
- **Shared mode: the fork can run on stock Orca's data.** See Shared mode below.

## Patch list

Apply these in this order. Each one is a single commit.

1. `SLRM-1309 fork: update from saltyfireball/orca and install beside stock Orca`
2. `SLRM-1309 desktop: Run button on chat shell code blocks`
3. `SLRM-1309 mobile: Run button on chat shell code blocks`
4. `SLRM-1309 ci: fork sync workflow and FORK.md`
5. `SLRM-1309 run: confirm and run one captured command on the captured host`
6. `SLRM-1309 updater: allow only saltyfireball/orca releases`
7. `SLRM-1309 build: fork version scheme, builder overlay and build wrapper`
8. `SLRM-1309 ci: deploy key, release retry, fork versions and upstream workflows off`
9. `SLRM-1309 updater: drop casts in the feed guard and keep UpdateCard on upstream repos`
10. `SLRM-1309 docs: FORK.md lists the ninth patch and the fourth mocked test`
11. `SLRM-1309 run: reject invisible characters by Unicode property`
12. `SLRM-1309 run: resolve folder workspaces on the captured host`
13. `SLRM-1309 ci: disable upstream workflows before the push and cancel their runs`
14. `SLRM-1309 run: compare the complete host route and pin the launch to the captured host`
15. `SLRM-1309 ci: fail the guard on any cancel error but 409 and note the residual race`
16. `SLRM-1309 build: package the fork for arm64 only`
17. `SLRM-1309 Run drops the agent's leading '! ' prefix`
18. `SLRM-1353 Let the Run confirm edit the command before it runs`
19. `SLRM-1357 Sign fork builds with a stable self-signed identity`
20. `SLRM-1357 Accept the self-signed certificate's root requirement`
21. `SLRM-1351 Shared mode: run Orca Fork on stock Orca's data`
22. `SLRM-1367 Rename the app to Blackfish, keeping the Orca Fork data folder and Keychain item`
23. `SLRM-1370 CLI launcher: run the executable Info.plist names`

Fork-only code lives in `fork/` folders:

- `src/shared/fork/`
- `src/main/fork/`
- `src/main/updater/fork/`
- `src/renderer/src/components/native-chat/fork/`
- `mobile/src/components/fork/`
- `config/scripts/fork/`

Upstream files only get short hooks, which keeps rebases small:

- One line each in `NativeChatCodeBlock.tsx` and `MobileMarkdownCodeBlock.tsx`.
- An optional `executionHostId` on `runQuickCommandInNewTab` and `createTab`, so a Run tab
  opens on the host captured at confirm.
- One provider wrap in `MobileSessionRouteScreen.tsx`.
- The updater feed repoints.
- One call each in `release-channel.ts`, `updater-release-builds.ts` and
  `electron-updater-loader.ts`.
- One `vi.mock` in each of four upstream tests that cover release repos. It swaps in
  `src/shared/fork/testing/fork-release-repo-upstream-policy.ts`, so those tests keep
  covering upstream's channels.
- The run-button strings in both `en.json` catalogs, from the generators.
- One call in `configureDevUserDataPath` (`src/main/startup/configure-process.ts`) for the
  pinned data folder and shared mode. It runs before anything reads userData or takes the
  instance locks.
- The post-ready `app.setName` in `src/main/startup/main-process-ready-foundation.ts` goes
  through `forkPostReadyAppName` (`src/main/fork/app-name.ts`).
- The macOS CLI launcher `resources/darwin/bin/orca` reads `CFBundleExecutable` from
  `Info.plist` instead of assuming `MacOS/Orca`, falling back to `Orca`, so `orca` works in
  Blackfish. `src/main/fork/darwin-cli-launcher.test.ts` covers it.

`config/electron-builder.config.cjs` is upstream's. Commit 1 edited it and commit 7 restores
it, so the series leaves it as upstream has it. The fork identity is in
`config/scripts/fork/electron-builder.fork.config.cjs`.

## Name and data folder

The app is named Blackfish (`productName` in the builder overlay), so it builds `Blackfish.app`
with a `Blackfish` executable, and the window title, menu and About panel say Blackfish. Two
things keep the names from before the rename, so the rename lost no data:

- **Data folder.** Electron would derive `~/Library/Application Support/Blackfish`; the packaged
  app pins userData to `~/Library/Application Support/Orca Fork` before anything reads it. There
  is no migration and no Blackfish folder.
- **Keychain item.** Saved secrets are encrypted with the Keychain item "Orca Fork Safe Storage",
  which Electron names from the pre-ready app name. In own mode the app takes the pre-ready name
  `Orca Fork`, then `Blackfish` after ready, when the Keychain name is already fixed.

The code is `src/main/fork/app-name.ts` and `pinForkDataDir` in `src/main/fork/shared-stock-data.ts`.
Squirrel.Mac updates the bundle in place, so a copy installed as `/Applications/Orca Fork.app`
keeps that folder name until it is renamed to `Blackfish.app` by hand (with the app quit).

## Shared mode

With an empty marker file `~/Library/Application Support/Orca Fork/use-stock-data`, the
packaged fork runs on stock Orca's folder, `~/Library/Application Support/orca`, and its
Keychain key, "orca Safe Storage". Settings, projects, chats and agent sessions are then the
same in both apps, and switching is quit one, open the other. The code is
`src/main/fork/shared-stock-data.ts`.

- Only one of the two can be open at a time. Electron's instance lock and the desktop profile
  lock live in that folder, so the second app to open just hands off to the first.
- The fork takes the pre-ready app name `orca`, which is what picks stock's Keychain item.
  macOS may ask once whether Blackfish can use "orca Safe Storage": choose Always Allow.
- The first launch of each fork version clones (APFS) stock's settings, projects and chats
  into `Orca Fork/stock-data-snapshots/<time>_v<version>` before it opens them, keeping the
  newest 3. Caches, models and logs are left out. The snapshot is skipped while an app holds
  the folder, and a failed snapshot never stops the launch.
- Without the marker, unpackaged, or with no stock folder, the fork uses its own folder.
- Dotfiles' `orca-switch` drives it: `orca-switch fork|stock` quits one app and opens the
  other, `share` and `separate` set and clear the marker, and `restore` puts a snapshot back.
- Stock Orca opening data a newer fork wrote is the one risk; let stock update itself first,
  or restore the snapshot from before that fork version.

## Versions

A fork release is `M.m.(p*1000+N)`. Here `M.m.p` is the upstream base, and N runs from 1 to 999
for each base and starts again at 1 on a new base. For example, upstream `1.4.252` with fork
release 1 is `1.4.252001`, tagged `v1.4.252001`. A fork release on a newer base always sorts
above one on an older base. A base that would need N 1000 fails the build.

`package.json` keeps the upstream version in git. The release job works out the next version
with `config/scripts/fork/fork-version.mjs`, then sets it in its own build copy only. The app
version, `latest-mac.yml` and the tag all match it, and the release is a normal release
(not a prerelease).

## Building locally

`node config/scripts/fork/build-mac-fork.mjs` runs the steps that come before packaging in
upstream's `build:mac`, then electron-builder with the fork overlay. Without `FORK_VERSION` it
makes a local build, `<version>-local.<time>.<sha>`. With `FORK_VERSION` set it needs
`package.json` to hold that version, and builds exactly that version.

## How sync works

`.github/workflows/fork-sync.yml` runs every day at 09:17 UTC. You can also run it by hand
(Actions, Fork sync, Run workflow). Set `force_build` to rebuild and release anyway. It only
runs in `saltyfireball/orca`. Every third-party action is pinned to a full commit SHA.

1. **sync** (ubuntu-latest):
   - Fails at once, with a message, if the `FORK_SYNC_DEPLOY_KEY` secret is empty.
   - Checks out `main` over SSH with that deploy key.
   - Finds the newest stable upstream tag with `git ls-remote --tags` and `sort -V`, and the
     stable tag `main` is on now.
   - If the two tags differ, it rebases the fork commits (`<old tag>..main`) onto the new tag.
   - **If the rebase conflicts**, it aborts and opens an issue titled
     `fork-sync conflict on <tag>` that lists the conflicting files (or comments on the open
     one), and the run fails. To fix it, rebase by hand, resolve, run the checks below, and
     push `main`.
   - **If the rebase succeeds**, it installs and checks the result:
     - root typecheck
     - the fork and updater tests
     - mobile install and typecheck
   - It disables every workflow except fork-sync, then pushes with
     `git push --force-with-lease origin HEAD:main`.
   - After the push it disables any workflow the push added, and cancels any other workflow's
     run of the pushed commit (see below).
   - It checks whether a published fork release already has a tag on the `main` commit.
2. **build-mac** (macos-15) runs in three cases: `main` changed, `main` has no fork release
   yet, or `force_build` is set. The second case retries a failed build without waiting for a
   new upstream tag.
   - Works out the fork version and sets it in the build copy of `package.json`.
   - Imports the fork signing identity (see Signing) and installs arm64 natives only, then runs
     `node config/scripts/fork/build-mac-fork.mjs`.
   - Checks the app's designated requirement is the fork certificate, so Squirrel.Mac accepts it
     as an update.
   - Checks that `latest-mac.yml` and the app both carry the fork version.
   - Publishes the arm64 dmg, the arm64 zip and `latest-mac.yml` as release `v<fork version>`.

### Signing

Squirrel.Mac installs an update only when the new app meets the running app's designated
requirement. An ad-hoc signature's requirement is its own cdhash, which no later build meets, so
the fork signs every build with one self-signed certificate, `Orca Fork Code Signing` (SHA-1
`c5e8485cb550edea627fda93ead7cf1975ed3710`, valid to 2046). Its requirement,
`identifier "com.saltyfireball.orca" and certificate leaf = H"c5e8...3710"`, holds for every build.

- The PKCS#12 and its password live in Infisical folder `/orca_fork`
  (`ORCA_FORK_MAC_CERT_P12_B64`, `ORCA_FORK_MAC_CERT_PASSWORD`, `ORCA_FORK_MAC_CERT_SHA1`) and as
  the Actions secrets `FORK_MAC_CERT_P12_B64` and `FORK_MAC_CERT_PASSWORD`.
- build-mac imports it into a temporary keychain and trusts it for code signing on that runner
  only, because electron-builder signs only with an identity `security find-identity -v` lists.
  `CSC_NAME` picks it for the app and the helpers afterPack signs.
- There is no hardened runtime or notarization; Gatekeeper still treats a downloaded dmg as from
  an unidentified developer.
- Replacing the certificate changes the requirement: installed copies then need one manual
  install, as the move from ad-hoc did.

### Deploy key and tokens

`GITHUB_TOKEN` cannot push commits that change `.github/workflows/`, and upstream changes
those often. So the sync job checks out and pushes over SSH with a write deploy key:

1. Add a deploy key with write access to `saltyfireball/orca`.
2. Store its private key as the Actions secret `FORK_SYNC_DEPLOY_KEY`.

`GITHUB_TOKEN` is still used for the issue, release and workflow API calls. Its permissions
are `contents: write`, `issues: write` and `actions: write`.

### Upstream workflows stay off

None of upstream's workflows run on the fork. They would fail without upstream's secrets and
runners. All of them were disabled by hand once.

An upstream sync can add new workflow files, and GitHub turns new workflows on. A push could
start one of them before it is disabled. So `config/scripts/fork/fork-workflow-guard.sh` runs
three times around the push:

1. Before the push, `disable` turns off every active workflow in `.github/workflows/` except
   `.github/workflows/fork-sync.yml`
   (`gh api -X PUT repos/saltyfireball/orca/actions/workflows/<id>/disable`).
2. After the push, `disable` runs again for the workflows the push added.
3. Then `cancel-runs <sha>` lists the workflow runs of the pushed commit and cancels every
   unfinished one whose workflow is not fork-sync. It looks three times, 10 seconds apart,
   because push-triggered runs take a moment to appear.

A small race remains: a newly added workflow can start, and run briefly, before step 3 cancels it.
Most upstream workflows only run when `github.repository == 'stablyai/orca'`, so they skip on the fork.

Cancelling a run that already finished (HTTP 409) is fine. Any other API error fails the job.
Disabled workflows and finished runs are skipped, so this is safe to run every day. It never
disables fork-sync or cancels its runs. The job needs `actions: write` for it.

### Notes

- A rebase rewrites the fork commits, so CI's copies are unsigned and committed by
  `github-actions[bot]`.
- Builds are self-signed, not notarized. On first launch, macOS Gatekeeper asks you to approve
  the app.
