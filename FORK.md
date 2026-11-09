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
- **Restart guard: quitting, restarting or updating waits for busy chats.** See Restart guard
  below.
- **Groundwork for chats that survive a restart (SLRM-1394).** `src/main/fork/chat-survive/` holds
  a broker that hosts one chat provider outside the app, keeps its output in a ring with byte
  offsets, and lets the next app instance reattach by token and lease fence after a hand-off at
  quit, with an orphan timeout when nobody comes back (a crash still stops the provider). The broker is built as its own plain-Node entry
  (`out/main/chat-survive-broker-entry.js`) that runs upstream's provider supervisor under it.
  With the `forkChatSurvive` setting on (Settings > Advanced, off by default), new Claude chats
  run their provider supervisor under a broker; Codex and every other provider spawn as before.
  At quit (or an update install) such a chat's provider is handed to its broker instead of being
  stopped, and the restart guard does not count it as busy. On macOS the next app start's session
  recovery adopts that broker instead of stopping it and starts the chat over the broker's
  socket, replaying from where the quitting app left off, so the turn carries on; anything it
  cannot prove stops the broker as before. The design and the remaining phases (Codex next) are
  in `docs/fork/chat-survive.md`.
- **Claude account chip (SLRM-1503).** Native chat tabs, terminal tabs running Claude, agent rows
  and sidebar worktree rows show a small dot and short label (`B`, or `B @ kif` on another host)
  naming the Claude account the session runs on; a worktree whose sessions use several shows
  `Mixed`. Hovering shows the email and 5h and weekly usage. Each session resolves against the
  host that runs it: this desktop, a WSL host's distro (through this desktop's saved accounts) or
  a paired remote host (its own accounts, read once over runtime RPC); direct SSH shows nothing.
  Nothing shows when that host has one account or none. Terminal panes are named by their hook
  transcript path; native chats by `fork.claudeAccount.which` (the move RPC below), which each
  host answers with the home it last launched the chat under and the chat's pin, so a moved chat
  shows its new account at once and a move queued behind a turn shows as `A -> B`. Clicking a
  chip opens the move menu on the chip's own host: a native chat tab or agent row moves that
  chat, a worktree row its chats; terminal-pane chips, WSL distro chats, direct SSH and hosts
  without the fork RPC have no menu. Settings > Advanced turns it off (`forkShowAccountChip`, on
  by default). Code is in `src/renderer/src/fork/claude-account-chip/`.
- **Move Claude chats to another account (SLRM-1503).** One native Claude chat, or every
  Claude chat in a worktree, can move to another Claude account of the host that runs it; the
  other chats stay where they are.
  - The host keeps a pin per chat (`src/main/fork/claude-account-move/`). The next launch of that
    chat reads the pin before the selected account, and the stock outgrown-child check stops an
    idle provider so the next message resumes the same conversation on the new account.
  - A chat mid-turn is never stopped: its move is queued until the turn ends. A toast offers
    Move now (stop the turn and move) and Cancel.
  - Entry points: the native chat tab's right-click menu, the command palette ("Move this
    chat to account...", "Move this worktree's chats to account..."), and
    `ForkMoveAccountMenu` for the account chip. Each lists only the chat host's accounts, with
    5h and weekly usage.
  - CLI: `orca account which [--session|--worktree]` and
    `orca account move <account> (--session|--worktree) [--now]`, over runtime RPC
    (`fork.claudeAccount.which`, `.move`, `.cancel`), so they work on paired hosts too.
  - A worktree move on this desktop also restarts its Claude terminal panes on that account
    through the stock account-restart queue, each once it is idle.

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
24. `SLRM-1338 Sign the commits fork-sync rebases`
25. `SLRM-1337 Use the fork's own bundle ids for its helpers and macOS checks`
26. `SLRM-1393 Warn before a quit, restart or update kills busy chats`
27. `SLRM-1393 A held restart shows a neutral toast, not an error`
28. `SLRM-1393 Fail open, bring the dialog forward and quit normally after a wait`
29. `SLRM-1394 Chat survive: design and the provider broker transport`
30. `SLRM-1394 Chat survive: the broker process around the provider supervisor`
31. `SLRM-1394 Chat survive: the spawn hook for Claude, behind a setting that ships off`
32. `SLRM-1393 Drop the type casts the code-quality gate flags in the restart guard`
33. `SLRM-1394 Chat survive: hand a Claude chat to its broker at quit`
34. `SLRM-1394 Chat survive: adopt a surviving broker at start so the chat carries on`
35. `SLRM-1394 Chat survive: run it against the real Claude Code and ask a resent prompt once`
36. `SLRM-1394 Chat survive: replay from the last consumed message, stop late claims`
37. `SLRM-1394 Chat survive: stop a provider lost without a hand-off, and the review nits`
38. `SLRM-1394 Chat survive: adopt a provider only into the launch that started it`
39. `SLRM-1394 Put the pinned bun on PATH for tests run outside pnpm`
40. `SLRM-1503 Account chip: name the Claude account of each tab, agent and worktree`
41. `SLRM-1503 Move a Claude chat to another account: pins, launch hooks and host RPC`
42. `SLRM-1503 orca account which / move: the move from the CLI on any paired host`
43. `SLRM-1503 Exhaustive move result switch and a typed fake session summary`
44. `SLRM-1503 Move a chat or a worktree's chats to another account from the tab menu and palette`
45. `SLRM-1503 FORK.md: the account move`
46. `SLRM-1503 Account chip opens the move menu and reads chats through fork.claudeAccount.which`
47. `SLRM-1758 Ship the orcad template in fork builds so SSH hosts get the fork's server`
48. `SLRM-1758 Stamp the fork version into the shipped orcad template`
48. `SLRM-1569 The update card shows the restart guard's wait instead of staying on Installing`

Fork-only code lives in `fork/` folders:

- `src/shared/fork/`
- `src/main/fork/`
- `docs/fork/`
- `src/main/updater/fork/`
- `src/preload/fork/`
- `src/renderer/src/components/native-chat/fork/`
- `src/renderer/src/fork/`
- `src/cli/fork/`
- `mobile/src/components/fork/`
- `config/scripts/fork/`
- `native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/fork/`
- `native/computer-use-macos/Tests/OrcaComputerUseMacOSTests/fork/`

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
- Fork strings live only as inline `t()` defaults. Upstream's `en.json` files carry no fork
  keys: `verify-localization-catalog.mjs` and `config/i18next.config.ts` skip the fork folders
  listed in `config/scripts/fork/fork-localization.mjs`.
- Fork bundle ids (SLRM-1337). `build-mac-fork.mjs` builds the computer-use helper as
  `com.saltyfireball.orca.computer-use` and passes `--bundle-id com.saltyfireball.orca` to the
  notification-status helper. One hook in `TrustedOrcaApplication.swift` makes that helper
  trust the fork app. At runtime `src/main/fork/fork-app-identity.ts` reads the app's own
  bundle id, used by one call each in `macos-tcc-prompt-watch.ts`,
  `macos-press-and-hold-default.ts`, `notification-system-settings-link.ts`,
  `shipit-leftover-recovery.ts` (so the fork never clears stock's ShipIt cache) and
  `macos-daemon-launchd.ts`. Left shared on purpose: the `orca://` scheme (macOS picks one
  app), the serve launchd label prefix and the daemon job label (keyed by data folder, so
  shared mode shares the daemon).
- One call in `configureDevUserDataPath` (`src/main/startup/configure-process.ts`) for the
  pinned data folder and shared mode. It runs before anything reads userData or takes the
  instance locks.
- The post-ready `app.setName` in `src/main/startup/main-process-ready-foundation.ts` goes
  through `forkPostReadyAppName` (`src/main/fork/app-name.ts`).
- The macOS CLI launcher `resources/darwin/bin/orca` reads `CFBundleExecutable` from
  `Info.plist` instead of assuming `MacOS/Orca`, falling back to `Orca`, so `orca` works in
  Blackfish. `src/main/fork/darwin-cli-launcher.test.ts` covers it.
- The restart guard (SLRM-1393): `installForkRestartGuard()` after
  `installMainProcessQuitHandlers()` in `src/main/index.ts`; `guardForkRestart` wraps the
  `app:relaunch` and `app:restart` handlers in `src/main/ipc/app.ts`; `guardForkUpdateInstall`
  wraps `updater:quitAndInstall` in `src/main/window/main-window-updater.ts`;
  `...forkRestartGuardMenuItems()` follows `checkForUpdatesItem` in
  `src/main/menu/register-app-menu.ts`; and one `notifyForkRestartGuardUpdaterStatus()` call
  after the status send in `src/main/updater/lifecycle/updater-status.ts` refreshes the menu row.
  `app:relaunch` passes a third, deferred callback (cleanup, `relaunchApp`, `quitProcess`) for a
  relaunch that runs after a wait. These come from the import-light
  `src/main/fork/restart-guard/restart-guard-hooks.ts`, which passes through until the guard
  installs, so upstream tests of those files are unchanged. A held restart resolves
  `ForkRestartHeld` (`src/shared/fork/restart-guard-held.ts`), not an error: `app-bridge.ts`
  passes it as `willRestart`'s refusal so the renderer drops its restart state, `app-api.ts`
  widens the two return types, and one `handleForkRestartHeld` call
  (`src/renderer/src/fork/restart-guard-held-toast.ts`) in each of `SidebarSettingsHelpMenu.tsx`,
  `AdvancedPane.tsx`, `WindowMaterialSetting.tsx` and `UpdateCard.tsx` clears its spinner and
  shows a neutral toast instead of "Couldn't restart Orca."
- The update card's wait view (SLRM-1569): `src/preload/index.ts` adds
  `forkUpdateInstallWait` (`src/preload/fork/update-install-wait-bridge.ts`) and `api-types.ts`
  types it as optional (one import and one line each), so the web preload needs nothing.
  `UpdateCard.tsx` calls `useForkUpdateInstallWait` (which resets `hasStartedDownload` when the
  guard drops the install) and renders `forkUpdateWaitingCard(...) ??` before its stock
  content (`src/renderer/src/fork/update-install-wait/`).
- The chat-survive broker entry (SLRM-1394): one entry in `main-build-entry-points.ts`, and in
  `plain-node-entry-guard.ts` it shares the `daemon-entry` line (a two-name `map`, so the file
  stays under max-lines). The builder overlay adds it to `asarUnpack`.
- Chat survive spawn hook (SLRM-1394): `createClaudeCodeProcessSpawn` passes its `spawnImpl`
  through `forkChatSurviveSpawner` (`src/main/fork/chat-survive/chat-survive-spawn.ts`);
  `main-process-ready-foundation.ts` installs the setting reader in one line;
  `forkChatSurvive` is in `src/shared/fork/fork-global-settings.ts`; `AdvancedPane.tsx` renders
  `src/renderer/src/fork/ForkChatSurviveSetting.tsx`.
- Chat survive quit hook (SLRM-1394): `createClaudeCodeProcessSpawn` wraps the managed process in
  `forkChatSurviveManaged` (one line), and `evictOwnedStructuredAgentSessions` calls
  `forkChatSurviveQuit` before the stop and skips the stop when it returns true
  (`src/main/fork/chat-survive/chat-survive-detach.ts`).
- Chat survive adopt hooks (SLRM-1394): `resolveStructuredSessionRecovery` asks
  `forkChatSurviveAdopt` before it stops a proven-alive local owner and skips the stop when it
  returns true; `StructuredAgentSessionHost`'s tab recovery callback goes through
  `forkChatSurviveRecover`, which starts each adopted chat
  (`src/main/fork/chat-survive/chat-survive-adopt.ts`).
- Chat survive consumed hook (SLRM-1394): `openClaudeStreamJsonConnection` calls
  `forkChatSurviveConsumed` after each `onMessage`, so the replay mark moves past messages the
  chat consumed (`src/main/fork/chat-survive/chat-survive-registry.ts`).
- Test runner PATH (SLRM-1394): `run-vitest.mjs` puts `node_modules/.bin` first on the Vitest
  PATH when it runs the pinned Bun. Under Bun the Claude SDK runs a script CLI with `bun`, and the
  pinned binary is `bun.exe`, so without the shim `claude-stop-ack-race.test.ts` and
  `structured-claude-thinking-display-refusal.test.ts` failed with `spawn bun ENOENT` when the
  runner ran outside `pnpm run`.
- Fork settings (SLRM-1503): `global-settings-types.ts` builds `GlobalSettings` on
  `WithForkSettings<GlobalSettingsBase>` (`src/shared/fork/fork-global-settings.ts`, one import
  and one changed line), which adds `forkChatSurvive` and `forkShowAccountChip`; the file is at
  max-lines.
- Account chip hooks (SLRM-1503): `SortableTab.tsx` renders its title through `ForkTabTitle`
  (the stock title span plus the chip, one line, swapping the `TAB_LABEL_WIDTH_CLASSES` import
  so the file stays at max-lines); `DashboardAgentRow.tsx` renders
  `ForkClaudeAccountAgentRowChip` after the agent icon for non-subagent rows (worktree card
  inline rows use it too; the compact row does not); the template `Title` part in
  `card-identity-parts.tsx` adds `ForkClaudeAccountWorktreeChip` after the title;
  `AdvancedPane.tsx` renders `ForkAccountChipSetting`. The chip reads chats through the move
  RPC, so it adds no RPC hook of its own.
- Account move (SLRM-1503), from `src/main/fork/claude-account-move/` and
  `src/renderer/src/fork/claude-account-move/`:
  - `prepareClaudeLaunchAccount` (`claude-launch-account.ts`) takes an optional `sessionId` and
    returns `forkPinnedClaudeLaunch` first when the chat has a pin;
    `claude-structured-launch-resolution.ts` passes the record's `sessionId`.
  - `structured-session-account-home.ts` returns `forkPinnedClaudeAccountHome` first, so the
    outgrown-child check sees a moved chat as outgrown.
  - Both `spawn-preflight.ts` files (`ipc/` and `runtime/`) call
    `forkPinTerminalClaudeAccount`, which turns the `ORCA_FORK_CLAUDE_ACCOUNT` marker of a moved
    pane into that pane's own account pointer.
  - `rpc-method-registry.ts` spreads `FORK_CLAUDE_ACCOUNT_MOVE_METHODS` last, and the generated
    `rpc-params-catalog.generated.ts` lists their params.
  - `src/cli/specs/index.ts` spreads `FORK_ACCOUNT_MOVE_COMMAND_SPECS` last, and
    `handler-group-manifest.ts` adds the `fork-account-move` group last.
  - `buildPaneAccountRestartStartup` (`agent-account-restart-startup.ts`) passes its result
    through `withForkClaudePaneAccount`, which adds the marker for a moved pane once.
  - `SortableTabContextMenu.tsx` renders `ForkMoveAccountTabMenuItems` for a native Claude chat,
    `quick-actions.ts` spreads `getForkClaudeMoveQuickActions()`, and `AppRootSurfaces.tsx`
    mounts `ForkMoveAccountDialogHost`.

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

## Restart guard

Quitting the app stops every native chat's claude or codex process, so a running turn, its
subagents and its background commands are lost. The guard holds a quit (Cmd-Q, the menu, the
dock), a restart from the renderer (`app:relaunch`, `app:restart`) and an update install while
any chat is busy, and asks first. The code is `src/main/fork/restart-guard/`.

- **Busy** means this app owns the chat's provider process (`hostExecutionOwned`) and the chat is
  working on a turn, waiting on a question, or has a live subagent or background command (a
  background task with no state does not count). Idle chats never hold anything, and neither
  does a Claude chat whose provider will be handed to its chat-survive broker at quit
  (`forkChatSurvive`, SLRM-1394). The dialog lists up to eight busy chats with their workspace
  and what each is running. A chat waiting on an answer is listed as "waiting for you" but does
  not hold a "when idle" wait.
- **Dialog:** the main window is revealed (as Quit Completely does) and, on macOS, the app takes
  focus before the dialog shows. Quitting again while it is open brings it forward again.
- **Restart When Idle** (the default) waits, checking every 2 s, and goes ahead on its own once
  no chat is busy. A chat that starts working during the wait joins the list and is waited for
  too. The dock icon shows a progress bar and the app menu shows "Restart when idle: N of M
  chats finished"; clicking it, or quitting again, offers Keep Waiting, Restart Now or Stop
  Waiting. Now carries out the latest request, so Cmd-Q then Now during a restart wait quits.
  **Restart Now** goes at once. **Cancel** does nothing. A held restart from the renderer shows "Restart will run once your
  chats are idle." (nothing on Cancel), not an error.
- **Update card (SLRM-1569):** while an update install waits, the update card next to the chat
  composer shows "Waiting for N chats" (the chats still busy), "D of M chats finished", and
  Restart Now and Stop Waiting, the waiting dialog's choices without the dialog (ignored while a
  guard dialog is open, which comes forward instead). It counts down as chats finish. Cancel in
  the first dialog, or Stop Waiting from the card, the dialog or the menu row, puts the card
  back to "Ready to Install" with its Restart to Update button; a wait that finishes, or Restart
  Now, installs and the card shows "Installing..." as before. Main pushes the wait over
  `fork:updateInstallWait:*` (`src/main/fork/restart-guard/update-install-wait.ts`, from the
  guard's `onProgress` and `onWaitEnded`); a restart or quit wait never shows on the card.
- **Update Ready - Restart When Idle** appears in the app menu once an update is downloaded. It
  skips the first dialog and installs as soon as no chat is busy (at once if none is). It is
  hidden while the install runs, and refreshes on every updater status.
- **Never held:** macOS logout and shutdown (`powerMonitor` `shutdown`; Windows
  `query-session-end`, `session-end`), a quit another listener already vetoed, serve mode, and quits another
  owner committed (signals and the supervisor through `quitProcess`, an update already
  installing, teardown already started). A Now or a finished wait approves the quit it starts
  for 2 minutes. The shutdown flag clears after 60 s or on `powerMonitor` `resume`, so a
  cancelled logout does not turn the guard off for the session.
- **Fails open:** an error reading chats, showing the dialog or in the before-quit listener is
  logged ("[restart-guard] failing open") and the quit, restart or install goes ahead.
- **Not covered:** relaunches the main process starts itself (profile switch and transfer, GPU
  fallback, WSL drive conversion, Windows run-as-administrator) and serve mode's remote update
  install. A restart or install that runs after a wait takes the normal quit path, so the main
  process's cleanup and the will-quit flush run, but it skips the renderer's own restart
  preparation (as a plain Cmd-Q does). Startup recovery screens do not wait for the relaunch
  result, so a held relaunch there shows no toast.

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

`package.json` keeps the upstream version in git. The sync job works out the next version
with `config/scripts/fork/fork-version.mjs`, and the template and app jobs set it in their own
build copies only. The app version, the orcad template's `out/package.json`, `latest-mac.yml`
and the tag all match it, and the release is a normal release
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
   - If the two tags differ, it rebases the fork commits (`<old tag>..main`) onto the new tag,
     SSH-signed when `FORK_GIT_SIGNING_KEY` is set (see Signed rebase commits).
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
   - It works out the fork version once (see Versions), for both the app and its orcad template.
2. **orcad-template** runs in the same three cases as build-mac (below). It calls upstream's
   `node-server-tests.yml` at the commit sync recorded, with `build_template: true` and
   `fast_runners: false`, as upstream's daily build does: it builds and tests orcad on every
   platform lane (hosted Linux, macOS, Windows, glibc 2.28 and 2.17, musl) and keeps each
   lane's slot as an artifact of the run. This reusable workflow is upstream's, so its actions
   are pinned by tag, not SHA. Being disabled does not stop a workflow being called this way,
   and its jobs run inside the fork-sync run, so the guard never cancels them.
   - Without the template the app ships no server: Settings, SSH hosts says the build "has no
     server for this host" and never updates a host's orcad (SLRM-1758).
3. **orcad-template-fork** (ubuntu-latest) assembles the template again from those lane slots,
   with the steps of upstream's `desktop_template` job, after stamping the fork version into
   its copy of `package.json`. `build-orcad.mjs` writes that version into the template's
   `out/package.json`, which the host's orcad reports as its app version. Upstream's own
   template carries the upstream version (1.4.253 under a 1.4.253NNN app), so Settings,
   Remote Orca Servers would call every host out of date. The job fails unless the template
   has the fork version, and uploads it as `orcad-template-fork`.
4. **build-mac** (macos-15) runs in three cases: `main` changed, `main` has no fork release
   yet, or `force_build` is set. The second case retries a failed build without waiting for a
   new upstream tag. It waits for orcad-template-fork and runs only when that succeeded.
   - Sets the fork version from sync in the build copy of `package.json`.
   - Imports the fork signing identity (see Signing) and installs arm64 natives only.
   - Downloads `orcad-template-fork` to `out/orcad-template`, then runs
     `node config/scripts/fork/build-mac-fork.mjs` with `ORCA_REQUIRE_ORCAD_TEMPLATE=1`, so the
     build fails if the template is missing. electron-builder ships it as
     `Contents/Resources/orcad-template`, and afterPack signs its Mach-O files with the fork
     identity. A step then checks the app has the template, its darwin-arm64,
     linux-x64-glibc and linux-arm64-glibc targets, and the fork version in its
     `out/package.json`.
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

### Signed rebase commits

A rebase re-commits every fork commit, so the old signatures are lost. When the Actions secret
`FORK_GIT_SIGNING_KEY` holds an ed25519 SSH private key, the sync job signs the new commits:

- Before the rebase it writes the key to `$RUNNER_TEMP/git-signing/key` (mode 600), sets
  `gpg.format ssh`, `user.signingkey` and `commit.gpgsign true`, and commits as the author of
  the newest fork commit (the fork owner), so the rebased commits stay his on both lines.
- After the rebase every commit in `<new tag>..HEAD` must show `%G?` = `G` against an
  allowed-signers file built from the key's public half, or the job fails before the push.
- An `always()` step deletes the key and unsets the signing config straight after the rebase,
  before `pnpm install` runs any package script.
- Committer dates are the rebase time (no `--committer-date-is-author-date`), so the dates
  say when the signed copy was made; author dates keep the original.
- Add the public key to the owner's GitHub account as a signing key, so GitHub shows the
  commits as Verified. Keep the private key in Infisical folder `/orca_fork`.
- With the secret empty the job prints a notice and commits unsigned as `github-actions[bot]`,
  as before.

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

- A rebase rewrites the fork commits. CI signs its copies only when `FORK_GIT_SIGNING_KEY` is
  set (see Signed rebase commits); otherwise they are unsigned and committed by
  `github-actions[bot]`.
- Builds are self-signed, not notarized. On first launch, macOS Gatekeeper asks you to approve
  the app.
