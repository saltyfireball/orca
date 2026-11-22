# Blackfish (saltyfireball/orca)

This repository is upstream [stablyai/orca](https://github.com/stablyai/orca) plus the fork's
own commits. The app is Blackfish; it was named Orca Fork until SLRM-1367. Each upstream
release tag is merged into `main` as one merge commit (see Merge model below); `main` is never
rebased or force-pushed. Each fork commit message starts with its card key (`BAD-123 `; older
ones `SLRM-123 `).

## Merge model

- **`main` takes in upstream by merging.** When a newer stable upstream tag `vX.Y.Z` exists,
  the Fork sync workflow runs `git merge --no-ff <tag>` on `main`: one merge commit named
  `Merge upstream vX.Y.Z into main`, SSH-signed (see Signed merge commits). Fork commits keep
  their SHAs and signatures. `main` is never rebased and never force-pushed, by the workflow or
  by hand, so a push to `main` is always a fast-forward.
- **The merged base.** The newest stable upstream tag whose commit is under `main` (found by
  ancestry, no record kept) is the fork's upstream base. Its version is the `p` of the fork
  version (see Versions). If upstream moves a tag after `main` merged it, the moved tag is
  merged again as a new tag (the base then comes from `package.json`'s version).
- **The version line.** Upstream releases each tag on its own commit beside its branch, and that
  commit changes `package.json`'s `version`, so two consecutive tags always conflict on that one
  line. The sync settles it by taking the new tag's version when nothing else in `package.json`
  differs. Any other difference is a real conflict.
- **Landing a change.** Work on a branch from `origin/main`, fast-forward `main` to it:
  `git push origin <sha>:refs/heads/main`. If `main` moved, cherry-pick onto a new branch from
  the new `main`. Never rebase or force-push `main` or a pushed branch.
- **A conflicted merge.** The workflow stops before building, pushes nothing, and prints
  `FORK-SYNC-CONFLICT <tag>` as the first line of the merge step and of the run summary,
  which lists the conflicting files. To resolve it by hand:
  1. `git fetch origin` and fetch the tag from upstream.
  2. `git switch -c fork-sync-<tag> origin/main`, then `git merge <tag>`.
  3. Resolve each file: keep upstream's change plus the fork's intent (fork-only files keep
     the fork's content). `git commit`, SSH-signed like any fork commit.
  4. Run the checks the sync job runs (`pnpm typecheck`, the fork tests, mobile typecheck).
     Fix a failing fork test in its own commit on the same branch.
  5. Fast-forward `main` to the branch: `git push origin fork-sync-<tag>:refs/heads/main`. No
     force push. The next sync run builds and releases it.

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
- **Sync status: the update check says when the fork is behind upstream (SLRM-2105).** Settings,
  About shows one line under the update state when the fork-sync workflow's last run left the
  fork behind upstream, hit conflicts or failed, or has not reported for a while. See Sync status
  below.
- **Groundwork for chats that survive a restart (SLRM-1394).** `src/main/fork/chat-survive/` holds
  a broker that hosts one chat provider outside the app, keeps its output in a ring with byte
  offsets, and lets the next app instance reattach by token and lease fence after a hand-off at
  quit, with an orphan timeout when nobody comes back (a crash still stops the provider). The broker is built as its own plain-Node entry
  (`out/main/chat-survive-broker-entry.js`) that runs upstream's provider supervisor under it.
  With the `forkChatSurvive` setting on (Settings > Blackfish, off by default), new Claude chats
  run their provider supervisor under a broker; Codex and every other provider spawn as before.
  Upstream 1.4.262 starts providers through a native launcher (`orca-provider-exec`) and keeps
  the Node supervisor as its fallback: a chat that will run under a broker, or adopt one, asks
  for that fallback, and every other chat stays on the native launcher (SLRM-2316).
  At quit (or an update install) such a chat's provider is handed to its broker instead of being
  stopped, and the restart guard does not count it as busy. On macOS the next app start's session
  recovery adopts that broker instead of stopping it and starts the chat over the broker's
  socket, replaying from where the quitting app left off, so the turn carries on; anything it
  cannot prove stops the broker as before. A broker is adopted only into a start that would
  launch the same provider: the launch is saved as a fingerprint of named parts (each arg flag,
  the cwd, each provider env key, the content of a config file a flag names), the app's own
  version is no part of it, so chats carry over an app update, and a refusal logs which parts
  differ by name (SLRM-2263). An Orca env key (`ORCA_*`) that only one of the two launches has is
  no difference: the provider never reads Orca's own env, and an update that starts exporting one
  to chats (the worktree ports of SLRM-2383) refused every chat after 1.4.263001 (SLRM-2411). A
  refused start's error names the differing parts, so the trace log shows why. An update that
  also bumps the Claude Agent SDK does not carry chats over, and neither does the first start
  after updating from a release with the earlier single-hash record. The design and the remaining phases (Codex next) are in
  `docs/fork/chat-survive.md`.
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
  without the fork RPC have no menu. Settings > Blackfish turns it off (`forkShowAccountChip`, on
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

- **Sidebar agent rows wear their tab's color dot (SLRM-1966).** When a tab in the tab strip
  shows a color dot after its title, its agent row in the workspace card's sidebar list gets a
  soft wash of that color and a 2px left edge bar in the full color, so you can tell which row
  is which tab. The color is the tab's own `color` field, the one the dot paints (the native
  chat's agent-session tab, or the terminal tab for a terminal pane), so the two always agree
  and the row goes plain when the dot is cleared. Sub-agent rows stay plain. A chat row finds
  its tab by pane key whether the chat is running or done (keying on `structuredHostOwned` lost
  the color once a chat finished, since that flag only marks a live provider child). When a
  card collapses its agents into the small icon strip, each icon whose tab has a color gets a
  thin ring in it, from the same resolver. A chat that has never had a prompt has no status
  entry, so it has no row to tint. Code is in `src/renderer/src/fork/agent-row-tab-tint/`.
- **Agent state colors (SLRM-2106).** Off by default (Settings > Blackfish > Agent state colors).
  When on, a tab in the tab strip and its sidebar agent row take a color from the agent's state:
  needs you, stalled, working, queued, unread, done or asleep, first match in that order. The
  state is the one the tab's or row's own state glyph already shows (plus the unread mark and
  the fork's stall, queue and sleep marks), so no second state machine exists and the icons and
  labels are unchanged. Each state's color is None, a theme color or a custom hex; the shipped
  theme colors are CSS variables that the light and dark themes define and pasted custom app
  themes also write (`--text-link`, `--git-decoration-*`, `--primary`, `--muted-foreground`).
  Defaults: needs you yellow, stalled red, working blue, queued muted, unread accent, done green,
  asleep none. A state set to None shows nothing (it does not fall through to a lower state).
  Show on tabs, rows or both (default both); style Stripe (2px edge, default) or Tinted (stripe
  plus a 14% wash). A manual tab color always wins: that tab and its row show only the manual
  color (SLRM-1966's tint). Sub-agent rows stay plain. Code is in
  `src/shared/fork/agent-state-color.ts` and `src/renderer/src/fork/agent-state-color/`.
- **Bot row badges and colors (BAD-658).** A bot's sidebar row says its state at a glance.
  - A Needs you pill (the attention color, with the count) and a Working pill (the working
    spinner, with the count) sit beside the bot's name, so a bot that waits on you shows it
    whether its chats are folded or not. The counts are the ones the row's own second line
    reads: its agent rows asking or working, its workers' workspaces, and the Needs you count
    its panel or Items badge publishes (else the items its host's list counted), so the pill and
    the "N needs you" line always agree. Paused and disconnected bots show no pill.
  - A bot with nothing working and nothing waiting is idle: its picture is dimmed and slightly
    desaturated. A bot stopped on a usage limit keeps its picture at full strength (the limit
    gauge on its corner says why), and paused and disconnected rows keep their own dimming.
  - The folded Bots header adds a Needs you pill after its faces: how many bots need you.
  - Right-click a bot, Color: eight palette colors, a custom color or None. The color draws a
    2px left edge bar and a faint wash on the row and a ring around the picture. Default is none,
    which looks as before. Colors are kept in `forkBotRowColors` (by `<host>/<bot id>`) in this
    desktop's settings, so they persist and never change the bot's own record or host.
  - Settings > Blackfish > Agents and workers > Bot row badges and colors: `forkBotRowBadges`
    (on by default) and Clear all colors. Code is in `src/shared/fork/bot-row-badges.ts` and
    `src/renderer/src/fork/bot-row-badges/`.
- **Bot chats listed without a tab (BAD-658).** Upstream lists under a bot only the chats whose tab is
  open on its host, so a chat another bot or a handoff started in a new chat, which nobody opened,
  showed only as the bot row's subtitle and could not be found. A side chat or thread with no open
  tab, not ended, now also lists under its bot while it is running or waiting on the owner, is new
  to the owner, or was active within `forkBotChatRecentMinutes` (unset is 60, 0 lists only chats
  with an open tab). A chat the owner closed the tab of and that is idle for longer than the window
  drops off again. The rule is `src/shared/fork/bot-chat-listing.ts`, used by
  `botSidebarListedChats`.
  - The chat a bot row's second line names (`Dotfiles` row: "<chat title> · status") opens that
    chat when clicked, as its sidebar chat row does.
  - In the sending chat, the "Handed to <bot> · <subject>" and "Asked ..." line is one dotted
    underlined link to the chat the request went to (the bot's name alone was the link before).
  - The setting is in Settings > Blackfish > Agents and workers > Bot row badges and colors.
- **Worker workspace archive (BAD-669).** A worker started in a workspace of its own
  (`worker-start --worktree new-child` or `new-top-level`) kept that workspace, its terminals and
  its build output (often several GB) after it reported done, until someone removed them by hand.
  A sweep that runs every minute (on the desktop, `orca serve` and orcad, each for its own
  workspaces) now removes such a workspace the way `orca worktree rm` does (terminals stopped,
  checkout removed) and always keeps the git branch. It acts only on a workspace
  `listWorkerCreatedWorktrees` proves a worker start created; never on a user's own workspace, a
  bot's home folder, the main checkout, `workspace: current` or a workspace made later at the same
  path.
  - Removed once all hold: every dispatch that used it is succeeded, failed or abandoned
    (`stopped` and running ones hold it); the archive delay has passed since the newest finished;
    nothing is uncommitted or untracked (ignored output does not count); every commit on its
    branch is on a base branch by ancestry or by patch (`git cherry`, so cherry-picks and
    resyncs count), or the branch has no commits of its own; and the user did not keep it.
    "Base branch" is any remote's default branch, the project's default and the branch the
    workspace was created from, so a fork next to its upstream works.
  - Kept on purpose, so left alone: Keep open (`worker-keep-open`, `--keep-open`), a terminal the
    user took over, a pinned workspace, a turn started after the report (someone typed into the
    chat or terminal or sent it more work) or activity stamped more than a minute after it, and a
    workspace a window shows now (windows report it through `fork.workerCleanup.focus` about every
    minute; a report that stops lapses after 3 minutes).
  - A workspace left alone shows why on its sidebar row ("unmerged commits", "uncommitted
    changes", "kept open", ...) with one click to "Remove anyway", which asks first and forces
    the removal of that one workspace. A running worker cannot be forced.
  - Idle terminal stop: a finished worker's agent and terminal stop `forkWorkerTerminalStopMinutes`
    (unset is 15) after its report, even when the workspace stays, through the stock release path
    that Worker cleanup uses (a chat keeps its history and opens read-only; `orchestration send`
    reopens the worker). It skips a worker kept open, in a turn, with a question open, or used
    again after it reported.
  - Manual: "Clean up finished workers" on a bot row's menu and in a bot's Chats tab opens a
    dialog listing what it will remove and what it leaves with the reason, on this machine and
    every paired server, and runs it with the delay waived.
    `orca orchestration worker-cleanup [--bot <name>] [--dry-run] [--include-remote]` does the
    same from a shell; it never forces.
  - Servers: each server runs the sweep for its own workspaces. `--include-remote` and the dialog
    ask every paired server for its own pass (`fork.workerCleanup.run` with `includeRemote`
    false) and list what each answered; one that does not answer, or runs an older build, is
    listed as such. The sidebar's held reasons are read from this machine only.
  - Settings (Settings > Blackfish > Agents and workers > Finished worker workspaces):
    `forkWorkerArchive` (unset is on), `forkWorkerArchiveDelayMinutes` (unset is 120) and
    `forkWorkerTerminalStopMinutes` (unset is 15). The delay waits for the report and applies to
    failed and abandoned workers too.
  - Code is in `src/shared/fork/worker-archive*.ts`, `src/main/fork/worker-archive/`,
    `src/main/runtime/rpc/methods/fork/fork-worker-cleanup.ts`,
    `src/renderer/src/fork/worker-archive/` and `src/cli/fork/worker-cleanup-*`.
- **Hide and close bot chats (BAD-669).** Since BAD-658 a chat with no tab lists under its bot
  while it runs, waits or is new, or within `forkBotChatRecentMinutes`, and there was no way to
  dismiss one. A side chat's row in a bot's sidebar section now has a right-click menu and a hover
  x: Hide from sidebar keeps it running and in the bot's Chats tab; Close chat ends it the way an
  ended session is closed (`fork.botChat.close`, after a confirm when it is running or waiting)
  and its history stays in Chats. The bot row's menu has Hide finished chats for every idle side
  chat. A hidden chat lists again, and its hide is dropped, when after it was hidden it needs the
  owner: a question or needs-you state, a worker waiting on them, or a reply they have not read.
  Never offered on the Home Chat, a closed chat or an automation run listed as a chat. Hidden
  chats are `forkBotHiddenChats` (chat id to time, newest 500); the rule is
  `src/shared/fork/bot-chat-hide.ts`. Code is in `src/renderer/src/fork/bot-chat-hide/` and
  `src/main/fork/bot-chat-close/`.
- **Auto-close finished bot chats (BAD-734).** A bot opens one chat per routed card or handoff and
  nothing ended them: a bot listed every chat it ever had, and the iPhone app (upstream's own build)
  shows whatever chat list the desktop serves it. Blackfish is public, so every number is a setting.
  - **When a chat closes.** A non-home bot chat closes (the same close as Close chat in BAD-669; its
    history stays in the bot's Chats tab) when it is idle (no running turn, no worker running, no
    mail queued, no open ask or Needs you item naming it) and one of these holds: its card (a key
    such as ABC-12 in the title) is Done or Canceled in Linear; a chat Orca started (card route,
    handoff, quick task, an outside thread) finished and reported back to whoever handed it off
    (`worker_done`, or its handoff answered), with no mail received since; or it has been idle longer
    than `forkBotChatAutoCloseIdleHours` (unset is 24). The first two wait `forkBotChatAutoCloseGraceMinutes`
    (unset is 10) after the chat's last activity, so a quick follow-up lands there and restarts the
    wait. `forkBotChatAutoClose` (unset is on) turns it all off.
  - **Never.** The Home Chat, a chat already closed, one that is running, queued, or waiting on the
    owner, and one the owner typed into within the idle window (a turn that is not Orca's mail and
    began more than a minute after the chat was created).
  - **Home Chat row.** A closed chat Orca started leaves one compact status line in its bot's Home
    Chat: title, card key and link, outcome (done, failed or blocked, read from the final reply) and
    the chat id (`chat:<id>`, as `orca bot chats` prints it). It is a status line, so it starts no
    turn and wakes no bot. A chat the owner started closes quietly.
  - **Mail reopens.** Chats Orca closed are kept in `fork-bot-chats-auto-closed.json` in the data
    folder. Mail for one (any session recipient, or a chat id a bot send names) shows its tab again
    before it is routed, so nothing is refused or dropped. A chat closed by hand stays closed.
  - **Each host runs its own.** The desktop, `orca serve` and orcad each run the pass for their own
    bots, every 2 minutes (backing off to 10 when idle). The first pass is the one-time sweep: it
    judges every existing chat with the same rule, so there is no separate flag.
  - **The list clients get.** `bots.chatTree` leaves closed chats out (the phone app can neither
    ask for them nor be changed), orders the rest as the app does, and says how many it left out
    (`closedTotal`). `fork.botChat.older` pages closed chats in, newest activity first. The Chats tab
    has a Show older chats (N closed) toggle and Show more. A read for one chat (`chatId`) is
    unchanged. The phone has no way to show closed chats; they stay in the desktop's Chats tab.
  - **CLI.** `orca bot chats-cleanup [--bot <name>] [--dry-run] [--include-remote]` runs the same
    pass by hand (`fork.botChat.cleanup`) and prints what closed, or with `--dry-run` what would,
    and why. `--include-remote` asks every paired server for its own part.
  - Code is in `src/shared/fork/bot-chat-auto-close.ts` (the rule and settings),
    `src/shared/fork/bot-chat-list-filter.ts`, `src/shared/fork/bot-chat-cleanup.ts`,
    `src/main/fork/bot-chat-close/` and `src/renderer/src/fork/bot-chat-closed/`.
- **Lost work (SLRM-2096).** A Lost work button in the workspace cleanup dialog opens a scan of
  every local git project for work an agent worktree could lose. Nothing runs until you press
  Scan; the scan only reads git and can be stopped.
  - It lists worktrees with commits not on the default branch (squash merges are caught by
    patch-id, and by pull request state when `gh` is installed and signed in; without `gh` the
    scan carries on and says so), worktrees whose pull request is merged or closed, worktrees
    git knows that Orca does not track, Orca workspaces whose folder is gone, local branches
    with unmerged commits and no worktree, and stashes.
  - Each row shows unmerged and unpushed commits, uncommitted files, the last commit date, the
    pull request link and state, and a risk: safe to remove, needs a look, or would lose work.
  - Actions per row and in bulk: open the workspace, push the branch, view or create the pull
    request, save as a git bundle or patch file (uncommitted changes go in a second patch), and
    delete. Delete always asks; anything that would lose work needs a second confirm, and main
    checks again against git before it deletes. Tracked workspaces go through Orca's own removal;
    untracked worktrees, gone folders (`git worktree prune`), branches and stashes through
    `src/main/fork/lost-work/lost-work-actions.ts`.
  - CLI: `orca lost-work [--repo <id|name>] [--json]` prints the same scan as a table, over the
    `fork.lostWork.scan` RPC (desktop host only; remote and folder projects are skipped with a
    note).
  - Settings > Blackfish > Projects (`forkLostWork`): which checks run (all on), the archive
    folder for saves (empty: ask each time), a default branch per project (empty: the remote's
    `HEAD`, then `main`, `master`, `trunk` or `develop`), squash lookback (500 base commits) and the pull request limit
    (200 per project).
  - Scan speed (SLRM-2175). Each repository is read in batches: one `for-each-ref` with
    `%(ahead-behind)` says which branches are already on the default branch (those cost nothing
    more), and one `rev-list` holds every commit no remote has. Git older than 2.41 has no
    `ahead-behind`; the scan then uses `for-each-ref --merged`, and without that asks per
    branch as before. `git cherry` and the squash check still decide every branch that is
    ahead, so the results are the same. Projects that share one git common dir (a worktree
    opened as its own project) are read once: a worktree row goes to the project opened at
    that folder, else to a project that tracks it, else to the main checkout's project;
    branches and stashes go to the main checkout's project (the first of the group when the
    main checkout is not a project), and the other projects get a "same repository" note.
    Pull requests are read beside the git work, with a time limit; past it the scan carries
    on with the pull-requests note. The dialog shows projects done of total and adds each
    project's rows as it finishes (`fork:lostWork:progress`); the CLI and RPC output keep
    their shape. Settings: pull request time limit (20 seconds), projects at once and checks
    at once (0, automatic: a quarter of the cores between 2 and 4, and half the cores between
    2 and 6; the app's git queue caps what runs at once anyway).
  - In use (SLRM-2230). A workspace that is in use is never listed as safe to remove: its row
    says why ("In use: agent running, 2 chats open", "Open now") and reads needs a look. The
    dialog lays this over the scan from what the window already holds (the tabs, agent status
    and sleeping sessions the sidebar reads), checks again every few seconds and once more
    right before a delete. The `fork.lostWork.scan` RPC does the same from the runtime's
    `worktree.ps` rows and the chat facts Sleepers lists, so `orca lost-work --json` rows carry
    an optional `inUse` field and the table marks them `[in use: ...]`. The scan itself and
    every existing field are unchanged. Deleting a row in use takes its own confirm that names
    what is open, alone or in bulk; select all never ticks such a row, and a row that comes
    into use after the confirm is refused. Settings (`forkLostWork.inUse`, all on): a running
    or waiting agent, an open chat, a sleeping chat or agent, a live terminal, and the
    workspace on screen each count.
  - Many rows (SLRM-2230). The filter buttons show counts and a line says what each group is
    for. Rows are grouped by project under a header that folds and has a checkbox for that
    project's shown rows; a select-all checkbox covers the shown rows and says how many are
    ticked. With the Safe filter on, "Delete all N safe" goes through the same confirm, which
    states the count per kind (workspaces, branches, folders already gone, stashes). Each row
    shows one suggested action first (`lost-work-row-actions.ts`): a gone folder, Delete
    (forget); a stash, Save patch; in use or uncommitted files, Open; commits not pushed, Push;
    pushed with no pull request, Create pull request; a pull request open, View pull request;
    merged, or pull request merged or closed, Delete. A bulk action ends in a summary in the
    dialog: how many were done, and each refused row with its reason.
  - BAD-542: the in-use read counts a dispatched worker's chat (its `worktree.ps` row has a
    `parentPaneKey`; Sleepers still skips those rows), and `orca lost-work` waits up to 10 minutes
    for a scan of every project instead of the stock 60 seconds.
  - Code is in `src/main/fork/lost-work/`, `src/renderer/src/fork/lost-work/`,
    `src/shared/fork/lost-work.ts`, `src/shared/fork/lost-work-use.ts`, `src/preload/fork/lost-work-bridge.ts` and
    `src/cli/fork/lost-work-*`.

- **Sidebar agent rows count their children (SLRM-2095).** A compact agent row shows a small
  `running/total` badge (for example `3/12`) for everything that agent is responsible for, and
  hovering it lists each child by name, kind and state, indented by lineage. Children are:
  orchestration workers the chat dispatched, in any worktree (from the runtime orchestration
  contexts' parent pane, falling back to the parent's terminal handle); the workers those
  workers dispatched, transitively; and each session's own child work, meaning sub-agents and
  background shell tasks or monitors, nested ones included. When a card collapses its agents
  into the icon strip, the strip shows one total for the card, each child counted once.
  Settings > Blackfish has three switches, all on by default: show the badge
  (`forkShowChildTally`), count finished children in the total (`forkChildTallyCountFinished`;
  off shows only the running count) and count background tasks (`forkChildTallyCountTasks`).
  Limits: a pane carries only its latest dispatch, so earlier dispatches to the same pane are
  not counted; a finished worker drops out once its dispatch is more than 30 minutes old or its
  pane is gone; hosts that publish no child-work views report only running sub-agents. The
  stock same-worktree `+N` disclosure is unchanged. Code is in
  `src/renderer/src/fork/agent-child-tally/`.

- **Custom app themes (SLRM-2097).** Settings > Appearance > Custom app themes loads a whole
  app theme from pasted text or a file: an Orca theme JSON, a Ghostty or Warp theme, or a
  base16/base24 scheme, whose palette the importers turn into app colors. A theme carries app
  color tokens (the plugin theme tokens), an optional terminal palette, and an optional font
  and radius; values must be colors, sizes are capped. The box validates as you type, shows a
  live preview, and saves to a list with Use, Rename, Copy JSON, Export and Delete, plus Reset
  to default. Nothing changes until a theme is used. A used theme paints through the plugin
  theme path (same contrast checks and startup cache) and its terminal palette becomes a stock
  custom terminal theme. Format and example: `docs/fork/custom-app-themes.md`. Code is in
  `src/shared/fork/custom-app-theme/` and `src/renderer/src/fork/custom-app-theme/`.

- **Chat sleep: idle native chats give up their provider process (SLRM-2093).** Off by default
  (`forkChatSleep`, Settings > Blackfish). Stock Orca already has an idle sweep for native chats
  (`StructuredAgentSessionIdleSweep`, every 5 minutes, window from Stop idle chats,
  `nativeChatIdleStopMinutes`): it stops an idle chat's provider and closes the conversation at
  rest, and the next send (typed, an orchestration letter or the CLI) opens it again and starts
  a provider on the same session. Upstream's experimental Agent sleep
  (`experimentalAgentHibernation`) only covers terminal agents. Chat sleep reuses the stock
  sweep rather than adding a second path:
  - While on, the sweep's window is `forkChatSleepIdleMinutes` (default 30) instead of the stock
    setting. While off, the sweep runs on the stock setting exactly as before.
  - With `forkChatSleepKeepVisible` (default on), a chat that is the active tab of any tab group
    in the open workspace is kept awake and its idle clock restarts, so it sleeps a full window
    after it leaves the screen. The renderer reports those session ids over
    `fork:chatSleep:onScreen`; a closed window's list is dropped. This covers chats this desktop
    hosts; chats on paired hosts follow their own host's sweep.
  - The sweep's own owed-work check still runs first, so a chat with a running turn, a queued or
    mid-delivery send, an open dispatch, a pending prompt, open child work or a provider that
    does not confirm it is idle is never put to sleep.
  - A sleeping chat (settled, no host running its provider) shows a moon after its tab title and
    on its dashboard and worktree card row, and its compact sidebar row is dimmed.
    Code is in `src/shared/fork/chat-sleep.ts`, `src/main/fork/chat-sleep/` and
    `src/renderer/src/fork/chat-sleep/`.

- **Truthful memory in the Resource Usage popover (SLRM-2099).** Stock counts only each
  terminal's direct process, so a Mac with dozens of agents can show a few GB while the agents
  hold tens. The fork walks every session's whole process tree from one process-table snapshot
  per poll: terminal PTYs under the terminal host, native chat providers (their lease's owner
  pid) and the tool servers they start. A child that was reparented when its parent exited is
  still found, by the session it belonged to last poll (same pid and name) or by a process
  group the session leads. Each process counts once. Memory is the physical footprint on macOS,
  PSS (plus swapped PSS) on Linux and private bytes on Windows. The popover shows system memory
  (used, compressed, swap, pressure level), the grand total, the app's own share (Electron,
  helpers, terminal host), and each workspace and session split into agent, tool servers,
  shells and other. When pressure or swap passes a threshold, a warning icon shows in the
  status bar and one notification fires per episode. An optional setting, off by default,
  pauses new agent launches while over, with a message where the launch was refused.
  `orca diagnostics` prints the same numbers, and `--json` includes them as `forkTruth`.
  Settings are in Advanced: warn at pressure level (default warning), warn at swap GB (default
  8, 0 is off), pause new agents (default off) and poll seconds (default 15). Code is in
  `src/main/fork/memory-truth/`, `src/renderer/src/fork/memory-truth/`,
  `src/shared/fork/memory-truth.ts` and `src/cli/fork/memory-truth-format.ts`.
- **Agent launch queue (SLRM-2098).** A limit on how many agents run at once, with a queue for
  the rest. Off by default; Settings > Blackfish turns it on.
  - **The gate.** Every native chat provider start passes one main-process gate
    (`src/main/fork/agent-queue/`): a new chat's first message, `orca agent launch`,
    `orca worktree create` with an agent, `orca orchestration worker-start`, the UI's new-agent
    actions and queued messages all start the provider through `claimStructuredAgentSessionAgent`,
    which the gate wraps. Past the limit the chat tab opens at once and shows "Queued (position
    N)" with Start now and Cancel; the tab title carries a small queued badge. Messages sent to a
    queued chat stay in its journal and go out when it starts.
  - **Order.** First in, first out, with user-started launches ahead of orchestration workers.
    Start now skips the queue for one launch; Cancel drops it and the waiting message shows as
    not sent (sending again queues again).
  - **What counts as running.** Only agents whose provider process is running: a chat while
    this app owns its provider child (`hostExecutionOwned`), a terminal while an agent runs in
    its pane. A chat that sleeps, ends or crashes frees its slot; the gate notices on its next
    check (every 2 s while anything waits) and on every new launch. It reads only that live
    state, so it composes with anything else that sleeps or stops chats.
  - **Deadlock rule.** A worker whose coordinator is running and waiting on it is let through
    when every running agent in its pool is itself waiting on a queued worker.
  - **CLI.** A launch that queues prints `queued, position N (start now: orca agent queue start
    <id>)` and exits 0 (on stderr with `--json`). `orca agent queue list [--json]`,
    `orca agent queue start <id>` and `orca agent queue cancel <id>` go over runtime RPC
    (`fork.agentQueue.list`, `.status`, `.start`, `.cancel`), so they reach paired hosts too.
  - **Memory seam.** `shouldHoldLaunches(): {hold, reason?}` in
    `src/main/fork/agent-queue/launch-hold.ts`, installed with `setLaunchHoldReader`. While it
    holds, new launches queue even with free slots. Nothing measures memory yet; the default
    never holds.
  - **Settings** (Settings > Blackfish): `forkAgentQueueEnabled` (off), `forkAgentQueueMaxLive`
    (8), `forkAgentQueueSeparateLimits` (off: workers share the one limit; on: they get
    `forkAgentQueueMaxWorkers`, 8, and `MaxLive` covers user-started agents only) and
    `forkAgentQueueResumeBypass` (on: waking an existing chat never waits).
  - **Not covered.** Agents launched into a terminal pane (terminal-only launches and
    terminal-mode workers) count as running but are never queued. orcad (headless) installs no
    settings reader, so the queue is off there. A paired remote host queues its own launches,
    but this window's banner reads only the local queue.
- **Chat stall: a chat stuck working is marked, and can be released (SLRM-2127).** The stock
  idle sweep treats a chat with an open turn as busy and never releases it. A turn whose result
  event was lost, a provider that hangs, a provider in the stopped (T) state, or a provider that
  died without its exit being observed leaves the turn open, and the provider is held forever.
  (A provider whose exit is observed, and an app restart, already end the turn in stock code.)
  - Each sweep tick, every chat held busy is checked by its journal cursor. A cursor that has
    not moved for `forkChatStallMinutes` (default 30; 0 turns detection off) marks the chat
    stalled. Only then is the process table read (`ps`, not on Windows) from the provider root
    the chat's lease records: the root, a supervisor under a chat-survive broker, and the
    writer give `alive`, `stopped` (any of them in the T state) or `gone` (root missing or a
    zombie); a failed read is `unknown`. A stopped tool deeper down is the tool's business and
    reads `alive`.
  - A stalled chat shows an amber Stalled mark on its sidebar row and an hourglass after its tab
    title. Its menu offers Interrupt (the host's own cancel, as the Stop button), Release (the
    sweep's own retire path: stop the provider, close the conversation at rest; the next send
    starts it again) and, for a stopped provider, Wake (SIGCONT to each stopped process of the
    tree). Every action is refused for a chat that is not marked now.
  - With `forkChatStallAutoRelease` (default off), a chat stalled for twice the window whose
    provider is `stopped` or `gone` is released; a stopped provider is resumed first so it can
    take the stop. A chat whose provider is `alive` or `unknown` is only ever marked, since it
    may be running a long tool.
  - This covers chats this desktop hosts. Code is in `src/shared/fork/chat-stall.ts`,
    `src/main/fork/chat-stall/` and `src/renderer/src/fork/chat-stall/`.
- **Provider writer kill under a chat-survive broker (SLRM-2127).** `killProviderWriter` only
  group-killed children of the root that lead their own group, so under a broker (whose
  supervisor shares the broker's group) it matched nothing: the writer was still reached by the
  descendant sweep, but `killDelivered` stayed false and the close proof was weaker.
  `forkProviderWriterParents` (`src/main/fork/chat-survive/chat-survive-writer.ts`) also counts
  a direct child that shares the root's group as a writer parent.
- **Worker cleanup: finished orchestration workers give up their agent (SLRM-2100).** Off by
  default (`forkWorkerCleanup`, Settings > Blackfish). Stock Orca already closes finished workers:
  when a dispatch settles it arms `auto_release_at` 2 minutes out unless
  `orchestrationWorkerAutoReleaseEnabled` is false (default on), suspends the countdown while
  the agent is in a turn, skips workers marked Keep open (`release_state = 'retained'`), archives
  a terminal worker's output, then closes the pane or stops the chat and hides its tab. It never
  touches the worktree. It does not wait for the coordinator to read the report, ignore open
  questions, notice the worker was used again, check for uncommitted or unpushed work, look at
  merges, or offer Undo. Worker cleanup takes over that release while on:
  - Stock auto-release (and its federated claims) reads as off while `forkWorkerCleanup` is on;
    while off, stock runs exactly as before.
  - A sweep runs every minute (while the setting is off the timer backs off to every 5 minutes,
    and changing the setting starts it over at one minute) over owned workers whose dispatch succeeded or failed and that are
    not kept or released. It leaves one open while: its agent started a turn after it reported
    (typed into or sent more work), a question or decision gate is pending, a `worker_done`
    report is unread, it is in a turn, it has no local git worktree, or git cannot read the
    worktree. Uncommitted files or commits on no remote hold it open with a mark on its tab and
    row instead. Only workers that report while the app runs are judged (the turn record is in
    memory).
  - Triggers: `forkWorkerCleanupOnDone` (default on) after `forkWorkerCleanupGraceMinutes`
    (default 5) from the report; `forkWorkerCleanupOnMerged` (default off) as soon as the branch
    has a merged pull request (`gh`, when installed and signed in; any failure reads as not
    merged) or made commits that are all on the default branch.
  - `forkWorkerCleanupAction`: `close` (default) hands the worker to the stock release path
    (`release_state = 'requested'` with the automatic-close markers, so stock still yields to an
    agent that starts working again), which archives terminal output and closes the pane or
    stops the chat and closes its tab. `release` stops a chat's agent and keeps its tab; the next
    message starts it again. A terminal worker's agent is its pane, so it closes in both modes.
  - Never deleted: the worktree and branch (lost work owns removal). A closed chat keeps its
    journal and reopens from the notice's Undo or the closed-tab menu; a closed terminal's output
    is in the worker archive (`orca orchestration worker-show`) and Undo resumes its
    conversation in a new terminal, as opening a closed worker does.
  - Each sweep that cleans up shows "N finished workers closed." with Undo. Undo reopens closed
    chat tabs, resumes closed terminals, and marks released chats Keep open.
    Code is in `src/shared/fork/worker-cleanup.ts`, `src/main/fork/worker-cleanup/`,
    `src/preload/fork/worker-cleanup-bridge.ts` and `src/renderer/src/fork/worker-cleanup/`.

- **Launch defaults (SLRM-2102).** Stock runs a launch on the model in Settings > Agents or the
  agent's own config unless the launch passes `--model`, so a forgotten flag runs whatever that
  is. Settings > Blackfish > Launch defaults sets, per agent, an optional model and effort for
  three kinds of launch: CLI launches (`orca agent launch`, `orca worktree create --agent`),
  orchestration workers (`orca orchestration worker-start`) and automation runs (scheduled and
  run-now). The choices come from the app's own model catalog. Order: an explicit `--model` or
  `--effort`, a picker choice or a model in the agent arguments wins, then the default for the
  kind, then stock. A default the agent refuses falls back to stock with a note. Every cell is
  empty by default, which is stock. Desktop and mobile pickers keep the Settings > Agents
  default. `orca agent launch` prints a `model:` line, `worker-start --json` adds `modelFrom`, a
  worker's sidebar row tooltip names its model and effort and says when the worker default chose
  them, and `orca launch-defaults [--agent <agent>] [--json]` prints what each kind resolves to.
  Not covered: desktop and mobile launches, `--terminal` reuse, automation `reuseSession` sends,
  the legacy `worktree.create` startup agent on old hosts, and paired hosts that run stock Orca.
  A fourth kind, New bots (`bot`, BAD-635), is the model and effort a bot is made with when it
  brings none; see Bot model from the CLI.

- **Sleepers: one place to see and manage sleeping and idle agents (SLRM-2094).** A dialog,
  opened from the moon button in the sidebar's bottom toolbar or the Sleepers... quick action,
  lists every native chat and terminal agent across all workspaces with its state (working,
  needs input, awake and idle, asleep), idle time, last activity, workspace, model and memory
  (only when the resource monitor already sampled that pane). Rows filter by state, workspace and
  idle time and sort by idle time, last activity, workspace or state.
  - Per row and for a selection: sleep now, wake (or open), keep awake (pin) and close (asks once
    more). Sleep all idle and Sleep all except visible each take one click; both skip pinned
    chats and anything not awake and idle.
  - Sleep now goes through the stock idle sweep (`sweepNow`), so the same owed-work check runs:
    a chat with a running turn, a queued or mid-delivery send, an open dispatch, a pending
    prompt, open child work, a starting provider or a provider that does not confirm it is idle
    is refused and reported as busy. Only native chats this desktop hosts can be put to sleep
    now; terminal agents are listed, woken and closed, and sleep through Agent sleep as before.
  - A pinned chat is never put to sleep by the idle sweep, whether or not Chat sleep is on.
    Pins are the only new setting: `forkSleepersPinned` (native chat session ids, unset is
    none). An explicit sleep of one pinned chat still works.
  - CLI: `orca sleepers list [--json]`, `orca sleepers sleep <id>|--all-idle [--except-visible]`,
    `orca sleepers wake <id>`, `orca sleepers pin <id>` and `orca sleepers unpin <id>`. Ids are
    the session id or a unique prefix of it, as `list` prints them.
    Code is in `src/shared/fork/sleepers*.ts`, `src/main/fork/sleepers/`,
    `src/main/runtime/rpc/methods/fork/fork-sleepers.ts`, `src/renderer/src/fork/sleepers/` and
    `src/cli/fork/sleepers-*`.

- **MCP profiles (SLRM-2101).** Choose which MCP (tool) servers a Claude chat loads. Everything
  defaults to "all", which passes nothing to Claude, so stock behavior is unchanged.
  - **Discovery** (`src/main/fork/mcp-profiles/claude-mcp-discovery.ts`) reads Claude's config the
    way Claude does, read-only: user servers (`mcpServers` in `~/.claude.json`, or
    `$CLAUDE_CONFIG_DIR/.claude.json` for an account with its own folder), local servers
    (`projects[<folder>].mcpServers`) and `.mcp.json` files from the folder up, which load only
    once approved (`enableAllProjectMcpServers` / `enabledMcpjsonServers`, minus
    `disabledMcpjsonServers`). `projects[<folder>].disabledMcpServers` turns any off. On a shared
    name local wins, then project, then user. Nothing writes to the user's agent config.
  - **Profiles** are named allow or deny lists of server names, plus the built-ins "all" (stock)
    and "none". The profile a launch uses is the chat's own choice, else the closest
    per-project entry holding the chat's folder (or its worktree's main checkout), else the
    default for its launch kind: interactive (UI, `agent launch`, `worktree create`), worker
    (`orchestration worker-start`) or background (automations).
  - **Applying.** For anything but "all" the Claude launch gets `--strict-mcp-config` and, unless
    the profile is "none", `--mcp-config <file>` holding only the kept servers' own definitions.
    The file is `<userData>/fork-mcp-profiles/launch/<chat>.json` (folder 0700, file 0600, written
    through an exclusive temp file), replaced on every start, swept when older than a day at
    startup and all swept on quit. Server env, headers and arguments are never logged or shown;
    a failure logs the error message only and the chat runs with every server.
  - **Skipped with a reason** (the chat runs with every server and says why): the chat runs inside
    WSL, the Claude launch arguments in Settings already set `mcp-config` or
    `strict-mcp-config`, or an enterprise `managed-mcp.json` is installed.
  - **On the chat.** `NativeChatStructuredSessionStatus` shows "MCP profile: X" with a picker and
    the servers the last start got (tooltip). A change to a live chat applies at its next start
    (sleep, restart or resume) and the strip says so. Per-chat state is
    `<userData>/fork-mcp-profiles/chats.json`.
  - **CLI.** `--mcp-profile <name>` on `orca agent launch`, `orca worktree create` and
    `orca orchestration worker-start` (an unknown name is refused before anything starts).
    `orca mcp-profile list [--folder <path>]`, `orca mcp-profile show <session>` and
    `orca mcp-profile set <session> <profile|default>`, all with `--json`, over runtime RPC
    (`fork.mcpProfiles.list`, `.chat`, `.set`).
  - **Settings** (Settings > Blackfish > MCP profiles): `forkMcpProfiles` ([]),
    `forkMcpDefaultInteractive`, `forkMcpDefaultWorker` and `forkMcpDefaultBackground` ("all"),
    and `forkMcpProjectProfiles` ([]).
  - **Not covered.** Claude terminal (TUI) launches, Codex and other agents, chats inside WSL,
    remote and paired hosts (they install nothing, so their chats load every server) and
    plugin or claude.ai connector servers, which Claude adds on its own and which any profile
    but "all" leaves out. Headless orcad installs nothing and passes every launch through.
- **Agent lifecycle, joined up (SLRM-2136).** The fork's chat lifecycle features now work as one
  set.
  - Memory pause queues instead of refusing: with "Pause new agents while over" (Memory) and the
    launch queue both on, a new chat made while memory is past the warning line waits in the
    launch queue instead of being refused. Its queued banner, tab badge, `orca agent queue list`
    and the launch command's queued line say "memory is low", and it starts as soon as a sample
    shows memory recovered (or the pause is turned off), or at once with Start now. With the
    queue off the launch is refused as before. The shared memory status decides which once
    (`launchesPaused` refuses, `launchesHeld` queues; never both). Terminal agents cannot wait in
    the queue, so they are still refused while memory is low.
  - Sleepers lists two more states: Stalled (from chat stall, with that feature's menu:
    Interrupt, Release and Wake for a stopped provider) and Queued (from the launch queue, with
    Start now and Cancel and why it waits). Both show in the dialog, its state filter and sort,
    and `orca sleepers list [--json]` (which adds the queue place and reason, or how long the
    chat has been quiet). A queued launch whose chat has no row yet is listed on its own.
  - A setting hides the sidebar's Sleepers button: `forkSleepersButton` (unset is shown).
  - These settings (chat sleep, Sleepers, stalled chats, worker cleanup, launch queue, launch
    defaults and memory) sit in the fork's own Settings pane now (see "The fork's own Settings
    pane" below). Each keeps its own card and behavior.
    Code is in `src/main/fork/memory-truth/memory-launch-hold.ts`,
    `src/shared/fork/sleepers-lifecycle.ts`, `src/main/fork/sleepers/sleepers-lifecycle.ts`,
    `src/renderer/src/fork/sleepers/ForkSleepersLifecycleActions.tsx` and
    `src/renderer/src/fork/sleepers/ForkSleepersSetting.tsx`.
- **Fork main passes the push and pull request checks (SLRM-2138).** Every check that runs
  on a push to `main` or on a pull request passes on the fork (the list is under Contributing).
  What that changed:
  - **Sync file I/O on the main process.** Calls on paths that repeat moved to
    `node:fs/promises`: the lost work scan and actions; the Claude account move (pin saves, the
    history check, the pane pointer the terminal spawn writes); and chat survive's record
    writes, socket folder check and adopt read; and the MCP profiles' enterprise policy check,
    which runs on every Claude launch.
    - Record writes are queued per path, so a spawn's write, the detach rewrite and the exit's
      removal stay in order. Quit waits for the queue (one hook line in
      `structured-agent-session-host-lifetime.ts`, through `src/main/fork/chat-survive-quit-hooks.ts`).
    - A detach whose chat changed during its write undoes itself and removes the record it wrote.
    - A failed first record write unregisters the broker, so it is not handed off at quit.
    - The spawn hook stays synchronous. It reads a readiness answer (private socket folder)
      that is checked when the setting is turned on, at install and after each spawn, and keeps
      its one stat of the broker entry (baselined). Start-up awaits the first check
      (`installForkReady` in `main-process-ready-foundation.ts`) before sessions are restored. A
      chat started within milliseconds of switching the setting on can still run without it.
    - The broker's socket chmod tolerates the socket being gone when its direct owner died in
      that moment; the broker then ends without an orphan timer.
    - The broker checks its socket folder itself, because the system may clear the temp folder
      in between.
    - A pin save moves its pending entry first and awaits the file after, as before.
  - **Baselined in `config/main-sync-fs-baseline.txt`** (one-shot reads that must finish before
    the code after them):
    - `shared-stock-data.ts` (11): runs once in `configureDevUserDataPath` before ready, before
      anything opens the data folder.
    - `fork-app-identity.ts` (1): one plist read, cached per executable path.
    - `chat-survive-sweep.ts` (8): runs once at install and must finish before session recovery
      can adopt a broker.
    - `claude-session-account-pins.ts` (1): one read that fills the cache synchronous launches
      read from; every write is async.
    - `chat-survive-launch-ready.ts` (1): the spawn's one stat of the broker entry, kept from
      before so an entry removed since the last check spawns the plain provider.
    - `chat-survive-launch-hash.ts` (1): the spawn's read of a config file a launch flag names
      (a chat's MCP config), so the launch fingerprint covers what the provider reads from it.
      The spawn hook is synchronous, and the file is small and was written just before.
    - `usage-ledger-file.ts` (3): the ledger's one read and its folder creation, both once at
      install. The batched saves keep the shared synchronous atomic writer, because the quit
      flush must land before the process exits.
  - **Fixed timers became timers that back off or stop.**
    - The broker's owner check runs at 100 ms, backing off to 1 s. Its stdin end still reports a
      dead app at once.
    - The stdin end confirm checks at 25, 50, 75 and 100 ms and decides at 250 ms, as before.
    - An adopted child's broker gone check runs at 100 ms, backing off to 1 s.
    - Worker cleanup backs off while off (above).
    - The restart guard menu has no timed refresh (Restart guard below).
    - The Sleepers list refreshes every 5 s only while the window is visible.
    - The MCP chat panel's refresh pauses while the window is hidden.
    - The usage ledger prunes hourly after a prune that dropped rows, backing off to every 6 h
      while nothing ages out, and prunes at once when the retention setting changes.
  - **Lint fixes.**
    - The chat stall probe and process table run `ps` through `@orca/process-host`, with the same
      results on failure.
    - Fork renderer strings go through `useTranslate`. The custom theme preview's words became
      `fork.customAppTheme.preview.*` keys.
    - Lost work pull request links open through `openAppHttpLink`, so they follow the app's
      link setting.
- **Idle recovery and the Decision inbox (SLRM-2196).** Off by default (`forkIdleSweepMode`
  `off`, Settings > Blackfish). An agent's turn can end with a question to you, or with work it
  offered or promised and never started. With the mode on, a sweep in the main process reads how
  each idle chat ended, classifies the ending once, and lists the chats that wait on you; in mode
  `wake` it also sends a stalled chat a message to carry on. The user guide, with the
  classifier contract and limits, is [docs/fork/idle-recovery.md](docs/fork/idle-recovery.md).
  - **Modes.** `off`: no sweep, no chat read, no process started; the timer only reads the
    setting and backs off to every 2 minutes. `inbox`: classify and list, never send. `wake`:
    as `inbox`, and wake stalled chats.
  - **Which chats.** Native chats and terminal agents on this host whose turn ended and that
    have been idle for `forkIdleSweepIdleSeconds` (45), from the same rows as Sleepers. Left
    out: a turn in progress, a turn you stopped, sub-agents, sleeping or hibernated chats,
    paused chats (`forkIdleSweepPaused`), and orchestration workers unless
    `forkIdleSweepWorkers` is `include`.
  - **The classifier.** `forkIdleSweepClassifierCommand` is a command of yours. It reads one
    JSON object on stdin (`version`, `chat` with `id`, `kind`, `agent`, `cwd`, `title`,
    `request_source`, `role`, `last_user_request`, `last_assistant_message` (the last 8000
    characters), `idle_seconds`, `background_pending`, `scheduled_wake`, `wakes_this_turn`,
    `max_wakes`) and prints one JSON object: `verdict` (`finished`, `waiting_user` or
    `stalled`), `reason`, `question`, `next_step`, `wake_after_seconds`. It is stopped after
    `forkIdleSweepClassifierTimeoutSeconds` (30). A failed start, a non-zero exit, a timeout or
    unreadable output reads as `finished`, so a broken classifier never wakes a chat. With no
    command a built-in check runs: it reads punctuation and layout only, answers `waiting_user`
    when the last message closes on a question, and never answers `stalled`, so nothing is
    woken without a command of yours. At most 3 endings are classified at once.
    `docs/fork/idle-recovery/example-classifier.mjs` is a rule-based example with no
    dependencies.
  - **Once per ending.** An ending is named by a fingerprint of the chat, its last request and
    the end of its last message. It is read again only when the chat went idle anew, and
    classified again only when it changed, or when the classifier asked for a later look
    (`wake_after_seconds`, at most `forkIdleSweepRecheckMaxMinutes`, 60) and that time came.
  - **What a verdict does.** `finished`: recorded. `waiting_user`: listed in the Decision inbox
    with the question. `stalled`: listed, and in mode `wake` sent a wake message now or after
    `wake_after_seconds`.
  - **The wake.** Its first line is `[idle-recovery: automatic wake]`, then the classifier's
    `next_step`. It goes through the app's normal send. A chat gets at most
    `forkIdleSweepMaxWakes` (2) wakes in a row; a turn you start gives them back. Only a turn
    you asked for (or an earlier wake of one) is woken, never one orchestration or an automation
    asked for. A wake is held, and asked again each sweep, while the chat has background work
    or a scheduled wake-up of its own, or is a coordinator with open dispatches. At the cap, or
    when a wake is not allowed, the chat stays in the inbox as stalled.
  - **Never typed over.** A native chat is woken only while its agent is loaded and not in a
    turn, checked again inside the send; the message is queued, never steered into a turn, and
    a draft in the composer is untouched. A terminal agent is woken only when its terminal is
    live, the agent (not a shell) reads it, no turn runs, no dialog or prompt is up and the
    composer on screen is empty, checked again right before the first write. The stock terminal
    send pastes and presses Enter without looking for a draft, which would submit your
    half-typed text with the wake, so idle recovery reads the screen itself. A terminal it
    cannot read is not woken, and neither is one you typed into after its turn ended (the
    screen reader knows only some agents' composers). A wake that was not sent is tried again after the idle window and
    the chat stays listed as stalled. A send that failed after it may have arrived counts as
    sent, so a wake is never sent twice.
  - **Hooks.** A wake reaches the agent as an ordinary user prompt. An agent's own Stop or
    prompt hook can tell it from your turn only by that first line.
  - **State.** `fork-idle-recovery.json` in the app's data folder, written atomically when a
    sweep or an answer changed it: per chat the fingerprint, verdict, question, next step,
    wakes, next wake or look, and what the inbox shows. The wake count survives a restart. A
    chat not idle for 7 days is forgotten.
  - **Decision inbox.** A sidebar toolbar button with a count, a dialog and palette entries
    (all absent while the mode is off). Each row shows the question or the reason, how long
    ago, and the wakes so far, with Go to chat, an answer box and Pause. An answer is sent to
    the chat as your message and clears the row; on a stalled row it tells the agent how to go
    on. Pause leaves a chat alone (Settings lists paused chats to resume). A row that was
    listed when it was paused stays, frozen, under Paused, and is not counted on the button or
    in `orca inbox list`'s total.
  - **Notifications.** When a chat starts waiting on you, each target that is set is told
    once: a desktop notification (`forkInboxNotifyDesktop`), a POST of the items as JSON
    (`forkInboxNotifyWebhookUrl`), and a command given the same JSON on stdin
    (`forkInboxNotifyCommand`). All off by default. A failing target stops nothing else.
  - **Bot asks (SLRM-2453).** The items a bot set to Needs you (upstream's own rule: Needs you,
    not stale, not snoozed; the "N needs you" on the bot's row and the WAITING ON YOU cards on its
    Home tab) are listed under "Bot asks", from this computer and every paired server whose bots
    the sidebar lists, oldest first. `forkInboxBotAsks` (on) turns it on, whatever idle
    recovery's mode; with it off nothing is read. Only bots whose host counts Needs you items are
    read (`bots.items.owner.list`), again when their items change or the count moves.
    - **Open.** Every ask has Open, which shows the item on its bot's Home tab, where upstream's
      quick replies and comment box answer it. (Until 1.4.267 an ask with decisions also had Answer,
      which drew upstream's question card in the row; upstream removed that card in 1.4.268.)
    - **Counted.** The inbox button's waiting count includes them, and the button and dialog show
      while one waits even when idle recovery and the board are off.
    - **Told once.** Each window reports the asks it reads to the main process, which tells the
      notify targets above of each new one once: the same desktop, webhook and command targets
      and payload shape (`count`, `items` with `id`, `title`, `kind` `bot-ask`, `question`). An
      ask is its host, bot, item and question event, so a new question on the same item is new.
      Told asks are kept in `fork-bot-asks.json` (mode 0600) in the data folder, so a second
      window, a re-read or a restart never tells one again; an ask not seen for a week is
      forgotten. The first report after the feature is on tells every ask then waiting.
    - **Focus.** The fork's notifier shows its banner whatever upstream's
      `notifications.suppressWhenFocused` says, like a chat that starts waiting; the banner is left
      out only when the reporting window is focused and shows the ask (the open inbox, or the
      ask's bot on the Home tab). The webhook, command and phone still run.
    - **Phone.** With `forkInboxBotAsksPhone` (on) and the app's notifications on, each new ask is
      pushed to the phones paired with this desktop through upstream's owner notice (the push a
      bot's failed run uses). Upstream itself sends nothing when an item turns Needs you: its
      `agentNeedsInput` and bot notices cover the bot's chats and runs, not items.
    - Code is in `src/shared/fork/inbox-bot-asks.ts`, `src/main/fork/bot-asks/` and
      `src/renderer/src/fork/bot-asks/`.
  - **Bot row jumps to its ask (SLRM-2472).** Clicking a bot's sidebar row while its host counts
    items waiting on you (the row's "N needs you") opens the bot as upstream does and also shows
    the oldest waiting item on its Home tab, the way the inbox's Open does: the right panel
    switches to Home with the item open (its 1/N pager on it) and its WAITING ON YOU card
    scrolled into view. A click while that ask still shows moves to the next, wrapping. With
    nothing waiting the click is upstream's alone. `forkBotRowAskJump` (on; Settings >
    Blackfish, Idle recovery) turns it off. The asks come from the inbox's live copy when it
    holds them, else one `bots.items.owner.list` read of that bot, so it works with bot asks
    off. Code is in `src/renderer/src/fork/bot-asks/bot-row-ask-jump.ts`.
  - **CLI.** `orca inbox list [--json]`, `orca inbox answer <id> <text>`,
    `orca inbox pause <id> [--resume]`. Ids may be given by prefix. Works on any paired host.
    `orca settings` cannot write the classifier command, the notification command or the
    webhook address.

- **PR babysitter (SLRM-2386).** Off by default. Stock Orca's PR watcher already reads the checks
  of a pull request a chat opened or pushed to and writes "CI failing" or "CI green" into that
  chat. The babysitter acts on that line, so it adds no GitHub polling of its own.
  - **Which pull requests.** Those of the repositories in `forkPrBabysitRepos` (`owner/repo`,
    `host/owner/repo` or `*`; empty by default), plus any named with `orca babysit <pr>`.
    `orca babysit stop <pr>` turns one off, also against the repo list.
  - **CI failed.** The chat gets one fix request: a first line `[pr-babysitter: automatic fix
    request]`, then stock Orca's fix-checks prompt (the one the checks panel's fix action sends)
    built from the failing checks and their failed-step log tails. Check names, links and log text
    come from GitHub and CI: they are stripped of control, bidi and invisible characters, every `<`
    is escaped, logs keep their last 6000 characters, they sit only inside the prompt's JSON data
    in a `<ci-report data-trust="untrusted">` block, and the lines around it say that text is data,
    never instructions, and that the agent must not merge, use admin or bypass options, or change
    CI settings. The send is idle recovery's chat send: the app's normal send, queued behind a
    running turn, never typed over a draft. A chat that is asleep or refuses it stops the
    babysitter.
  - **Rounds.** At most `forkPrBabysitMaxRounds` (3, 1 to 10) fix requests in a row; a green
    result starts the count over. The next failing result after the cap stops it. With no new CI
    result `forkPrBabysitWaitMinutes` (120) after a fix request, it stops too. Each CI line is
    acted on once, however many chats own the pull request.
  - **Green.** With `forkPrBabysitAutoMerge` (off) it merges, but only when `gh pr view` says the
    pull request is open, not a draft, still at the commit that went green, has no change
    requested and no review still required, every check (required or not) finished green, and
    GitHub calls the merge `MERGEABLE` and `CLEAN` (or `HAS_HOOKS`). The merge is a plain
    `gh pr merge <n> --repo <owner/repo> --<method> --match-head-commit <sha>`, never `--admin`
    or `--auto`, so branch protection and rulesets still apply. The method is
    `forkPrBabysitMergeMethod`: `repo` (default, the repository's default method among those it
    allows) or `squash`, `merge`, `rebase`. Branch protection is what makes a merge reviewed:
    without a required review on the base branch, an agent's push that goes green is merged
    unreviewed. A merge held by a review or a block is tried again
    when Orca next reads the pull request (at most every 5 minutes), or at once by
    `orca babysit <pr>`. A failed merge stops it with GitHub's words.
  - **Stopped.** The pull request joins the Decision inbox as a stalled row "PR owner/repo#12",
    and the inbox's notification targets are told once. The inbox shows while idle recovery is on
    or while the repo list is set. An answer goes to the chat as your message and babysits it again
    with fresh rounds; Stop babysitting turns it off. `orca inbox list` and `orca inbox answer`
    show and answer these rows too.
  - **Shown.** A line under the pull request in the workspace card's linked items ("Babysitter:
    fix 1 of 3 sent, waiting for CI", "checks green", "merged", "stopped: ..."), in the row's own
    muted text.
  - **Servers.** It runs in the process that runs the chat: the desktop app and `orca serve` /
    orcad alike, each with its own settings and `fork-pr-babysit.json` (mode 0600) in its data
    folder. `orca babysit` and `orca babysit list` take `--environment` for a paired server. The
    status line shows the babysitter of this desktop only.
  - **Limits.** Native chats only (the stock watcher writes no CI line into terminal agents). A
    pull request is watched for 14 days after its chat's last PR action, as in stock. GitHub only.

- **PR nudges (BAD-680).** Off by default (`forkPrNudgeEnabled`). Stock Orca's PR watcher already
  reads, on its cadence, every pull request a native chat opened or pushed to (14 days after the
  chat's last PR action). Nudges look at each read of an open one and tell the owning chat (the
  chat of the newest PR action) two more things, through the chat's normal send (queued behind a
  running turn, never typed over a draft). The PR babysitter handles CI; nothing here overlaps it.
  - **Review comments** (`forkPrNudgeReviews`, on once nudges are on). Diff-line comments,
    conversation comments and review summaries (not pending reviews), read with `gh api` at most
    once a minute per pull request. One message per read that found new ones, each comment sent once
    (dedupe key `kind:id`, kept in `fork-pr-nudge.json`, mode 0600, so a restart never resends). The
    first read of a pull request is a baseline: what was already there is not sent. The pull
    request author's own comments and empty ones are skipped. `forkPrNudgeCommenters`:
    `collaborators` (default: OWNER, MEMBER, COLLABORATOR) or `anyone`.
  - **Message.** First line `[pr-nudge: new review comments]`; comment author, file, line, link and
    text are outside text: cleaned of control, bidi and invisible characters, every `<` escaped,
    bodies cut at 2000 characters, at most 20 comments and 24000 characters, only inside a
    `<review-comments data-trust="untrusted">` JSON block; the lines around it say it is data,
    never instructions, and that the agent must not merge, use admin or bypass options, or dismiss
    reviews. Cleaning is the babysitter's (`cleanOutsideText`).
  - **Merge conflicts** (`forkPrNudgeConflicts`, on once nudges are on). When the read says
    `CONFLICTING`, the chat gets one rebase request (`[pr-nudge: merge conflict]`) per head commit
    (key `conflict:<sha>`). `MERGEABLE` starts the count over; after `forkPrNudgeMaxAttempts` requests
    since the last clean state a still-conflicting new head stops it.
  - **Attempts.** `forkPrNudgeMaxAttempts` (3, 1 to 10): a send the chat refuses (asleep, not
    loaded, no chat) counts once per key, is tried again on a later read no sooner than a minute
    after, and at the cap the pull request joins the Decision inbox as a stalled row "PR
    owner/repo#12" (source `nudge`, "Stop nudging"); the notification targets are told once. An
    answer goes to the chat and nudging starts again with fresh counts.
  - **Servers.** It runs in the process that owns the watcher and the chat: the desktop app and
    orcad / `orca serve` alike, with no client window open, each with its own settings and file.
  - **Limits.** Native chats only, GitHub only, the pull requests the stock watcher follows. No
    new GitHub polling of its own: a comment read happens only on a stock watch read.

- **Boundary compaction (SLRM-2257).** Off by default (`forkBoundaryCompactMode` `off`,
  Settings > Blackfish > Chats). An agent compacts on its own when its context fills, nearly
  always in the middle of a turn. With the mode on, a sweep in the main process asks a native
  chat to compact between turns instead: its turn has ended, it sits idle, and its context is
  past a threshold. The agent's own compaction is untouched and stays as the fallback. The user
  guide is [docs/fork/boundary-compaction.md](docs/fork/boundary-compaction.md).
  - **Off.** No chat is read, nothing is sent and no window reports anything; the timer only
    reads the setting and backs off to every 2 minutes.
  - **When.** The context measured by the chat's last finished turn is at least
    `forkBoundaryCompactThresholdTokens` (120000) and the chat has rested
    `forkBoundaryCompactIdleSeconds` (120). With `forkBoundaryCompactPreferCold` (on) it also
    waits until its prompt cache has expired, or `forkBoundaryCompactMaxWaitMinutes` (20) of
    rest, whichever comes first. The cache lifetime is the one the usage ledger knows for the
    chat, else `forkCacheWindowMinutes`.
  - **Never.** A chat that is working, waits on a prompt, has background work or children,
    sleeps, is paused for idle recovery (`forkIdleSweepPaused`, read even with idle recovery
    off), holds a queued message, has text or an image in its message box, or already had a
    command since its last request. No chat at all while no window has reported its message
    boxes. One attempt per turn ending, whatever its outcome.
  - **On a server (SLRM-2307).** A host that runs without the desktop app (`orca serve`) runs
    the same sweep over the chats whose agent runs there, read from the server's own settings
    (`orca settings set forkBoundaryCompactMode on --environment NAME`). It has no window, so
    it does not wait for a report of the message boxes: a draft typed in a paired client is
    not seen, and such a chat can be compacted once it has rested. It has no usage ledger, so
    the cache lifetime is `forkCacheWindowMinutes`.
  - **How.** The host's own conversation command, the one the composer's `/compact` uses, sent
    without a delivery mode so a chat that got busy refuses it instead of queueing it. The row
    is labelled "Automatic compaction between turns" in the transcript. Idle recovery skips
    command entries, so the ending it judged does not change.
  - **Which chats.** Native chats whose agent declares `compact` (Claude, Codex, Pi, ACP agents
    that declare compaction), run by the desktop app. Not terminal agents, and not chats run by
    the headless server.

- **Auto-continue filter (BAD-560).** Upstream's launch continuation (`nativeChatResumeWorkOnRestart`,
  on by default) continues every chat a restart or update cut, up to 3 times in 5 minutes, and never
  a turn waiting on a person. The fork adds one filter: only orchestration workers with an open
  dispatch and the chats of automation runs carry on by themselves. A person's own chat keeps
  the restart offer and waits, unless `forkAutoContinueInteractive` is on (Settings > Blackfish >
  Chats, "Continue my chats too"; unset is off; `orca settings` cannot write it, kind
  `agent-limit`, because it answers the restart offer for the person). It replaces the earlier
  fork pass (SLRM-2268, SLRM-2411), which upstream's recovery made redundant; the old
  `forkUnattendedResume*` settings are gone and a leftover value is ignored. Runs wherever the
  chat host runs: the desktop app and the headless server.
  - Code is in `src/shared/fork/auto-continue.ts`, `src/main/fork/auto-continue/` and
    `src/renderer/src/fork/auto-continue/`.

- **Limit resume (SLRM-2309).** On by default (`forkLimitResume`, Settings > Blackfish > Chats).
  A Claude or Codex chat or terminal agent that stops on its 5-hour or weekly usage limit waits
  for the reset and is then told to go on, so work left running overnight is not stuck until
  someone types again. The idea comes from T3 Code (MIT); only the idea is ported.
  - **Native chats.** Stock Orca already detects the stop (Claude's `rate_limit_event` and
    `usage_limit_reached`, Codex's `usageLimitExceeded`), parks the chat with its reset and sends
    "Continue where you left off." at the reset, behind Settings > Chat's toggle, which is off by
    default. The fork turns that on whenever `forkLimitResume` is on (the stock toggle still turns
    it on by itself), caps its chain at `forkLimitResumeMaxTries` (stock counts at most 5), and
    holds a chat whose message box has text (`forkLimitResumeHoldWhileTyping`), from the same
    window report boundary compaction reads. With no reset known, stock waits for the account's
    usage to show room. Only chats with an open tab are continued, as in stock.
  - **Terminal agents** (`forkLimitResumeTerminals`, on). Every 30 s, the bottom 24 lines of the
    screen of each Claude Code and Codex terminal agent on this host that is not working (or has
    reported nothing for 2 min) are read for a limit line:
    - Claude Code: `You've hit your (session|weekly|Opus|Sonnet|5-hour) limit`,
      `(5-hour|session|weekly|Opus|Sonnet|usage) limit reached`, with `resets <time>` or
      `reset at <time>` and an optional `(Area/City)` zone. `continuing automatically at <time>`
      is Claude Code's own auto-continue, which is left to it; `wrapping up` is skipped.
    - Codex: `You've hit your usage limit` with `try again at <time>` or `try again in <N hours
      M minutes>`.
    - Times read: `3pm`, `3:45 PM`, `14:30`, `Mon 12:00am`, `Oct 9, 2pm`, `Jan 1st, 2027 1:00 PM`,
      `2026-08-09 00:00 UTC`. A clock time already past is tomorrow. A limit no clock lifts
      (a spend limit, a budget, credits, `Request a limit increase`) is left alone.
    - The agent is told `forkLimitResumeMessage` ("continue") at the reset plus
      `forkLimitResumeDelaySeconds` (60). With no reset printed, after `forkLimitResumeBackoffMinutes`
      (30), doubling with each resume in the streak, up to 6 hours.
    - The send is idle recovery's: only when the agent (not a shell) reads the terminal, no turn
      runs, no dialog is up and its prompt is empty, checked again right before the write. With
      `forkLimitResumeHoldWhileTyping`, keys typed there since the stop hold it too.
    - The same stop on screen is never answered twice: the answered line and how often it shows
      are kept. A streak of at most `forkLimitResumeMaxTries` (5) resumes, counted before each
      send, ends once the agent works and stops again without a limit. The counts are kept in
      `fork-limit-resume.json` in the data folder (mode 0600), so a restart keeps them.
  - **Codex model-switch menu** (`forkLimitResumeCodexSwitchPrompt`, `dismiss`). Between turns
    Codex may hold its pane on "Approaching rate limits ... Keep current model"; Blackfish presses
    Esc once per appearance, which keeps the model, so the pane does not freeze overnight.
    `leave` turns that off.
  - **Shown.** A parked chat or terminal agent shows "resumes at HH:MM" after its tab title and
    on its sidebar agent row, in the row's muted text; the native chat also keeps stock's line.
  - **Servers.** It runs wherever the agents run: the desktop app and `orca serve` / orcad, each
    with its own settings (`orca settings set forkLimitResume false --environment NAME`). A server
    has no window, so drafts typed in a paired client are not seen there.
  - **CLI.** `orca limits list [--json]`, `orca limits resume-now <id>`, `orca limits cancel <id>`
    (ids or a 4+ character prefix; `--environment` for a paired server). Resume now refuses a busy
    agent or text in its prompt and does not count as a try. `orca settings` cannot write the
    message.
  - Code is in `src/shared/fork/limit-resume*.ts`, `src/main/fork/limit-resume/` and
    `src/renderer/src/fork/limit-resume/`.

- **Usage-limit continue keeps its promise (BAD-707).** A chat that stopped on a usage limit is
  continued at the reset even when someone left text in its message box, and its bot row says so.
  - **Draft hold ends.** Text or an image left in a native chat's message box holds the automatic
    continue only `forkLimitResumeHoldMaxMinutes` (15, 1 to 1440) past the reset, then it is sent
    anyway. Before, a forgotten draft held it for good, and the other mail queued behind the
    failure waited with it. A guard hold (SLRM-2385) still has no end.
  - **Restarts and updates.** The schedule was already derived from the chat's saved turn, so a
    restart or an update keeps it, and a continue time that passed while the app was off (up to a
    day) is sent on the first sweep; tests now cover both.
  - **Mail drains in order.** Once the continue's turn ends, the pause a failed turn puts on
    queued mail lifts and the cards go out oldest first; a test covers it.
  - **Bot row.** A scheduled continue shows "Paused: usage limit, continues at HH:MM" for as long
    as the host publishes it. It used to drop 10 minutes after its time, which left a bare
    "Failed".
- **Chat handoff (SLRM-2391).** On by default (`forkChatHandoff`, Settings > Blackfish > Chats).
  A native chat moves from Claude to Codex or back. The design comes from T3 Code's portable
  handoffs (MIT); only the ideas are ported.
  - **New chat.** A chat of the other agent starts in the same workspace, named after its source
    (`<name> (Codex)`), with the handoff as its first message: the source's name and Orca session
    id, then a budgeted selection of its history, then the request (default: carry on). The
    selection is not a summary: a short chat goes whole; a longer one keeps its original request
    (at most a quarter of the budget) and as many of its newest entries as fit, each in full and
    in order, with tool calls and file edits cut to one line. Only the chat's own agent counts,
    and nothing before its latest `/clear`. Text is charged one token per UTF-8 byte against
    `forkChatHandoffBudgetTokens` (16000, 1024 to 64000); the request is never shortened. A
    newest entry larger than the budget goes cut, with the command that reads it whole.
  - **Older history.** The new agent reads what was left out with `orca chat history <id>
    [--before <n>] [--limit <n>]` (Orca exposes no MCP server to agents; its agent surface is the
    CLI), over `fork.chatHandoff.history`. Entries are numbered by journal sequence, newest page
    first, and a message the page reader shortened is read whole from the journal.
  - **Handing back.** With `forkChatHandoffReuse` (on), handing a chat to the agent the work came
    from continues that earlier chat: it gets only the entries since it last saw this chat,
    queued behind its turn if it is busy. When its context has no room for that (its window, or
    128k when unknown, less what it holds and a reserve of 16k or a quarter of the window), or
    with `--fresh`, a new chat starts instead. Links live in `fork-chat-handoff.json` (mode 0600)
    in the data folder.
  - **The source.** It stays open. A chat mid-turn is refused unless the turn is stopped first
    (the tab menu's toast offers Stop and hand off; `--stop`). Its own resume at a usage limit
    reset (limit resume) is cancelled, so two agents do not take up the same work.
  - **On a usage limit** (`forkChatHandoffOnLimit`): `offer` (default) shows a toast on this
    desktop offering the handoff for each native chat limit resume parks; `auto` hands it off at
    once on the host that runs it, desktop or headless; `off` does neither. Needs limit resume on.
  - **Entry points.** "Hand off to Codex/Claude" in a native chat tab's right-click menu, and
    `orca chat handoff [<id>] --to codex|claude [--message <text>] [--fresh] [--stop] [--focus]
    [--dry-run] [--json]` over `fork.chatHandoff.start` (a paired host with `--environment`).
  - Code is in `src/shared/fork/chat-handoff*.ts`, `src/main/fork/chat-handoff/`,
    `src/cli/fork/chat-handoff-*.ts` and `src/renderer/src/fork/chat-handoff/`.

- **Pooled limits (SLRM-2392).** On by default (`forkPooledLimits`, Settings > Blackfish > Usage
  and accounts). Every Claude and Codex account seen on this machine and its paired servers,
  pooled into one bar per provider and limit window (5-hour and weekly), with the next reset and
  how much of the pool it frees. The idea comes from T3 Code (MIT); only the idea is ported.
  - **Pool.** Each account is an equal share: a window's bar is the mean of its accounts' used
    percent. The next reset is the soonest one still ahead among accounts with usage in that
    window, and it frees the used percent of every account resetting within a minute of it,
    divided by the account count. A reading whose reset has passed counts as unused.
  - **One account, many machines.** Accounts are matched by sign-in email and organization
    (Claude) or ChatGPT account (Codex); a machine that does not know the organization matches by
    email alone, as stock's own login match does. The freshest reading wins and the account lists
    every machine it was seen on.
  - **What crosses the wire.** Each machine answers `fork.limits.machineUsage` from the accounts
    snapshot the usage roster shows: per account a hashed email and organization, the label (the
    account's name or email, as `accounts.list` already shows), the plan and the two windows.
    Never a token, credential or folder path. The desktop checks each answer field by field and
    keeps at most 100 accounts per machine. A server with `forkPooledLimits` off shares nothing.
  - **Servers** (`forkPooledLimitsServers`, on). `fork.limits.usage` asks every paired server
    (4 at a time, 4 s each; 15 s with `--refresh`), as auto placement's probe does. A server that
    does not answer, or runs stock Orca, is named and left out.
  - **Shown.** In the usage popover under the provider rows, in the roster's own row style, for a
    provider with two or more accounts. `/usage-limits` in a native chat opens a dialog with every
    provider, each account and the machines. `orca limits usage [--refresh] [--local] [--json]`
    prints the same.
  - Code is in `src/shared/fork/pooled-limits.ts`, `src/main/fork/pooled-limits/`,
    `src/cli/fork/limits-usage-handler.ts` and `src/renderer/src/fork/pooled-limits/`.

- **Digest (SLRM-2388).** One summary of a time window across this desktop and every paired
  server: what finished and failed, which of your pull requests merged or are open, the estimated
  cost, and what waits on you. The idea comes from Devin's session insights and Warp's run
  records; only the idea is ported.
  - **What is in it.** Per machine: orchestration tasks that completed or failed in the window
    (from its orchestration database, at most 100), your pull requests through the GitHub CLI in
    each local project (`gh pr list --author @me`, merged in the window and every open one; 3
    projects at a time, 15 s each, a project without gh, a login or a GitHub remote is counted in a
    note), the Decision inbox's waiting and stalled chats (SLRM-2196; listed only while idle
    recovery is on, and the digest says so), agents an agent guard paused (SLRM-2385, from
    `fork.guards.list`'s list), and the usage ledger's estimated cost of the local days the window
    touches (SLRM-2104; the desktop only). Paired servers this desktop's server health sees as not
    answering (SLRM-2311) head the list. A pull request two clones list is shown once.
  - **Fan-out.** `fork.digest.collect` reads this machine and asks every paired server for its own
    part (`fork.digest.local`, 4 at a time, 45 s each), as auto placement probes them (SLRM-2266).
    A server that does not answer, or runs stock Orca or an older Blackfish, is named as such.
    Each server's answer is checked row by row (`digest-schema.ts`) before anything shows it.
  - **Window.** `--since` (a duration such as 12h or 2d, or a date and time), else since the last
    daily digest, else the last day; at most 90 days.
  - **Daily digest.** Off by default (`forkDigest`). Once a day after `forkDigestHour` (8, local
    time), or when the app next runs that day, it sends the digest since the last one to the
    Decision inbox's notify targets (SLRM-2208): a desktop notification with the headline
    (`forkDigestDesktop`, unset follows `forkInboxNotifyDesktop`), a POST of JSON to
    `forkInboxNotifyWebhookUrl` (`forkDigestWebhook`, unset on when the address is set) and the
    same JSON on stdin of `forkInboxNotifyCommand` (`forkDigestCommand`, unset on when the command
    is set; `orca settings` cannot write it). The JSON has `event` `digest`, `since`, `until`,
    `headline`, `totals`, `serversDown`, `hosts` and `text`. The send is recorded in
    `fork-digest.json` in the data folder (owner-only) before it goes out, so it never goes twice.
    It runs on the desktop app and on a headless server, each from its own settings.
  - **Pull requests** (`forkDigestPullRequests`, on): off leaves gh alone everywhere.
  - **Where.** `orca digest [--since <when>] [--json]`; "Digest" in the command palette; the
    Digest card in Settings > Blackfish > Usage and accounts (with Show); and Digest in the
    phone's host menu, a screen in the Accounts screen's style.
  - Code is in `src/shared/fork/digest*.ts`, `src/main/fork/digest/`,
    `src/main/runtime/rpc/methods/fork/fork-digest.ts`, `src/cli/fork/digest-*`,
    `src/renderer/src/fork/digest/` and `mobile/src/components/fork/digest/`.

- **Endpoint failover (SLRM-2267).** On by default (`forkEndpointFailover`, Settings >
  Blackfish > Remote servers > Server routes). A saved remote server can be reached on more
  than one address. Stock dials only the saved (or first) endpoint; the fork tries the routes
  in order and uses the first that answers, then moves back to a better one when it answers
  again. The idea comes from T3 Code (MIT); only the idea is ported, none of its code.
  - **Routes.** The saved endpoint, any other saved endpoint of the same server (same host
    key), and the addresses the server reports for itself. They are tried LAN first, then
    Tailscale (100.64.0.0/10), then any other address, then loopback; a saved route goes
    before a learned one of the same kind. Port, path and scheme always come from the saved
    URL.
  - **Learned addresses.** With `forkEndpointLearnAddresses` (on), a connected desktop asks a
    Blackfish server, through the RPC method `fork.endpoints.addresses`, for its current IPv4
    LAN and Tailscale addresses, once every 10 minutes. They are kept in
    `fork-endpoint-routes.json` in the data folder (mode 0600), keyed by server and its host
    public key, so a re-paired server with another key starts empty. Not learned for a `wss:`
    endpoint or a loopback one. A stock Orca server does not have the method, and only its
    saved endpoints are used.
  - **Learned addresses stay near.** With `forkEndpointLearnSameSubnetOnly` (on), a learned
    address is probed only when it shares the /24 of a saved IPv4 endpoint or is a Tailscale
    (100.64.0.0/10) address, so a compromised paired server cannot make the desktop probe other
    machines on its network. Turn it off to probe any learned LAN address. A test
    (`endpoint-failover-probe.test.ts`, loopback only) shows a server answering with a host key
    other than the pinned one is rejected.
  - **When it moves.** A connection down for 10 s probes the routes in order (at most every
    15 s) and moves to the first that answers. While on a worse route, the better ones are
    probed every `forkEndpointFailoverRetrySeconds` (60) and the first that answers wins. A
    better route that answers a probe but drops again within two retry intervals doubles its
    wait, up to 32 times. A probe is its own short-lived socket that finishes the E2EE
    handshake against the pinned host key, so an answer proves it reached the same server.
  - **What a move does.** The picked route lives only in memory; `orca-environments.json` is
    never changed, so stock Orca on shared data and re-pairing see the saved endpoint. The
    desktop closes its connections to that server and opens them again on the new route; its
    subscriptions resubscribe. Terminals and chats keep running on the server. Turning the
    setting off moves every server back to its saved route.
  - **Not covered.** Servers reached through an SSH tunnel, SSH access or an orcad deployment
    keep their own path. The `orca` CLI dials the saved endpoint. IPv6 addresses are not
    learned. There is no relay route.
  - Code is in `src/main/fork/endpoint-failover/` and `src/shared/fork/endpoint-failover*.ts`;
    the server method is `src/main/runtime/rpc/methods/fork/fork-endpoint-addresses.ts`. Three
    one-line upstream hooks: `getPreferredPairedRuntimeConnection` in
    `src/shared/remote-runtime/host-catalog/runtime-environments.ts` dials
    `forkActiveEndpointRoute(...)`, `rpc-method-registry.ts` spreads
    `FORK_ENDPOINT_ADDRESSES_METHODS`, and `src/main/index.ts` calls
    `startForkEndpointFailover`.

- **Server health (SLRM-2311).** On by default (`forkServerHealth`, Settings > Blackfish >
  Remote servers > Server health). A desktop says once when a paired remote server stops
  answering, and once when it is back, with how long it was down.
  - **What it reads.** The endpoint failover supervisor's reading of this desktop's own
    connection to each saved server, every 5 s (also with failover off). No second prober and
    nothing extra on the wire. A server the desktop holds no connection to (disconnected by hand,
    or never opened) is "not watched" and never alerts.
  - **Hysteresis.** The offline alert goes out once a server has not answered for
    `forkServerHealthOfflineMinutes` (5). It is back once it has answered for
    `forkServerHealthRecoverySeconds` (60) in a row; the back alert carries the downtime, from the
    first failed reading to the first answer. A short answer inside a drop does not end it, and
    a drop under the offline time sends nothing, so a flapping server gives one pair of alerts
    per outage. Time the desktop itself slept (readings more than 60 s apart) is not counted.
  - **Targets.** The Decision inbox's (SLRM-2208): a desktop notification, a POST of JSON to
    `forkInboxNotifyWebhookUrl`, the same JSON on stdin of `forkInboxNotifyCommand`. Each has its
    own switch: `forkServerHealthAlertDesktop` (unset follows `forkInboxNotifyDesktop`),
    `forkServerHealthAlertWebhook` and `forkServerHealthAlertCommand` (unset: on when the address
    or command is set). The JSON has `event` (`server-offline` or `server-recovered`), `server`
    (id and name), `downSince`, `lastSeenAt` or `downtimeSeconds`, and `at`. The card shows the
    webhook and command fields too, so they can be set with idle recovery off. `orca settings`
    cannot write `forkServerHealthAlertCommand`, like the command itself.
  - **Status.** The card lists each server with its state and last seen time;
    `orca servers health [--json] [--environment NAME]` prints the same over the RPC method
    `fork.serverHealth.list` (workspace permission, so a paired phone can read it too). Last seen
    times live in memory and start when the app starts.
  - **Heartbeat.** Off by default. With `forkServerHeartbeatUrl` set to an http(s) address
    (no user or password in it), the host calls it every `forkServerHeartbeatSeconds` (60) with
    `forkServerHeartbeatMethod` (`GET`, or `POST` with an empty body), so an outside monitor
    (healthchecks, n8n, Home Assistant) notices when the host stops even while no desktop is
    awake. It runs on the desktop app and on a headless server (`orca serve`); set it on a server
    with `orca settings set forkServerHeartbeatUrl URL --environment NAME`. Nothing about the host
    is sent, redirects are refused, the address is a secret to `orca settings` (never shown,
    exported or returned), and only a change between working and failing is logged, without the
    address. An address that is not valid turns the heartbeat off and the card says so.
  - Code is in `src/shared/fork/server-health.ts`, `src/main/fork/server-health/`,
    `src/main/runtime/rpc/methods/fork/fork-server-health.ts`, `src/cli/fork/server-health-*`
    and `src/renderer/src/fork/server-health/`. The inbox targets' sender is
    `sendForkNotifyTargets` in `idle-recovery-notify.ts`.

- **Server updates (SLRM-2310).** Update every paired server to this desktop's version over the
  server's own connection, with no SSH: `orca servers update (--all | <name>...)`, the Server
  updates card (Settings > Blackfish > Remote servers), or on its own once this desktop starts on
  a new version (`forkServerUpdateAuto`, off by default). `orca servers list` shows each server's
  release version, its orcad build string apart (BUILD), whether it is behind, how it is installed
  and the version kept for a rollback.
  - **Versions.** A server's version is the release of the install it resolved (the app's
    `CFBundleShortVersionString`, or `orcad/out/package.json` of an unpacked Linux server), the
    same one an update checks a download against; without one, the release orcad stamps into
    `ORCA_APP_VERSION` at start-up. orcad's own version is a build string (`0.1.0+<hash>`) that
    does not compare with a release, so it is only reported as `buildVersion`. Behind, current,
    the downgrade rule and the start-up check of a restarted server all use the release.
  - **Which servers.** Servers that `orca serve service install` or dotfiles orca-server set up:
    a LaunchAgent (`com.stablyai.orca.serve*`) running Blackfish from an app bundle, or a systemd
    user unit (`orca-serve*.service`) running an unpacked Linux server's `bin/orca-ide`. The server
    finds its own unit by the profile in its `ORCA_USER_DATA_PATH`, and the install from the
    launcher its command line runs. Anything else (no unit, stock Orca, a folder this user cannot
    replace, Windows) is refused and `orca servers list` says why. A server this desktop deployed
    over SSH (`connectionDependency: ssh-tunnel`) with no such unit is listed as `ssh-managed (use
    orca environment update)`, not as an error, and an update run skips it.
  - **Steps, on the server.** `fork.serverUpdate.apply` (host-admin) downloads the release from its
    own `forkServerUpdateReleasesUrl` (the fork's GitHub releases by default; https only, or http
    on loopback, and every redirect too), into a work folder beside the install
    (`.<install>.fork-update`, 0700, refused unless it is a real folder this user owns). macOS:
    `latest-mac.yml` of that version names the zip and its sha512; the zip is unpacked with
    `ditto`, and must pass `codesign --verify --deep --strict` against the pinned certificate
    (`forkServerUpdateMacCertSha1`, the fork's self-signed one by default, or
    `forkServerUpdateMacTeamId` for a Developer ID) and be `com.saltyfireball.orca` at that
    version. Linux: `orca-server-sha256sums.txt` gives the sha256 of
    `orca-server-linux-<arch>.tar.gz`, which is unpacked with `tar` and must hold `bin/orca-ide`
    and that version. Any failure leaves the install untouched. Then it waits until no turn runs
    (the restart guard's busy chats less those only waiting on a question; terminal agents live
    in the terminal daemon, which a restart keeps), up to `forkServerUpdateTurnWaitMinutes` (30,
    or `--wait <minutes>`, which also takes `--wait=<minutes>`); `--now` skips the wait. It moves the running install to `previous` in the work
    folder, moves the new one in, and starts the watchdog.
  - **Restart and rollback.** A detached `/bin/sh` watchdog (values only as arguments) restarts the
    service (`launchctl kickstart -k gui/<uid>/<label>` or `systemctl --user restart <unit>`) and
    waits `forkServerUpdateReadySeconds` (180) for the new server to write the job's id to
    `fork-server-update.ready` at start-up. If it does not, and `forkServerUpdateAutoRollback` is
    on, it puts `previous` back, keeps the new one as `failed`, clears the supervisor's brake and
    restarts again; the old server then reports the job as rolled back. `orca servers rollback
    <name>` (`fork.serverUpdate.rollback`, host-admin) swaps the install with `previous` by hand,
    so a rollback can itself be rolled back, after checking the work folder and `previous` are
    real folders this user owns and, on macOS, that `previous` still passes the signer pin. One
    version is kept.
  - **Rules.** A version older than the running one is refused without `--allow-downgrade`; the
    same version does nothing. A local build (a version with a suffix) is not a release, so name
    one with `--version`. One update or rollback at a time per server, and one run at a time per
    desktop. `forkServerUpdateAccept` (on) lets a server refuse every request. The release
    address and signer pin are read only from the server's own settings and cannot be set with
    `orca settings` (a write there is code execution); edit the server's settings file.
  - **On the desktop.** `fork.servers.update` starts a run that asks the servers one at a time:
    status, apply, then the server's status until its job is done, failed or rolled back and it
    answers on the new version (while it restarts it does not answer, which is expected). A
    server that fails or does not answer is reported and the next one goes. The CLI and the card
    follow the run with `fork.servers.run`; text from a server is stripped of control characters
    before it prints.
  - **Settings:** `forkServerUpdateAccept` (on), `forkServerUpdateReleasesUrl`,
    `forkServerUpdateMacCertSha1`, `forkServerUpdateMacTeamId`, `forkServerUpdateTurnWaitMinutes`
    (30), `forkServerUpdateReadySeconds` (180), `forkServerUpdateAutoRollback` (on),
    `forkServerUpdateAuto` (off).
  - **Not covered.** A server first has to run a build with this feature: update it once by hand.
    A turn that starts in the moment between the wait and the restart is cut. The Linux tarball
    is checked only against the sums file of the same release (there is no signature), so the
    release address is trusted for Linux servers. Servers reached over
    SSH keep `orca environment update`. Upstream's `updater.*` methods (Electron serve's own
    updater) are left as they are.
  - Code is in `src/shared/fork/server-update*.ts`, `src/main/fork/server-update/`,
    `src/main/runtime/rpc/methods/fork/fork-server-update.ts`, `src/cli/fork/servers-*` and
    `src/renderer/src/fork/server-update/`.

- **Device approval (SLRM-2271).** Off by default (`forkDeviceApproval`, Settings > Blackfish >
  Remote servers > Device approval). A device that pairs with this host waits until it is
  approved, so a leaked pairing link alone does not give access.
  - **Waiting.** A waiting device may only finish its own pairing (`status.get`,
    `runtime.clientCapabilities.update`, ticket exchange, device-key registration). Every other
    call is refused with the error code `device_approval_pending` and a message that shows an
    approval code (`XXXX-XXXX`). Clients keep their pairing and retry.
  - **Approving.** On the host, `orca devices list|approve|deny|revoke`; from another machine,
    the same with `--environment`, or the Device approval card, which lists the devices of this
    computer or of any paired server. Approve and deny take the code, the device id or a unique
    id prefix of 6 or more characters. Deny removes the waiting pairing; revoke removes any
    paired device and whatever was paired through it. The four RPC methods
    (`fork.devices.*`) need host-admin access.
  - **Lineage.** Approval belongs to the pairing a device started from: a re-keyed install or
    a device paired through an approved one is approved with it.
  - **Upgrade.** The first time the host checks a device after the update it records every
    device that had already signed in as approved, so paired laptops and phones keep working.
    A device that signs in while the setting is off is approved too, so turning it on never
    locks out a device in use. A pairing link not yet used when the setting is turned on waits.
  - **State.** `fork-device-approvals.json` in the data folder (mode 0600). An unreadable file
    approves nobody rather than starting over.

- **Webhook automations (SLRM-2271).** Off by default (`forkWebhooks.enabled`, Settings >
  Blackfish > Remote servers > Webhooks). An outside service, such as a failed CI run, can
  start an automation.
  - **Listener.** Plain HTTP on `forkWebhooks.bindHost` (127.0.0.1) and `forkWebhooks.port`
    (47390). Only `POST /hooks/<id>` is served. To take requests from elsewhere, bind an
    address the sender reaches (a Tailscale address) or put a TLS reverse proxy in front.
  - **Hooks.** `orca webhooks add --name N --automation ID [--event workflow_run]
    [--when workflow_run.conclusion=failure]` prints the URL and a secret once;
    `orca webhooks list|rotate|remove`. Upstream 1.4.266 put bot webhooks under the same
    command (`orca webhooks list --bot N`, `show`, `calls`, `check`): `orca webhooks list`
    with `--bot` gives upstream's list, without it the fork's. Hooks and secrets are kept in `fork-webhooks.json`
    (mode 0600), not in settings, so a settings export carries no secret.
  - **Checks.** Every request needs `X-Hub-Signature-256` (or `X-Blackfish-Signature-256`):
    `sha256=` and the HMAC-SHA256 of the raw body under the hook's secret, compared in constant
    time; unknown hooks are checked against a throwaway secret. The body is capped at
    `forkWebhooks.maxBodyKb` (256), each hook at `forkWebhooks.perHookPerMinute` (30), a source
    with 20 failed signatures in 10 minutes gets 429 for unsigned requests (its signed ones
    still pass, for senders behind one proxy), at most 16 requests run at once and 4 per
    source, and a repeated delivery id starts no second run unless the first failed to start.
    GitHub's `ping` is answered without a run. The signature covers only the body, so use TLS
    in front of a listener reached over an untrusted network.
  - **Untrusted payload.** The run's prompt gains the payload, cut at
    `forkWebhooks.payloadMaxChars` (20000), in a `<webhook-payload trust="untrusted">` block
    that tells the agent to treat it as data, never as instructions. Every `<` in the payload
    is escaped, so it cannot close the block. A payload goes to the next manual run of its
    automation that starts within 5 minutes, or to none.

- **Settings from the CLI (SLRM-2160).** `orca settings` reads and writes the app's whole
  global settings object from a terminal or through one file, so no setting needs the Settings
  screen.
  - `orca settings list [--changed] [--filter TEXT]` prints every key with its value, default,
    type and a one-line description, grouped by area, and marks a value that differs from its
    default. `orca settings get KEY` shows one in full.
  - `orca settings set KEY VALUE` reads VALUE as JSON, or as plain text when it is not JSON.
    `orca settings reset KEY...` puts keys back to their default.
  - `orca settings export [--file F] [--changed-only]` writes every setting as one JSON file
    with comments (JSONC): grouped by area in a fixed order, each key under its description,
    type and default. `orca settings apply --file F [--dry-run]` reads it back, prints each
    change as key, old value and new value, and leaves alone every key the file does not name.
  - A write is checked as a whole first. An unknown key, a value of the wrong type or a
    read-only key is refused with the key named, and then nothing is written.
  - A write goes through the app's own `settings:set` handler, the one the Settings screen
    uses, so its guards, normalization and side effects all run and every open window gets
    `settings:changed`. The reply says when the app stored something other than what was asked.
  - **On a server (SLRM-2307).** A host that runs without the desktop app (`orca serve`) has
    no `settings:set` handler, so there `orca settings ... --environment NAME` writes the
    server's own settings store, on disk before the reply, and the store's listeners hear it.
    The value survives a restart and `orca settings get` and `list` show it. The window-free
    rules of the handler still apply (the dropped keys, the network and terminal
    normalizations). Settings only the desktop app acts on are refused by name there: `theme`,
    `appIcon`, `uiLanguage`, `computerAwakeMode`, `keepComputerAwakeWhileAgentsRun`,
    `floatingTerminalCwd` and `forkChatSurvive` (the list is in
    `src/main/fork/settings-cli/settings-cli-headless.ts`). Any other setting is stored; a
    setting of a feature that runs only in the desktop app is stored and does nothing on the
    server.
  - Read-only from the CLI, each with its reason: the keys `settings:set` drops
    (`activeRuntimeEnvironmentId`, `floatingTerminalTrustedCwds`, `antigravityChatAuth`,
    `pluginConsents`, `disabledPlugins`, `pluginExternalHostGrants`);
    `browserPasswordsFillRequiresReauth`, which needs the owner's confirmation; the limits on
    agents that upstream keeps out of its CLI (`nestedWorkerMaxDepth`, `artifactSharingEnabled`,
    `agentSkillSharingEnabled`, `orchestrationCoordinatorApprovalsEnabled`), since agents run
    this CLI; the managed account lists and selections; and the one-time migration markers. The
    lists are in
    `src/shared/fork/settings-catalog/settings-access.ts`.
  - Secrets are never shown, exported or returned over RPC: `opencodeSessionCookie`,
    `httpProxyUrl` (it can hold a user and password) and `agentDefaultEnv` (API keys). They
    show as set or not set and can still be written with `orca settings set`.
  - The catalog (`src/shared/fork/settings-catalog/`) has one entry per key of
    `GlobalSettings`: type, description and area. Its rows are generated from the type and its
    doc comments by `pnpm run generate:fork-settings-catalog`
    (`config/scripts/fork/generate-fork-settings-catalog.mjs`); a key with no doc comment gets
    its description from `config/scripts/fork/settings-catalog-rules.mjs`, which also sorts
    keys into areas. Defaults are read from `getDefaultSettings` when a command runs, not
    stored. The type check fails when a settings key has no row or a row names a key that is
    gone, and `settings-catalog.test.ts` fails when the generated files are out of date or a
    key of the default settings has no entry. After adding or removing a setting, run the
    generator.
  - It adds no setting and nothing on screen.
- **The fork's own Settings pane (SLRM-2228).** Every fork setting that sat at the end of
  Settings > Advanced is in one pane of its own, Settings > Blackfish, listed in the sidebar's
  Advanced group. No setting changed: same keys, same defaults, same controls.
  - Seven sections, each feature in its own card: Chats (chat survive, chat sleep, Sleepers,
    stalled chats, cache-cold cue, boundary compaction, MCP profiles), Agents and workers (child count, state
    colors, finished worker cleanup, agent limit, launch defaults, memory), Idle recovery,
    Usage and accounts (Claude account chip, usage report), Projects (Lost work, Move to host, Branch clashes, Per project),
    Remote servers (server routes, SLRM-2267; server health and heartbeat, SLRM-2311; device approval and webhooks, SLRM-2271; server updates, SLRM-2310) and Sync and updates (fork sync status). A row of section links stays at the top of the
    pane while it scrolls, and each link jumps to its section.
  - Projects are listed once. MCP profiles and Lost work each listed every project, so each
    project showed twice. "Per project" is now the one list: a project is a closed row that
    says what is set for it, and opens to its MCP profile and its Lost work default branch.
    The list has a fixed height and, from 8 projects, a filter.
  - Settings search finds every section and card of the pane and jumps to it (the settings had
    no search entries in Advanced), and the jump palette opens the pane.
  - The custom app theme stays in Settings > Appearance and the sync notice itself in
    Settings > General, About: both belong to the stock controls they sit beside.
  - Code is in `src/renderer/src/fork/settings-pane/`. `fork-settings-pane-catalog.ts` names
    the sections and their search entries, and `ForkSettingsPane.tsx` places the cards: a new
    fork setting is added to both (`ForkSettingsPane.test.tsx` fails when a search entry has
    no card heading to land on).
- **Image files in chat visuals (SLRM-2349).** `::orca-visual` also shows a PNG, JPEG, GIF or
  WebP file from the chat's scratch folder, and takes unquoted values with no space, quote,
  brace or backslash, so a line like `::orca-visual{file=cassie-hair-2324.jpg title="Hair"}`
  shows the picture instead of raw text on desktop, web and the phone. The `.html` path is
  unchanged.
  - The host that runs the chat reads the image under every stock rule (a basename only, no
    traversal or device names, the chat's scratch folder only, no symlinks, the per-message
    cap), up to its own size cap. Only the first bytes decide the type (PNG, JPEG, GIF or WebP;
    the extension is not trusted, and SVG or anything else is refused as `not_text`). It answers
    with a small HTML page that inlines the image as a `data:` URL, so every client shows it
    through the sandboxed visual frame it already has. The revision is the hash of the image.
  - Each process checks its own copy of the setting: the host's for the read (desktop app and
    headless server alike), the window's for parsing replies. The phone parses with the
    fallback on and the host still refuses images when its own setting is off.
  - Settings > Blackfish > Chats > Inline images in chat: `forkVisualFallback` (on) and
    `forkVisualImageMaxMiB` (4, from 1 to 5: a 5 MiB image is about 6.7 MiB as base64, under the
    phone bridge's 8 MiB reply limit).
  - Code is in `src/shared/fork/visual-image-fallback.ts`, `src/main/fork/visual-image/` and
    `src/renderer/src/fork/visual-image/`.
- **Pairing on a pinned bind (SLRM-2264).** `orca serve --bind <ip>` with a real network
  address (a Tailscale or LAN IP) is already reachable there, so laptop and phone pairing use it
  as is. Stock Orca tried to widen it to all interfaces, refused, and failed every pairing with
  `network_exposure_failed`. `runtime-rpc-network-exposure.ts` returns early when
  `isPinnedToNetworkAddress` (`src/shared/fork/pinned-bind-host.ts`) says so; loopback and
  wildcard pins behave as before. Linux servers without the desktop app run the
  server-only tarball, so the fork release carries its own `orca-server-linux-x64.tar.gz`,
  `orca-server-linux-arm64.tar.gz` and `orca-server-sha256sums.txt` (fork-sync's
  orca-server-linux jobs, see How sync works); stock tarballs lack this fix.
- **Worktree move (SLRM-2265).** Move a workspace and its chats to another host: `orca worktree
  move --to <host>` (`local`, `runtime:<environment-id>` or a paired server's name; `--worktree`,
  `--stop-turns`, `--dry-run`, `--json`) or the workspace menu's "Move to Host". The menu lists
  this machine and every paired server except the workspace's own host, and opens a confirm
  dialog that shows the dry run first.
  - **Steps.** The source host reports the workspace (`fork.worktreeMove.inspect`) and the
    shared planner (`src/shared/fork/worktree-move/worktree-move-plan.ts`) refuses, asks or
    plans. Then: the source stops agreed turns and exports the patch and transcripts
    (`fork.worktreeMove.export`); the stock `git.push` pushes the branch; the target's stock
    `worktree.create` checks the pushed branch out (`open-existing-v2`); the target applies the
    patch and files each transcript with its paths rewritten (`fork.worktreeMove.import`); the
    target's `agentSession.create` with `resumeFrom` reopens each chat with its history; and
    the stock `worktree.set` adds `[moved to <host> on <date>]` to the source's comment. The
    runner (`worktree-move-runner.ts`) is shared by the CLI and the desktop; each step runs on
    the host that owns it, so no host reaches another.
  - **Hardening.** A branch or remote from the source's inspect reply that starts with `-`,
    holds whitespace or control characters, or fails `git check-ref-format --branch` rules is
    refused before anything reaches `git worktree add` (`worktree-move-ref.ts`). One move
    carries at most 50 chats and `maxTotalMb` (setting `forkWorktreeMove.maxTotalMb`, default 256) of patch plus transcripts: the planner leaves chats over it behind, the export stops at
    it, and the import refuses the whole request over it before writing, then decodes, writes
    and releases each transcript in turn. The import files a transcript only when its
    `providerSessionId` matches the Claude file stem or the Codex rollout file name. The dialog
    and `--dry-run` say that untracked non-ignored files and full chat transcripts are copied
    (the dry run lists the untracked names), and control characters are stripped from remote
    strings (patch error, saved path, chat names, reasons) before they print or reach a toast.
  - **Never silent.** Nothing is committed: uncommitted changes (tracked and untracked) are
    diffed through a scratch index and carried as a binary patch, and stay on the source too. A
    patch that does not apply is saved in the target's git folder and named in the result. A
    chat mid-turn makes the move ask (or refuse, by setting); the CLI needs `--stop-turns`. The
    source is never reset or deleted. A transcript already at the destination is kept beside it
    as `.before-move-<time>`.
  - **Transcripts.** Claude and Codex chats are carried. A transcript goes where the target's
    adoption looks: Claude under `~/.claude/projects/<target folder bucket>/`, Codex under the
    target's `sessions/` with its dated folders. The workspace path, and the home folder when
    `rewriteHome` is on, are rewritten in both their plain and JSON-escaped spellings, whole
    path names only. Other agents, chats with no conversation and transcripts over 64 MB stay
    behind and are listed.
  - **Refused.** The same host, SSH hosts (no runtime serves them here; pair the machine as an
    Orca server instead), workspaces inside WSL, a detached HEAD, a branch with no remote, and a
    target where the project is not set up.
  - **Settings** (`forkWorktreeMove`, Settings > Blackfish > Projects > Move to host): `menu`
    (on), `whenBusy` (`ask` or `refuse`), `uncommitted` (`patch`, `leave` or `refuse`), `push`
    (on), `chats` (on), `rewriteHome` (on), `markSource` (on).
  - **Hooks in upstream files:** `rpc-method-registry.ts` spreads
    `FORK_WORKTREE_MOVE_METHODS`; `src/cli/specs/index.ts` spreads
    `FORK_WORKTREE_MOVE_COMMAND_SPECS`; `fork-handler-groups.ts` lists the `worktree move`
    group; `fork-global-settings.ts` declares the setting; `WorktreeContextMenuView.tsx`
    renders `ForkMoveWorktreeMenuItem`; `ForkRootHosts.tsx` mounts the dialog host and
    `ForkSettingsPane.tsx` and `fork-settings-pane-catalog.ts` place the card. The RPC params
    catalog and the settings catalog are regenerated.
  - **Not covered yet:** Claude projects whose bucket name is hashed (folders over 200
    characters); a target that already has a stale local branch of that name checks that one
    out; chats of other agents.

- **Auto placement (SLRM-2266).** `orchestration worker-start --on auto` and
  `worktree create --host auto` start the work on the machine (this one or a paired server)
  with the most spare CPU and memory. `orca placement [--repo <selector>] [--project <p>]` shows
  the ranking.
  - Each machine has a placement setting in Settings > Blackfish > Agents and workers, Auto
    placement: prefer, normal (the default), less often or manual only (`forkPlacement`, keyed
    `local` or `runtime:<id>`). A manual only machine is never picked, only named. The score is
    the mean of spare cores and free memory, each against the best machine, times 1.5, 1 or 0.5.
  - Each machine answers a cheap load probe, `fork.placement.load` (cpu count, 1 minute load
    average, free memory; on macOS free memory counts inactive and purgeable pages from
    `vm_stat`). A paired server that does not answer within 2.5 seconds, or runs stock Orca, is
    skipped, and with `--repo` so is one where the repo does not resolve. SSH targets have no
    probe and are skipped. Windows reports no load average, so only memory and cores count there.
  - `--on auto` needs `--worktree new-child` or `new-top-level` and `--repo`; `--host auto`
    needs `--project` and picks among the machines the project is set up on. Project setups are
    kept per Orca, so the pick sends the project to every paired server's load probe and each
    says whether it has a ready setup of its own (host `local` there); machines this Orca lists
    a ready setup for count as set up. A server without one, or too old to say, is skipped as
    "no ready setup". A remote pick runs as `--host runtime:<id>` would.
  - The stderr note names the pick once, then each other machine as "not picked".
  - Off by default: `forkPlacementAutoWhenUnnamed` also places a start that names no machine (a
    worker in a new worktree with `--repo` and no remote selected, or a worktree create for a
    project set up on two or more machines, or only on a paired server). A failed pick then
    falls back to stock behavior.
  - The pick happens in the CLI before stock routing: it rewrites `--on` or `--host` and prints
    the pick and the skipped machines on stderr. Stock worker-start and host resolution are not
    edited.
- **Batch start (SLRM-2395).** Send prompt after prompt from the new-workspace composer, on the
  desktop and the phone; each prompt becomes one worktree plus agent per chosen model. Ideas from
  Conductor's "create more" switch and T3 Code's start-in-the-background and multi-model pick.
  - A Batch switch under the composer's title (desktop) or under Project and Run target (phone)
    swaps the single-workspace form for the batch box: project, prompt, models (multi-select, at
    most 6, one task each), Auto machine and Keep open. The composer's own project and run target
    are reused; switching Batch off brings the stock form back as it was.
  - Each prompt goes to `fork.batchStart.start`. With Auto machine on, the desktop (or the phone's
    paired desktop) ranks itself and its paired servers as `--host auto` does (SLRM-2266) and runs
    the batch there; a picked server gets the batch forwarded and resolves the project against its
    own setups. Off, the composer's run target takes it (a paired server over its own RPC). Every
    model starts through `agent.launch` with a new worktree, so the agent launch queue (SLRM-2098)
    gates it like any launch.
  - A prompt is acknowledged before the box clears: the answer names the machine and each
    worktree, with its queue place when it waits. Anything that failed stays in the box with the
    failed models still picked, so sending again starts no duplicates. Started prompts are listed
    under the box.
  - Start follows Keep open (clear for the next prompt, or close the composer once acknowledged);
    Cmd+Enter (Ctrl+Enter elsewhere) always starts in the background and leaves a fresh draft.
  - Worktree names are the prompt's first words, the agent and a random tail; the display name is
    the prompt's first line. Folder (non-git) projects and folder workspaces are not offered.
  - Settings > Blackfish > Agents and workers, Batch start: `forkBatchStart` (show the switch, on),
    `forkBatchStartKeepOpen` (on), `forkBatchStartAutoHost` (on) and `forkBatchStartSetupMissing`
    (off, SLRM-2406). The phone reads its paired host's values.
  - With `forkBatchStartSetupMissing` on, Auto machine asks the pick with `setupMissing`, as
    `--host auto --setup-missing` does (SLRM-2406): a paired server that lacks the project but can
    clone it ranks with the others. When one is picked, the desktop sets it up first through
    `fork.serverSetup.run` (clone, register, readiness), then forwards the batch; the answer's
    `setupNote` leads the acknowledgement ("Set up on SERVER: cloned into PATH. Missing: ...").
    A failed setup starts nothing. Clients wait the clone and readiness time on top of the batch
    wait when they ask for it.
  - Not covered: a picked server running stock Orca or an older Blackfish refuses (turn Auto
    machine off to use the run target); the stock form's linked items, base branch, setup choice
    and attachments do not apply to batch prompts.
- **Set up on a server (SLRM-2312).** New work can start on a paired server that lacks the
  project: the server clones it from the project's git remote with its own git credentials,
  registers it, and says what it lacks to build it.
  - The desktop new-workspace host picker lists "Set up on SERVER..." after the host rows, one per
    paired server shown as lacking the project and able to take a location now (connected, new
    enough). It is offered when the project has a git remote that passes the URL check below.
    Choosing it keeps the picker open: the row shows "Choosing a folder...", "Cloning into
    PATH..." and "Checking what the project needs...", then the server is selected and a toast
    lists what is missing. A failure stays on the row and in a toast; nothing is selected.
  - The steps are stock calls plus two fork ones on the server: `fork.serverSetup.plan` expands
    the folder setting there (`~` is the server's home), names the clone folder from the URL and
    refuses a folder that already exists (Set project location picks an existing one); the store's
    stock `setupProjectClone` runs `repo.clone` and `projectHostSetup.setupExistingFolder`; then
    `fork.serverSetup.readiness` runs the stock environment doctor on the checkout (tools that
    package.json, Cargo.toml, go.mod and similar files need) and reads its `.envrc`: direnv
    missing, or a `use NAME` whose `use_NAME` function is in no direnvrc or `lib/*.sh` of the
    server, is listed as missing; other `use` lines are listed as notes.
  - Clone URLs: https, http, ssh, git and scp-like `user@host:path` only. Local paths, `file://`,
    `<transport>::` remote helpers (`ext::`), a password in the URL, a leading dash, whitespace and
    control characters are refused, by the desktop and again by the server. Stock `repo.clone`
    passes the URL after `--`.
  - CLI: `worktree create --project <p> --host auto --setup-missing` lets the pick include paired
    servers that lack the project but can clone it (their load probe answers `canSetUp` when
    asked); the ranking marks them "project will be set up here first", on the same footing as
    the others. If one is picked, this machine's Orca sets it up (`fork.serverSetup.run`, the same
    plan, clone, register and readiness calls over the paired-server link) before the create
    goes there, and the result and readiness go to stderr. `--host runtime:<id> --setup-missing`
    sets that server up first when it lacks the project. `orca placement --project <p>
    --setup-missing` shows the ranking. This machine is never cloned onto by a pick.
  - Settings > Blackfish > Projects, Set up on a server: offer the picker rows
    (`forkServerSetupOffer`, on by default), the folder to clone into (`forkServerSetupParent`,
    default `~/development`) and the readiness check (`forkServerSetupReadiness`, on by default).
  - Phone (SLRM-2406): the new-workspace sheet's Run on list adds "Set up on SERVER..." rows after
    its run targets, one per paired server the phone reaches whose own repo list has answered
    without the project, when the paired host's `forkServerSetupOffer` is on and the project's
    remote passes the URL check. Picking one runs the same flow with typed mobile operations:
    `fork.serverSetup.plan` on the server (through the desktop relay), `fork.serverSetup.run` on
    the paired desktop with `skipReadiness` (it clones and registers over its own link), then
    `fork.serverSetup.readiness` on the server when `forkServerSetupReadiness` is on. A "Set up on
    a server" group under Project and Run on shows each stage, the outcome line and any failure in
    red text (no Alert, which does nothing in the web session); once the server's list shows the
    new repo, it is picked as the run target.
  - Batch start's Auto machine can set a server up first too; see Batch start (SLRM-2406).
  - **Not covered yet:** a server too old to answer `fork.serverSetup.plan` gets a message to
    update it or use Set project location; a paired desktop too old for the phone's run call gets
    a message to update it.
- **Fast new worktrees on macOS (SLRM-2270).** APFS copy-on-write clones for new local worktrees
  (Settings > Blackfish > Projects, "Fast new worktrees (macOS)"). Idea from T3 Code's "Fast
  worktree checkout" (MIT). Other systems, WSL and other volumes create worktrees as before.
  - `forkApfsCloneFolders` (default `node_modules`): git-ignored folders cloned from the
    project's own checkout into the new worktree with one clonefile(2) call each, before the
    setup script runs. Skipped when the worktree already has the path, Git does not ignore it
    there, the source leaves the project, or relative links in it would point elsewhere from
    the worktree (pnpm's store links when the worktree sits at another depth). Hooked after the
    worktree add in `runtime-local-git-worktree-create.ts` and `ipc/worktrees/worktree-remote.ts`.
  - `forkApfsCloneCheckout` (off by default): `addWorktree` adds with `--no-checkout`, a cached
    checkout in `<git common dir>/blackfish-clone-cache` is moved to the new commit with a
    two-tree `read-tree -m -u`, cloned whole and moved in, and its index copied. The index is
    left lazy: on a 37k-file repo the worktree is ready in about 0.5 s instead of 3 s, but the
    first `git status` refreshes every stat (about 4 s instead of 1.3 s), so it pays off for
    worktrees that are made often and inspected rarely. Repositories with a post-checkout hook,
    a sparse checkout, a `filter=` in .gitattributes or any `filter.*` in Git config (which
    `git lfs install` adds globally), a busy cache lock or any failure fall back to
    `git reset --hard HEAD`, a plain checkout.
  - Code is in `src/main/fork/apfs-clone/`; clonefile is called through
    `/usr/bin/osascript -l JavaScript` because Node has no binding for it.

- **Snooze (SLRM-2269).** Snooze a workspace or a chat out of the sidebar until a time, until
  its pull request merges, or until it has sat idle for some days. Idea from T3 Code's thread
  sidebar (MIT). The settings are in Settings > Blackfish > Projects, "Snooze".
  - "Snooze..." in the workspace menu and in a right-click menu on sidebar agent rows (chats and
    terminal agents): 1 hour, this evening, tomorrow morning, next Monday morning, until its pull
    request merges, until idle for N days, or Custom... (a date and time). A snoozed workspace
    shows "Wake" in its menu instead.
  - Snoozed items leave their place in the list (workspaces from the workspace list, chats from
    their card) and gather in a collapsed "Snoozed (N)" row at the bottom of the sidebar, built
    from the Hidden projects section's row styles. Opened, each row shows its wake label ("until
    6pm", "until Mon 9am", "until merge"); a click opens it and Wake ends the snooze. The Agents
    view of the sidebar is not filtered.
  - A snooze ends early when one of its agents waits on an approval, a permission or a question
    (`forkSnoozeWakeOnAttention`), when its agent fails or errors (`forkSnoozeWakeOnFailure`),
    and when the user opens it (`forkSnoozeWakeOnOpen`); all on by default. Only events after the
    snooze count. `forkSnooze` (unset is on) turns the feature off, which shows everything again.
    `forkSnoozeMorningHour` (9), `forkSnoozeEveningHour` (18) and `forkSnoozeIdleDays` (3) set the
    presets.
  - Until merge and until idle settle: when the pull request is merged (the hidden card's review
    is refreshed every 10 minutes) or the item has had no activity for N days, the snooze ends
    and `forkSnoozeSettleCommand` runs once, if set (unset is none). It runs through the system
    shell with the user's rights, from the workspace folder (the home folder for a paired
    server's workspace), with `ORCA_SNOOZE_ID`, `_KIND`, `_REASON`, `_HOST`, `_WORKTREE_ID`,
    `_PANE_KEY`, `_LABEL`, `_PATH` and `_BRANCH` in its environment and the snooze as JSON on
    stdin, for at most 5 minutes. A snooze set over RPC by a paired device settles without it. The
    command is a runs-command setting: `orca settings`
    refuses to write it, and only the desktop window's settle call can start it; no RPC method
    takes or runs a command.
  - The snoozes live where the sidebar lives, in `fork-snooze.json` in userData (owner-only),
    also for workspaces on paired servers, and survive restarts. The window ends snoozes as it
    sees their triggers; main drops a timed snooze when its time comes.
  - CLI: `orca snooze [<workspace selector>|chat:<id>] --until <time|merge|idle:Nd>`
    (`--host runtime:<id>` for a paired server's workspace id), `orca snooze list [--json]` and
    `orca snooze wake <id>`. `--until` also takes durations (90m, 2h, 3d, 1w), evening,
    tomorrow, monday, a clock time and a date and time. The RPC (`fork.snooze.list`, `.set`,
    `.wake`) needs workspace permission, so a paired phone can use it too.
  - Code is in `src/shared/fork/snooze*.ts`, `src/main/fork/snooze/`,
    `src/main/runtime/rpc/methods/fork/fork-snooze.ts`, `src/preload/fork/snooze-bridge.ts`,
    `src/renderer/src/fork/snooze/` and `src/cli/fork/snooze-*`.
- **Best of N (SLRM-2393).** Send one task to 2 to 4 agents, each in its own new worktree, then
  compare the attempts side by side and keep one. Ideas from Codex cloud `--attempts`, Cursor's
  best-of-n and Crystal. The settings are in Settings > Blackfish > Agents and workers, "Best of
  N".
  - Start: `orca best-of <n> (--prompt <text> | --prompt-file <path|->) [--agents
    agent[:model[:effort]],...] [--on auto|here|<server>,...] [--repo <selector>]
    [--base-branch <ref>]`, run from an Orca terminal or chat. Each attempt is a stock supervised
    orchestration worker (`orchestration.workerStart`, `--worktree new-top-level`, named
    `best-of-<tag>-<n>`), kept open, and all attempts share one Run: the first start makes or
    joins the caller's Run and the rest join it in parallel. `--agents` and `--on` are lists
    cycled over the attempts; `auto` asks auto placement (SLRM-2266) for a machine per attempt
    and needs `--repo`, `here` is this machine, anything else is a paired server as worker-start
    `--on` takes it. A start that fails is recorded with its error and the others carry on.
  - Each attempt's prompt is the task plus the attempt note (`forkBestOfAttemptNote`, unset is the
    built-in note), which asks it to work only in its worktree, run the tests and checks that
    apply, commit (not push) and end its report with `Tests:` and `Checks:` lines. The note is a
    runs-command setting: `orca settings` refuses to write it, as it becomes part of every
    attempt's prompt.
  - Compare: "Best of N" in the command palette opens a dialog with one column per attempt: agent
    and model, host, task state, the committed diff against the worktree's create base (files and
    +/- per file, from the owning host's stock `git.branchCompare`) and its uncommitted file
    count (`git.status`), tests and checks as the report states them, the cost (the usage ledger's
    workspace row; native Claude chats on this machine only, else "not counted") and the report
    itself. Open activates the attempt's workspace and opens its committed changes in the stock
    combined diff. `orca best-of list` and `orca best-of show <id>` print the same.
  - Pick: "Keep this one" (or `orca best-of pick <id> --attempt <n> [--losers
    archive|remove|keep]`) keeps the winner and, per `forkBestOfLoserAction` (unset is
    `archive`), archives the other worktrees through the stock `worktree.archive` (checkout
    deleted, branch and workspace row kept), removes them through `worktree.rm` (branch kept), or
    leaves them. Each call goes to the host that owns the worktree; nothing is forced, so a
    worktree with uncommitted changes stays and its column says why. A run is picked once.
  - Runs live in `fork-best-of.json` in userData (owner-only); `forkBestOfHistory` (20) runs are
    kept, and "Forget this run" drops one without touching its worktrees. `forkBestOf` (unset is
    on) refuses new runs when off; `forkBestOfAgents` (`claude`) and `forkBestOfPlacement`
    (`auto`) are the defaults for `--agents` and `--on`.
  - RPC on this machine: `fork.bestOf.record`, `.list`, `.show` (each attempt's worker, task
    report and cost, from the orchestration database and the usage ledger; a worker on a paired
    server is read from its federated record), `.settle` and `.forget`. `.record` refuses a
    worker that is already an attempt of a run, so a pick only reaches the run's own workers.
    None of them starts,
    stops or removes anything; the CLI and the window do that over the stock methods.
  - Code is in `src/shared/fork/best-of/`, `src/main/fork/best-of/`,
    `src/main/runtime/rpc/methods/fork/fork-best-of.ts`, `src/renderer/src/fork/best-of/` and
    `src/cli/fork/best-of-*`.

- **Worktree snapshots (BAD-677).** Removing a worktree with uncommitted, untracked or unpushed
  work was final; bulk flows (worker cleanup, cleanup rules, the lost work dialog) made that easy.
  Now every removal is reversible for two weeks.
  - The shared removal path (`removeWorktree`, which the manual delete, cleanup rules, worker
    cleanup and lost work flows all reach) first asks whether the worktree holds work: changed,
    staged or untracked (not ignored) files, or commits no remote or default branch has (the lost
    work scan's own git checks). If it does, it saves the whole working tree as a commit built
    through a temporary index, so the worktree's own index is not touched, under
    `refs/orca/snapshots/<workspace>/<ms timestamp>` in the project. The commit's parent is the
    branch head, and its message records the path, branch and head. Ignored files (`.env`) are
    left out. `refs/orca` is in no default push or fetch refspec, so snapshots stay on the host.
  - A clean, fully pushed or merged worktree makes no snapshot. A failed-creation rollback makes
    none either.
  - A snapshot that cannot be written stops the removal with the error; a forced delete removes
    anyway and logs a warning.
  - Snapshots older than `forkWorktreeSnapshotRetentionDays` (14 by default, 1 to 365) are
    pruned each time a snapshot is taken, and by `orca worktree snapshots --prune`.
    `forkWorktreeSnapshots` (on by default) turns the feature off.
  - `orca worktree snapshots [--repo R] [--prune]` lists them. `orca worktree restore <id>
    [--repo R] [--path P]` recreates the worktree at its old path (or `--path`) on its branch at
    the head it had, with edits unstaged and new files untracked; a branch name now used at
    another commit gets `<branch>-restored-<ms>`, and an existing path is refused. Restore and
    list run on the host that owns the project through `fork.worktreeSnapshots.*`. Local git
    projects only; a paired server answers for its own.
  - Code: `src/shared/fork/worktree-snapshots.ts`, `src/main/fork/worktree-snapshots/`,
    `src/cli/fork/worktree-snapshots-*.ts`. The tests run real git in a temp repo.

- **Turn checkpoints (BAD-678).** Rewind in stock Orca is a conversation rollback for Claude and
  Codex chats; no agent got its file edits reverted, so one bad unattended turn meant hand git
  work. Now every agent, terminal or chat, gets a file checkpoint per turn that can be diffed and
  restored (Claude Code, Cline, Gemini CLI, OpenCode and Cursor give their own users the same).
  - The host follows the agent status feed (`agentHookServer.subscribeEnrichedStatus`), which
    carries terminal agents' turns (hooks, OSC 7501) and native chats' alike. A workspace's first
    turn start takes a `baseline`; each turn end takes a `turn` checkpoint when the files differ
    from the newest one, and none otherwise. Capture runs after the turn ended, off its path, and
    one workspace's captures and restores run one at a time.
  - A checkpoint is a commit of the whole working tree (tracked changes and untracked files,
    never ignored ones, so `.env` stays out) in a shadow bare repository under the data folder
    (`fork-turn-checkpoints/<hash>.git`, user-only permissions, never pushed) with its own index,
    so a later snapshot only rereads files whose stat changed. The project's own `.git` (index,
    refs, stash, objects) is never touched, and a folder workspace with no git works the same. The
    project's `info/exclude` is honoured. New files over `forkTurnCheckpointMaxFileMb` (5) are
    measured before git reads them and left out. Folders that are a home folder or a drive root are
    skipped. Embedded git repositories inside a workspace are recorded as a pointer, not content.
  - `orca checkpoint list|diff|restore|undo [--worktree S]`. `diff <id>` shows what the turn
    changed against the checkpoint before it, and leaves out files a merge, pull, checkout, rebase
    or reset brought in (read from the project's HEAD reflog since the previous checkpoint) and
    counts them; `--now` compares with the files on disk, `--patch` adds the patch. `restore <id>`
    first takes a `pre-restore` checkpoint of the files as they are (so edits made since the last
    turn are not lost), deletes files the checkpoint lacks, writes the rest back, and records a
    `restore` checkpoint. `undo` restores the state before the latest restore; run again it is a
    redo. Files are written with `checkout-index`, which will not write through a symlinked
    folder, and deletions refuse a path through one.
  - Restore is refused while another agent of this host is `working` or `blocked` in the same
    directory; `--force` overrides (a stale row would otherwise lock the user out).
  - Retention: `forkTurnCheckpointKeep` (50) newest and `forkTurnCheckpointRetentionDays` (7)
    per workspace, pruned (with a `gc`) after each checkpoint; the newest is always kept. A store
    whose newest checkpoint expired is deleted at host start. `forkTurnCheckpoints` (on by default)
    turns the feature off. Checkpoints keep the session id, agent and the start of the prompt, so a
    chat's rewind can be paired with a file restore.
  - Local checkouts only: the RPC (`fork.turnCheckpoints.list|diff|restore|undo`) answers on the
    host that runs the workspace, so a paired server keeps and restores its own; a workspace on an
    SSH host or in a WSL distro is not checkpointed. Not built yet: a Checkpoints list in the chat
    or workspace UI.
  - Measured (2026-11-22, a Mac laptop SSD, 1000 random 1 MB files = 1 GB): the first snapshot
    took 16.9 s, a turn with no change 60 ms, and a turn that rewrote 3 files and added one 177 ms.
    The perf contract test asserts an incremental snapshot of 4000 files stays under 2 s.
  - Code: `src/shared/fork/turn-checkpoints.ts`, `src/main/fork/turn-checkpoints/`,
    `src/main/runtime/rpc/methods/fork/fork-turn-checkpoints.ts` and
    `src/cli/fork/turn-checkpoints-*.ts`. The tests run real git in temp folders.

- **Worktree ports (SLRM-2383).** Each workspace holds a block of ports on the host that runs it,
  so many workers on one machine stop fighting over dev-server ports (Conductor gives each
  workspace 10 ports the same way). Stock Orca only finds ports once something listens on them.
  - The block is reserved the first time a workspace's terminal, native chat or setup script
    starts (a new worktree's setup and first terminal do that during its create), and when the
    create is reported. It is exported as `ORCA_PORT` (the first port), `ORCA_PORT_0` to
    `ORCA_PORT_<n-1>` and `ORCA_PORT_COUNT` to its terminals (so to terminal agents), native
    chats and setup and archive scripts; setup scripts also get `CONDUCTOR_PORT`, the name
    imported Conductor scripts read. WSL terminals and hooks get the same names through
    `WSLENV`. A terminal with no workspace gets none, and stale names a copied env carried are
    dropped.
  - Each host keeps its own reservations in `fork-worktree-ports.json` in its userData
    (owner-only), so they survive restarts: the desktop app for its local and direct SSH
    workspaces, and orcad on a headless server for the workspaces it runs. A block is released
    when the workspace is removed (desktop or server, worktree or folder workspace), and at
    start for a workspace whose project is gone or whose folder on this machine is gone while
    the project folder itself is still there. Nothing is released for what cannot be proven gone.
  - Free ports: once the runtime settles, and after each reserve, a background pass binds every
    port of the next candidate block on `127.0.0.1`, `0.0.0.0` and `::` and keeps the first block
    found free as the spare, which the next reserve takes. Without a spare (several creates at
    once, or a block size change) a reserve takes the first block clear of every reservation and
    of the ports earlier passes found in use. Direct SSH workspaces are checked on this machine,
    not on the SSH host; a server running orcad checks its own ports.
  - Settings (no Settings pane card; `orca settings` edits them): `forkWorktreePorts` (unset is
    on), `forkWorktreePortsCount` (10, from 1 to 100; a change applies to new blocks),
    `forkWorktreePortsFrom` and `forkWorktreePortsTo` (20000 to 29999, below the Linux and macOS
    ephemeral ranges; give two Orca hosts on one machine different ranges). Off, nothing is
    exported or reserved and the blocks already held stay held.
  - CLI: `orca ports` adds a `reserved=20000-20009 (ORCA_PORT=20000, ORCA_PORT_0..9)` line under
    its scan and `--json` adds `reservedPorts` (`enabled`, `start`, `count`, `ports`). It asks
    the host the scan went to over `fork.worktreePorts.get`, which only reads; a host without
    the method leaves the output as stock prints it.
  - Code is in `src/shared/fork/worktree-ports*.ts`, `src/main/fork/worktree-ports/`,
    `src/main/runtime/rpc/methods/fork/fork-worktree-ports.ts` and
    `src/cli/fork/worktree-ports-cli.ts`.
- **Agent guards (SLRM-2385).** Two guards for agents nobody is watching, on the desktop app and
  on a headless server (`orca serve`) alike, each with its own settings (Settings > Blackfish >
  Agents and workers, Agent guards; `orca settings set forkAgentGuardLoop false --environment
  NAME` for a server). Ideas from the archived ccdeck's failure-loop and spend guards and Devin's
  per-session limits; only the ideas are ported.
  - **Failure-loop guard** (`forkAgentGuardLoop`, on). Every finished tool call of a native chat
    (read from its journal every 15 s while it works) and of a terminal agent (from the agent's
    after-tool hook post: Claude Code's PostToolUse and PostToolUseFailure, Codex's and other
    agents') is sorted into a read or wait, a failure or progress. A failure's signature is its
    tool, its input as sorted JSON and its error with colors, ids, hashes, numbers and spacing
    taken out. The rule: failures with the same signature since the last progress are counted;
    reads and waits (`Read`, `Grep`, `ls`, `rg`, `sed -n`, `git status`, `sleep`, `gh pr checks`
    and the like, nothing with a redirect or a write flag) neither count nor clear; any other
    call that works clears every count. When one count reaches `forkAgentGuardLoopRepeats` (6),
    the agent is sent one fixed note to change approach, steered into a chat's running turn or
    typed into a terminal like orchestration mail (never over a dialog or a draft); a note that
    was not delivered is tried again at the next failure. If the same signature fails again in a
    call that finished after the note (`forkAgentGuardLoopPause`, on), the agent is paused: a
    chat's turn is stopped through its host's own cancel (the Stop button's path, which also
    holds its queued messages as Stop does), a Claude Code or Codex terminal gets Esc (never on a
    dialog; an agent it cannot interrupt is marked so). The note never quotes the tool, its input
    or output. The watch is kept in memory: a restart starts a new episode and never replays
    history.
  - **Spend cap** (`forkAgentGuardSpendCapUsd`, 0 = off). The estimate is the usage ledger's
    (SLRM-2103): the chat's tokens per model priced like the usage report (`forkUsagePrices`, else
    the built-in Claude prices), subscription chats at the same per-token prices, a model with
    no price adding nothing. At each turn end (and each 15 s sweep while it rests) a chat whose
    spend since its cap began reached the cap is paused there, between turns. The default cap
    covers orchestration workers (`forkAgentGuardSpendCapScope` `workers`) or every chat (`all`).
    Per dispatch: `orca guards cap <session id> <usd>` gives one chat its own cap, counted from
    then; 0 drops it. The ledger now also runs on a headless server (its own
    `fork-usage-ledger.json`), so caps work there and `orca usage-report --environment NAME`
    answers. Caps now cover more than native Claude chats (BAD-679, "Spend caps for every
    agent" below).
  - **Paused.** A paused agent is held: idle recovery never wakes it, limit resume skips it. A paused chat that starts a turn another agent asked for (orchestration mail)
    is stopped at once; a turn a person starts lifts the pause. A terminal agent stays as the Esc
    left it. Each pause is listed in the Decision inbox under "Paused by a guard", whatever
    `forkIdleSweepMode` is (the inbox button shows while any is listed): an answer sends the
    text and lifts the pause only once the send is taken (a refused send keeps it paused and the
    inbox shows why), Resume lifts it alone; a resumed chat's spend counts from then.
    `forkAgentGuardNotify` (on) tells the inbox's notify targets once per pause, with
    `event: agent-guard-paused` and the reason in the JSON, never tool output.
  - **Shown.** "loop warned", "paused: failure loop" or "paused: spend cap" after the tab title
    and on the sidebar agent row, in the row's muted text, with the reason on hover.
  - **CLI.** `orca guards list [--json]`, `orca guards resume <id>`, `orca guards cap <id> <usd>`
    (ids or a 4+ character prefix; `--environment` for a paired server), over `fork.guards.list`,
    `.resume` and `.cap` (workspace permission). `orca inbox pause <id> --resume` on a guard's row
    resumes it too.
  - **State.** `fork-agent-guards.json` in the data folder (mode 0600): pauses, per-chat caps and
    the spend a resume set aside; a record with nothing left is dropped, any after 30 days.
  - Code is in `src/shared/fork/agent-guards*.ts`, `src/main/fork/agent-guards/`,
    `src/cli/fork/guards-*` and `src/renderer/src/fork/agent-guards/`.
- **Command guards: deny destructive shell commands of agents (BAD-686).** On by default
  (`forkCommandGuards`). Orca's own rules, run in the PreToolUse hook Orca already installs, so
  they travel to every host Orca manages (paired servers too) and sit beside a person's own hooks
  without replacing them: Claude Code runs every PreToolUse hook and any `deny` wins. Ideas from
  Claude Code hooks, Codex execpolicy and Hermes guards; only the ideas are ported.
  - **Not a sandbox.** The guard reads the command text and never runs it. It catches mistakes,
    not an agent set on getting around it (a script written to disk, a tool that is not Bash,
    symlinks, a variable it cannot see through, which it refuses for the delete verbs).
  - **Rules** (`orca command-guards status` lists them):
    `delete-outside-workspace` (`rm`, `rmdir`, `unlink`, `shred`, `rimraf`, `find -delete` and
    `find -exec rm` on a path outside the workspace root; the system temp folders and
    `forkCommandGuardAllowedDeleteRoots` are fine, `forkCommandGuardAllowTempDeletes` turns the
    temp exception off; a path from a variable, `~user`, xargs or an unreadable `cd` is refused),
    `force-push` (`--force`, `-f`, `--force-with-lease`, `--mirror`, a `+refspec`),
    `default-branch-rewrite` (`reset --hard`, `rebase` and `commit --amend` while the default
    branch is checked out; `branch -f/-D/-M`, `checkout -B`, `switch -C`, `update-ref` and
    `push --delete` on it; `filter-branch` and `filter-repo` anywhere. The default branch is the
    repo's `origin/HEAD`, else `main` and `master`, or `forkCommandGuardProtectedBranches`; the
    current branch comes from `.git/HEAD`, so git is never run),
    `remove-worktree` (`git worktree remove`, `orca worktree rm`), `guard-config` (an agent
    changing `forkCommandGuard*` settings or `orca command-guards allow`) and
    `unreadable-command` (unbalanced quotes or nesting too deep, with a verb the guard watches).
    Wrappers are looked through: `sudo`, `env`, `command`, `nohup`, `xargs`, `bash -c`, `eval`,
    `$(...)`, backticks, and `cd` before the call.
  - **Overrides.** `forkCommandGuardDisabledRules` (comma list, every project) and
    `orca command-guards allow|disallow <rule> [--project NAME|PATH|ID]` (per project, kept in
    `forkCommandGuardProjectRules` by project id). All are `orca settings` keys too.
  - **A block.** Claude shows the agent a `deny` with the rule and reason in the chat, and tells
    it not to look for a way around. Each block is one line of the audit list
    (`orca command-guards list`; `forkCommandGuardAuditLimit`, 200 kept) in
    `fork-command-guard-audit.json` in the data folder (mode 0600; commands cut to 400
    characters).
  - **Who is guarded.** Only an agent whose hook script reads Orca's answer: Claude Code on macOS
    and Linux. `orca command-guards status` lists every other hook agent as unguarded (their
    scripts discard the reply; Claude's Windows script, and SSH and WSL hosts, post to a relay
    that cannot answer). Adding an agent means its hook contract allows a deny, a script that
    prints it, and a row in `commandGuardCoverage`.
  - **CLI.** `orca command-guards list|status|allow|disallow` over `fork.commandGuards.*`
    (workspace permission; `--environment` for a paired server).
  - Code is in `src/shared/fork/command-guards*.ts` (rules, shell reader, settings, wire),
    `src/main/fork/command-guards/` and `src/cli/fork/command-guards-*`.
- **Session export: a chat or agent session as Markdown, HTML or JSON, and an unlisted link
  (BAD-688).** `orca agent export <id>` writes the conversation to a file; sharing is a separate,
  explicit step. Idea from Pi's and goose's HTML export and the session sharing of OpenCode and
  Kilo Code; only the idea is ported.
  - **What is read.** A chat from its journal through the page reader every client uses
    (`readChatHandoffRows`, back to the latest `/clear`): its requests and answers in full, each
    tool call or file edit as one line, an earlier handoff message as a note. A terminal agent
    through the same reader as `orca agent read`, so it holds that command's window (the newest
    100 entries, text and tool names, no tool arguments). Reading never starts or wakes an agent.
    `fork.sessionExport.read` returns one document (title, entries, the host's home folders); a
    paired host's chat is read with `--environment`.
  - **Formats.** `--format md` (default) puts one heading per turn and each run of tool lines in
    one collapsed `<details>` block. `html` is a single file with inline CSS, no script and no
    remote asset, and a Content-Security-Policy that forbids both; all text is escaped. `json` is
    the document. Rendering and redaction run in the CLI (or the app), so the file is the same
    whichever host holds the chat.
  - **Where it goes.** The current folder, `orca-session-<id>.<ext>` (mode 0600), or `--out FILE`;
    `--out -` prints it. Nothing is published unless `--share` is given.
  - **Redaction** (`session-export-redact.ts`) removes API keys and tokens by shape (`sk-`,
    GitHub, GitLab, Slack, AWS, Google, npm, JWT), values of names holding KEY, TOKEN, SECRET,
    PASSWORD or CREDENTIAL, `Authorization` and `Bearer` values, private key blocks, credentials
    in URLs, and any `/Users/NAME`, `/home/NAME`, `C:\Users\NAME` or the host's own home folder
    (as `~`). It is on by default (`forkSessionExportRedact`); `--redact` and `--no-redact` decide
    one export. A safety net, not a guarantee: read an export before you hand it on.
  - **Share.** `orca agent export <id> --share` writes the redacted Markdown or HTML file and
    publishes it through the existing artifacts RPC (`artifacts.share`, the signed-in desktop
    account, `artifactSharingEnabled` respected) as an unlisted link, and prints the link with a
    warning that anyone holding it can read the session. A share is always redacted
    (`--no-redact` is refused), is never JSON, and runs on this desktop only.
  - **Settings** (all `orca settings` keys): `forkSessionExportRedact` (on),
    `forkSessionExportMaxEntries` (500, 10 to 5000, newest kept), `forkSessionExportIncludeActivity`
    (on; off drops the tool lines).
  - **App.** A native chat tab's right-click menu has "Copy chat as Markdown" (redaction per the
    setting). Saving a file and sharing are the CLI's.
  - Code is in `src/shared/fork/session-export/`, `src/main/fork/session-export/`,
    `src/cli/fork/session-export-*` and `src/renderer/src/fork/session-export/`.
- **Spend caps for every agent (BAD-679).** The spend cap of the agent guards no longer stops at
  native Claude chats. Every cap is off (0) until set; nothing here changes what runs today.
  - **Codex chats.** A native Codex chat's `thread/tokenUsage/updated` frame carries the thread's
    running totals; the ledger keeps the last totals it saw and adds only the growth, so a
    resumed chat that replays its totals adds nothing and a total that falls starts over. The
    chat's model comes from its saved model. Priced with the Codex table (`gpt-*`, cached input
    at the cached rate, long-context rates not applied) when the Claude table has no price for
    the model; `forkUsagePrices` overrides apply to both. A model with no price adds nothing.
  - **Terminal agents.** A Claude Code or Codex terminal names its transcript file in every hook
    post (`transcript_path`, only an absolute `.jsonl` path is read). While a spend cap may cover
    it, Orca reads what the file gained (up to 4 MB a pass, every hook post and each 15 s sweep)
    and keeps only token counts, model and time in the ledger under the pane key. Only usage
    from after Orca began watching counts, so resuming a long transcript is not paused for last
    week's spend. At the end of the tool call that takes the agent past a cap it gets the polite
    interrupt (Esc, never on a dialog) and is paused like a looping terminal. Other terminal
    agents (OpenCode and the rest) are not counted yet: their hook posts name no transcript.
    Terminal rows are hidden from the cache-cold cue.
  - **Caps by scope.** An agent can be covered by several caps at once, each counting its own
    spend from its last resume: its own (`forkAgentGuardSpendCapUsd` or `orca guards cap`), its
    Run's and its automation's. The first one reached pauses it; the pause says which.
  - **Run cap.** A Run is a coordinator and the workers it dispatched (the ledger's dispatch
    chain, as in `orca usage-report --by coordinator`). `forkAgentGuardRunCapUsd` (0 = off) is the
    default; `orca guards cap <id> <usd> --run` gives one Run its own on its coordinator. The
    Run's total is every chat in it, finished ones included. At the cap every agent of the Run
    still running is paused at once, one in a turn at the end of it. A resume counts the Run's
    cap from what it had spent by then.
  - **Automation caps.** `forkAutomationCapRunUsd`, `forkAutomationCapDayUsd` and
    `forkAutomationCapWeekUsd` (0 = off) are defaults for every automation;
    `orca guards automation-cap <id> [--per-run|--day|--week <usd|default>]` sets one
    automation's own (kept in `fork-automation-caps.json`, mode 0600; 0 is none, `default`
    follows the setting). Spend is what the ledger holds for each run's chat or terminal, by
    local day, else the cost the run recorded when it finished; a reused session counts once.
    Per run: the run's agent is paused at its turn's end (the agent is noted at launch, so a run
    started before a cap was set is not covered). Per day (the local day) and per week (the last
    7 days): a scheduled or event run is skipped, as `skipped_unavailable` with the spend and cap
    in run history, until the window moves on or the cap is raised, and a run in progress is
    paused; Run now is a person's act and still goes.
  - **`orca guards list`** shows, for each capped agent, every cap that covers it with its spend
    (`chat $2.00/$5.00, run $9.00/$10.00`), then the Runs with a cap and the automations with
    caps (per run, today, 7 days, "skipping runs"). `fork.guards.list` carries `runs` and
    `automations`; `fork.guards.cap` takes `run`; `fork.guards.automationCap` is new.
  - Settings: Settings > Blackfish > Agents and workers, Agent guards.
  - Code: `src/main/fork/usage-ledger/transcript-usage.ts`, `terminal-spend.ts`,
    `src/main/fork/agent-guards/` (`agent-guards-limits.ts`, `agent-guards-enforce.ts`,
    `agent-guards-scopes.ts`, `agent-guards-terminals.ts`, `automation-caps*.ts`).
- **Keep main current (SLRM-2384).** Off by default. Each host (the desktop app, `orca serve` and
  orcad on a headless server) fetches the default branch of each of its local git projects on a
  timer and fast-forwards it, so new worktrees start from current main.
  - The branch is the project's Lost work default branch override, else the remote's `HEAD`, else
    `main`, `master`, `trunk` or `develop`; the remote and its branch are the branch's upstream,
    else the remote `HEAD` came from. The fetch is `git fetch --no-tags --no-write-fetch-head
    <remote> <branch>` through the app's own git runner, so credentials and SSH set up for git
    apply and nothing prompts.
  - It moves the branch only by a fast-forward: in the main checkout with `git merge --ff-only
    --no-autostash` when the checkout is clean (untracked files aside), no merge, rebase,
    cherry-pick, revert, bisect or index lock is under way, HEAD is still the branch at the commit
    it read, and (unless `forkMainSyncSkipInUse` is false) no terminal or working agent is live in
    it; checked out nowhere, with a compare-and-swap `git update-ref`. A branch checked out in a
    linked worktree, a diverged branch and a branch with commits the remote lacks are never moved.
  - Each move, and each new reason a project was left alone, is logged as `[fork-main-sync]`.
  - Settings (Settings > Blackfish > Projects, or `orca settings`): `forkMainSync` (off),
    `forkMainSyncMinutes` (15, from 5 to 1440), `forkMainSyncProjects` (names, ids or paths;
    empty is every local git project), `forkMainSyncSkipInUse` (on). The settings are read
    before every pass and a change to them brings the next pass forward, with no restart.
  - CLI: `orca main-sync [--json]` prints the last result per project and `orca main-sync run
    [--repo <name|id|path>]` runs a pass now (even while off), over `fork.mainSync.status` and
    `fork.mainSync.run`; add `--environment` for a paired server.
  - Code is in `src/shared/fork/main-sync.ts`, `src/main/fork/main-sync/`,
    `src/main/runtime/rpc/methods/fork/fork-main-sync.ts`, `src/cli/fork/main-sync-*.ts` and
    `src/renderer/src/fork/main-sync/`.
- **Server memory protection (SLRM-2384).** `orca serve service protect` (Linux) keeps an always-on
  server reachable when agents use up memory. It works on the orca-serve user unit that
  `orca serve service install` or the dotfiles `orca-server` installer wrote (the same names).
  - It writes `50-blackfish-protect.conf` drop-ins beside the unit (never the unit itself) and for
    its slice: `MemoryMin` (256M) and `MemoryLow` (1G), applied at once with `systemctl --user
    set-property --runtime`; `OOMScoreAdjust` (`auto`: the user manager's own score, the lowest
    an unprivileged unit may take); and `ORCA_FORK_CHILD_OOM_SCORE_ADJ` (300). The terminal
    daemon, which the server starts and which starts every agent, raises its own score to that
    value at start, so the kernel kills agents before the server. The scores apply at the next
    start of the service and of the daemon; protect restarts nothing.
  - Root steps are printed, never run, and only the ones still needed: `systemctl set-property`
    of the same memory values on `user.slice`, `user-<uid>.slice` and `user@<uid>.service`
    (protection reaches a unit only through its parents), and an `OOMScoreAdjust` drop-in (-500)
    plus a live write for `tailscaled`, `ssh` or `sshd`.
  - `orca serve service protect status` shows the drop-in, the unit's values, the running
    server's score, the user manager's floor and the system units' values;
    `orca serve service unprotect` removes only the files protect wrote (they start with its
    marker) and clears the memory values at once. Flags: `--memory-min`, `--memory-low`,
    `--oom-score-adjust`, `--child-oom-score-adjust`, `--system-oom-score-adjust` (each takes
    `off`), `--dry-run`. The drop-in itself holds the choice, per host.
  - Code is in `src/shared/fork/serve-protect.ts`, `src/cli/fork/serve-protect*.ts` and
    `src/main/fork/serve-protect/daemon-oom-score.ts`.
- **Branch clashes (SLRM-2394).** Warns when parallel worktree branches of one project change
  the same files, and when a branch falls far behind the default branch. On by default; it only
  reads git (no fetch, no checkout, no diff drivers or textconv, no file contents).
  - Each host reads its own worktrees: for every unmerged worktree branch, the files it changes
    since its merge base with the default branch that still differ from it (so a squash-merged
    branch drops out), plus its uncommitted and untracked files, and how far it is ahead and
    behind. The default branch is the one Lost work uses (its per-project override, else the
    remote's `HEAD`, then `main`, `master`, `trunk` or `develop`).
  - The desktop asks each paired server over `fork.clashes.local` (its own report, as auto
    placement asks for load) and folds the answers: a project matches across hosts by its first
    remote's address (`host/owner/repo`), a repo without a remote only matches itself. A server
    without the method, switched off or not answering is named in the result, not guessed.
  - A workspace row whose branch shares files gets a small chip in the account chip's style
    (`2 shared`, a dot in the theme's modified color); a branch at least
    `forkBranchClashesBehindThreshold` commits behind (unset is 20, the orchestrator's stale-base
    flag) gets `N behind`. The hover lists the files and the other branches (`@ host` for another
    machine). A shared file is a hint, not proof of a merge conflict.
  - Cost: committed facts are cached by worktree path, head and base commit, so a check where
    nothing moved runs `worktree list`, the base read and (when uncommitted changes count)
    `status` per worktree; two repositories and four worktrees at a time, four servers at a time.
    Lists are bounded (1000 files per branch, 200 shared files per project, 20 branches per
    file) and a cut list says so.
  - Settings (Settings > Blackfish > Projects > Branch clashes): `forkBranchClashes` (on),
    `forkBranchClashesIntervalMinutes` (5, 1 to 240), `forkBranchClashesUncommitted` (on),
    `forkBranchClashesBehindThreshold` (20) and `forkBranchClashesPairedServers` (on), and a
    Check now button. Off stops the timer and clears the chips; a server with it off answers
    `off`.
  - CLI: `orca clashes [--project <name|id|owner/repo>] [--refresh] [--json]` over
    `fork.clashes.scan` (workspace permission). It answers from the last check while that is
    newer than the interval, unless `--refresh`.
  - Code is in `src/shared/fork/branch-clashes*.ts`, `src/main/fork/branch-clashes/`,
    `src/main/runtime/rpc/methods/fork/fork-branch-clashes.ts`,
    `src/preload/fork/branch-clashes-bridge.ts`, `src/renderer/src/fork/branch-clashes/` and
    `src/cli/fork/branch-clashes-*`.
- **Typecheck caps (SLRM-2405).** Two environment variables lower what `pnpm typecheck`,
  `pnpm tc` and the `tc:*` scripts take from the machine, for hosts where several checkouts
  check at the same time. Unset, the runner behaves as upstream's does. Each takes a positive
  integer, only ever lowers, and stops the run with a message on any other value.
  - `ORCA_FORK_TYPECHECK_JOBS`: how many projects are checked at once. Upstream checks two at a
    time with the default compiler (`tsrs`), fewer when the host has under about 19 GB.
  - `ORCA_FORK_TYPECHECK_CHECKERS`: checker threads of each `tsrs` compiler (upstream's default
    is 8). A `--checkers=<n>` flag still wins.
  - Measured on an 18-core host with 36 GB, the five root projects, cold cache: stock about
    7 to 10 GB peak for the process tree in 8 to 11 s. One job, 6.5 GB in 11 s. One job with
    4 checkers, 5.3 GB in 11 s. One job with 2 checkers, 4.1 GB in 16 to 18 s. A run with a warm
    incremental cache takes 1 to 2 GB in 2 s at any setting.
  - Code is in `config/scripts/fork/typecheck-jobs.mjs`.

- **Review guides (SLRM-2396).** A Guide tab on the pull request page: an agent writes a tour of
  the change, with stops in reading order, "Look closely" marks where a maintainer has to make a
  call, and mechanical changes (renames, formatting, lockfiles, generated files) grouped at the
  end. Every changed file appears somewhere. Idea from T3 Code's review guides (MIT).
  - A guide is written only on demand: Write guide in the tab, Write guide on the phone, or
    `orca review-guide write <pr>`. `forkReviewGuideAutoWrite` (off) writes one when the Guide tab
    of a pull request without one is opened. `forkReviewGuides` (on) shows the tab, the phone row
    and the CLI.
  - The writer is the source control "pull request" agent and model, run as a one-shot text task.
    It reads the pull request (title, description, file list, patches) from GitHub through the
    same gh execution and rate-limit budget as the Files tab. That text is untrusted: it goes in a
    block fenced by a random marker, the answer must be one JSON object that matches a schema, and
    every path is checked against the pull request's own file list (files the writer left out go
    in an "Other changed files" group). Text is stripped of control and bidi characters. Claude
    runs with no tools at all, under `forkReviewGuideTimeoutMinutes` (5); other agents take the
    stock read-only text-task path and its 60 s limit. `forkReviewGuideMaxPatchKiB` (96) caps the
    patch text; `forkReviewGuideInstructions` adds the user's own preferences.
  - Back and Next walk the stops; each file shows its line ranges and the patch lines they cover.
    A guide written for another head commit is marked stale, hides its excerpts and offers
    Rewrite guide. At most two guides are written at once, one per pull request.
  - Viewed: each file shows GitHub's own viewed mark, and Mark viewed (per file, or per stop)
    sends the stock `markFileAsViewed` toggle. Nothing is marked unless the user clicks.
  - Guides are kept per pull request in `fork-review-guides/` in userData (owner-only files, the
    oldest past 300 removed), so the window, the phone and the CLI share them.
  - CLI: `orca review-guide <pr>`, `orca review-guide write <pr> [--wait]` and
    `orca review-guide cancel <pr>` (`<pr>` is a number, #number or the pull request URL;
    `--worktree` or `--repo` pick the checkout, else the current folder's workspace), over
    `fork.reviewGuide.get`, `.write` and `.cancel` (workspace permission). A workspace on an SSH
    host is refused: a guide is written where the checkout is.
  - Phone: a Review guide row on the pull request tab opens a drawer with Back and Next, over the
    same RPC.
  - Code is in `src/shared/fork/review-guide*.ts`, `src/main/fork/review-guide/`,
    `src/main/runtime/rpc/methods/fork/fork-review-guide.ts`,
    `src/preload/fork/review-guide-bridge.ts`, `src/renderer/src/fork/review-guide/`,
    `src/cli/fork/review-guide-*` and `mobile/src/components/fork/review-guide/`.
- **Agents on the iPhone Lock Screen (SLRM-2387).** The iOS app shows running agents from every
  paired server as one Live Activity (Lock Screen and Dynamic Island, ActivityKit) and in an
  Agents widget (WidgetKit: small, medium and large on the Home Screen; circular, rectangular and
  inline on the Lock Screen). Android is not covered.
  - **What shows.** Agents that need you (yellow), failed (red), are working (blue, with a
    counting timer) or finished (green), in that order, with the server and workspace; idle
    agents are left out. A finished agent stays for 15 minutes (5, 15, 30 or 60), counted from
    when the phone saw it finish, then leaves: the widget's timeline has an entry at that time,
    and the open app updates the Live Activity then (a backgrounded app cannot, so the Live
    Activity drops it at the next update). Counts cover every agent; the Live Activity lists four,
    the large widget eight. Tapping either opens the app's Home. When nothing is left, the Live
    Activity ends.
  - **Where the state comes from.** Home's own reads of every paired server (the Agents tab's
    list, `AgentListInput`), folded by `foldLiveAgents`: a server read live replaces its rows, a
    server not connected keeps what it last showed. Home stays mounted under other screens, so
    this runs whenever the app is open. The rows are kept in AsyncStorage across launches, and
    iOS gets a new state only when the content changed.
  - **No push updates.** The app updates both surfaces while it runs; iOS can only start a Live
    Activity while the app is in front. Push cannot update them: upstream's push gateway
    (`cloud/apps/push`, run by Orca at push.onorca.dev for `com.stably.orca.mobile`) sends only
    alert pushes (no `content-available`, so no background wake on an alert) and has no
    ActivityKit push type. A Live Activity not updated for 30 minutes turns stale and says when
    it was last updated. ActivityKit push would need a gateway that sends `liveactivity` pushes
    with the app's APNs key and the activity's push token.
  - **Dismissal.** A Live Activity the user swipes away stays away until an agent it did not
    show starts or needs them.
  - **Settings** (phone only, Settings > Notifications > Lock Screen, in AsyncStorage
    `blackfish:agentLiveActivitySettings`): running agents on the Lock Screen (on), Agents
    widget (on), keep finished agents (15 minutes). Turning one off ends the Live Activity or
    empties the widget; with both off the stored rows are deleted too. They are not desktop
    settings, so the fork settings catalog does not list them.
  - **Privacy.** Like any Live Activity, it shows agent titles, server and workspace names on the
    Lock Screen without unlocking; turn it off above to keep them off. The rectangular Lock
    Screen widget marks titles `privacySensitive`, so iOS redacts them while the phone is
    locked. Text from servers is cut to 60 characters before it reaches iOS.
  - **Build.** `mobile/plugins/fork/ios-agent-live-activity.js` (listed in `app.json`) adds, at
    `expo prebuild`, the `BlackfishWidgets` widget extension target (bundle id
    `<app bundle id>.BlackfishWidgets`, iOS 16.4, signed with the app's team and signing style,
    embedded through an "Embed Foundation Extensions" phase), `NSSupportsLiveActivities`, and an
    App Group `group.<app bundle id>.blackfish` on both targets for the widget's snapshot. The
    fork does not build or sign the iOS app in CI (upstream's `mobile-ios-release.yml` stays
    off); a local build with automatic signing registers the extension and App Group on its own.
    Upstream's Fastfile signs manually with one profile, so a release built that way needs a
    second profile for the extension, or `BLACKFISH_IOS_WIDGETS=0` at prebuild, which leaves the
    project as upstream builds it.
  - Code is in `mobile/src/components/fork/live-activity/` (model, publisher, hook, settings),
    `mobile/modules/fork-live-activity/` (the `BlackfishLiveActivity` Expo module; `ios/shared`
    is compiled into the app and the extension, `widget/` only into the extension) and
    `mobile/plugins/fork/`.
- **Quick task on the phone (SLRM-2428).** A Quick task button in the Feed tab's header opens a
  sheet with one box and the phone's own dictation (the session composer's mic, meter, cancel and
  retry). Send hands the task to a paired computer, which gives it to the bot that owns the
  project (the router is the desktop half of SLRM-2428).
  - **Which computer.** The one connected computer, or the one picked from the same list Tasks
    uses when several are connected. The button is off while none is connected.
  - **The call.** `quickTask.submit` with `{ text, source: 'mobile' }`, named in
    `src/shared/fork/quick-task-contract.ts`, which the desktop, the phone and the CLI share. The
    text is trimmed, an empty one is refused and the box stops at `QUICK_TASK_TEXT_MAX` (8000)
    characters, dictation included. The phone checks the reply itself (`botName`, `chatId`,
    `note`) and sends the request raw; the desktop half registers the method and its params in
    the generated params catalog.
  - **After Send.** A taken task shows "Sent to <bot>" and the router's note, then the sheet
    closes after 2.5 s. A refusal keeps the text and shows the host's reason. A computer whose
    Blackfish predates quick tasks (`method_not_found`, or an older mobile allowlist's
    `forbidden`) gets "Update Blackfish on this computer."
  - **Settings** (phone only, Settings > Appearance > Quick task, in AsyncStorage
    `blackfish:quickTaskSettings`): Quick task button (on). Not a desktop setting, so the fork
    settings catalog does not list it.
  - Code is in `mobile/src/components/fork/quick-task/`.
- **Small extras (SLRM-2397): approval triage, workspace tags with archive on merge, prompt stash,
  saved prompts.** Four small features from ccdeck's approvals, roster hygiene and composer
  shortcuts and T3 Code's prompt stash, each its own setting, built from stock styles only.
  - Approval triage (`forkApprovalRisk`, off unless true). A native chat's own approval card and
    each worker approval pinned in its coordinator's chat show a stock Badge, Low, Medium or High
    risk, and the reason in a few words. The grade (`src/shared/fork/approval-risk*.ts`) reads the
    card's title and the tool's input against the folder the agent works in (the chat's folder;
    a worker's own workspace when the window knows it, else unknown). Low is only a plain chain of
    known read-only programs on files inside that folder (`ls`, `cat`, `rg`, `git status`,
    `git diff` and the like), a Read, Grep or Glob inside it, or an edit of an ordinary file in it.
    High: git writes and fetches (push, commit, reset, checkout, config, remote and the rest),
    every `gh` command that is not a view or list, deleting (`rm`), `sudo`, `ssh` and its family,
    process control, nested shells and piping into one, `xargs`, `eval`, package publishing and
    global installs, uploads with `curl`, a write outside the folder, anything touching
    credentials, `.env`, `.ssh`, `.claude` or `.git/config` and hooks, a call asking to leave the
    sandbox, an MCP tool whose name sends or changes something, and a command too long to read.
    Medium is everything else, including the network, running code (tests, builds, interpreters,
    package managers), reading outside the folder, and anything with expansion, redirection,
    globs or characters it cannot read, any flag not on that program's allow-list
    (`approval-risk-flags.ts`, exact names only, so `sort --out` and `grep -r` are medium), `cd`
    with a flag, and a program named by a path outside the system bin folders. Any word naming a
    credential, a flag's value or `HEAD:.env` too, is high. Paths are read as text: a symlink inside
    the folder that points out of it still counts as inside, and git history (`git log -p`) counts
    as the workspace's own files, so the grade is advice, not a sandbox. An unknown folder makes
    every absolute path outside. A plan review, a sign-in page and a startup dialog are not graded.
    On a high risk card Claude's "Allow for this session" is disabled, so a rule never covers a
    high risk call.
  - Allow low risk (`forkApprovalBulkAllowLow`, off unless true, needs the grade on). Over a
    coordinator's pinned worker prompts, "N low risk approvals" with Allow low risk. The click
    grades every prompt again from what it says then and allows only those still open, still
    offering Allow and still low; medium and high stay one at a time. Both keys are agent-limit
    keys: `orca settings` refuses to write them.
  - Workspace tags (`forkWorkspaceTagsEnabled`, unset is on). "Tags..." in the workspace menu
    sets up to 8 short words (`forkWorkspaceTags`, keyed by workspace id and host). A card shows
    two after its title as stock reference-label badges and +N for the rest. A click on a tag
    shows only its workspaces, a second hides them, a third clears the filter
    (`forkWorkspaceTagFilter`); a line over the list says "Only x" or "Hiding x" with Clear.
  - Archive on merge (`forkArchiveOnMerge`, off unless true; an agent-limit key). A workspace
    whose pull request shows as merged is archived through the stock `worktree.archive` RPC,
    which keeps its branch and record and refuses a checkout with uncommitted or unpushed work.
    It leaves the open workspace, one with an agent not done, the main checkout and one snoozed
    until merge alone (that snooze settles first, so its settle command still finds the folder;
    snooze itself never archives). A refused try is said once and retried after 30 minutes. The
    toast offers Undo, and an "Archived (N)" row at the bottom of the sidebar, built from the
    Snoozed row's styles, lists archived workspaces with Restore (`worktree.restore`, the
    project's own setup choice). It reads the merge from the review cache the cards already
    keep; it asks GitHub for nothing more.
    A pull request the PR babysitter (SLRM-2386) merges is archived the same way when this is on;
    the babysitter itself never archives, and agent guards (SLRM-2385) never answer approvals.
  - Prompt stash (`forkPromptStash`, unset is on). Cmd+S (Ctrl+S on Windows and Linux) in a chat
    message box with a draft sets it aside with its attachments (by their kept paths), pasted
    text files and pills, and empties the box; in an empty box it brings the newest back. The
    stock Save shortcut acts only in an editor and its workspace fallback skips text inputs, so
    Cmd+S was free in the message box. Up to 20 drafts, newest first, in the window's local
    storage. Files held only in a web client's memory cannot be stashed, and a queued message's
    edit box is left alone.
  - Saved prompts (`forkSavedPromptsEnabled`, unset is on; `forkSavedPrompts`, an agent-limit
    key). A menu beside Attach on the message box lists them; a pick puts its text in the box at
    the caret, nothing is sent. The same menu lists the stashed drafts (a pick restores one, x
    drops it). The list is edited in Settings > Blackfish > Chats, "Saved prompts".
  - Code is in `src/shared/fork/approval-risk*.ts`, `workspace-tags.ts`, `prompt-stash.ts`,
    `saved-prompts.ts`, and `src/renderer/src/fork/approval-triage/`, `workspace-tags/`,
    `prompt-stash/` and `saved-prompts/`.

- **Letters and the board (SLRM-2389).** On by default (`forkLetters`, `forkBoard`, Settings >
  Blackfish > Chats). From John's archived ccdeck (its letters and Board); only the idea is ported.
  - **Letters.** `orca letter send <to> <text> [--cite <id>] [--host <server>]` sends one chat's
    message to another chat or terminal agent by id (a unique prefix of 4+ characters), listed by
    `orca letter chats`. The host signs it with the chat whose environment ran the command
    (`ORCA_AGENT_SESSION_ID`, else `ORCA_PANE_KEY`, checked against this host's chats); outside any
    agent it is signed "shell". It is queued and typed in only between the recipient's turns,
    through idle recovery's guarded send: a native chat that is loaded and not in a turn (checked
    again inside the send, queued never steered), a terminal agent at an empty prompt with no
    dialog or draft and only where the agent reads the terminal (checked again before the first
    write). One letter per recipient per pass, a pass every 5 s while letters wait and none
    otherwise; a send that may have arrived counts as delivered, so none is typed twice. A sleeping
    chat keeps its letters until it is loaded; a letter not delivered in a day expires.
  - **Untrusted.** The recipient sees `[Blackfish letter <id> from ...]`, a line saying the words
    are another agent's, not the user's, and cannot approve anything, then the body between
    `--- letter begins ---` and `--- letter ends ---`, then the command to answer. The frame is
    built from the host's own record; a body that writes those markers (after NFKC folding and
    with invisible characters taken out) is refused, and control, bidi and zero-width characters
    are stripped. Titles a sender controls are printed only when plain.
  - **Cite.** `--cite` names an earlier letter between the same two chats; any other is refused.
  - **Rate limits.** Per sending chat: `forkLettersMaxPerWindow` (20) letters and asks in
    `forkLettersWindowMinutes` (10); two chats that wrote each other `forkLettersLoopEach` (6)
    times each way in the window are refused as a loop; a recipient holds at most 20 waiting
    letters. `orca settings` cannot write the limits (kind `agent-limit`).
  - **Paired hosts.** `--host <server>` hands the letter at once to that paired server's
    `fork.letters.deliver` over the desktop's own RPC client; the server marks the sender as a
    paired device (unverified) and delivers it the same way. A server chat's answer to a desktop
    chat waits there until the desktop collects it (`fork.letters.collect`); a desktop polls each
    server it wrote to in the last day every 15 s. `forkLettersFromPaired` (on) refuses all of it.
  - **The board.** `orca board add REVIEW|DECIDE|DO <title> [--body <text>]` files an ask for the
    user. A chat holds at most `forkBoardMaxOpenPerChat` (10) open asks, and filing counts against
    its letter rate. Its open asks show in a closed tray above its message box (one line with the
    count and the first ask; open, each ask is a collapsed row in a capped scroll area, Escape
    closes it), and every open ask, from this host and each paired server, shows in the Decision
    inbox under "Asks for you" with Go to chat. Done: by the user or the agent that filed it.
    Throw back: by the user only, with a note the asking chat is sent between its turns. The
    inbox and its toolbar count show while the board is on, even with idle recovery off.
  - **History.** "Letters between chats..." in the palette, the Decision inbox and the Settings
    card opens every letter of the last week, newest first, from this host and its paired
    servers; a name narrows it to that chat. `orca letter list [--chat <id>]` lists them too
    (the calling chat's own by default).
  - **State.** `fork-letters.json` in the data folder (mode 0600, written atomically): letters,
    asks, the rate log and the servers written to. Settled letters and closed asks are kept a
    week.
  - Code is in `src/shared/fork/letters*.ts`, `src/main/fork/letters/`,
    `src/main/runtime/rpc/methods/fork/fork-letters.ts`, `src/preload/fork/letters-bridge.ts`,
    `src/cli/fork/letters-*.ts` and `src/renderer/src/fork/letters/`.

- **Quick task (SLRM-2428).** On by default (`forkQuickTask`, Settings > Blackfish > Chats >
  Quick task). A global shortcut opens a small box over any app; a typed or dictated
  task goes to a router bot, which hands it to the bot that owns it with a machine to run it on,
  and the box closes. Needs Bots (upstream 1.4.265) on.
  - **The box.** Frameless, always on top, centered on the display under the pointer; on macOS a
    non-activating panel, so it opens over another app without raising the main window. One text
    field (Enter sends, Shift+Enter adds a line, Esc closes, clicking elsewhere closes) and a mic
    that uses the dictation model and microphone from Settings > Voice (greyed out until
    dictation is set up). After sending it shows which bot took the task with Open chat, and
    closes 2.5 s later unless the pointer is on it. It is its own renderer entry
    (`quick-task.html`) with the main preload, its own session, and only microphone access.
    Because the panel leaves Blackfish inactive, the Edit menu's keys never reach it, so the box
    runs Cmd (elsewhere Ctrl) C, V, X, A, Z and Shift+Z itself (`quick-task-edit-keys.ts`).
  - **Shortcut** (`forkQuickTaskShortcut`): an Electron accelerator, default
    `CommandOrControl+Alt+Shift+Space` (no macOS or Orca default uses it); empty is the default,
    `none` turns it off, and anything that is not one key with Command, Control or Alt is refused.
    It is registered once settings load, re-registered when the setting changes (the old one is
    unregistered first), and unregistered at quit. If another app holds it, the box has no
    shortcut until another is set (logged).
  - **One path.** The box (over IPC, only from its own window), `orca quick-task <text>` and the
    phone all call `quickTask.submit` (`src/shared/fork/quick-task-contract.ts`, shared with the
    phone). The CLI refuses to run inside an agent chat: agents hand off with
    `orchestration send`.
  - **Routing.** The task starts a new chat on the router bot (`forkQuickTaskRouterBot`, default
    Dispatcher), acting for the owner as the owner's own new chat does. A bot with that name is
    reused; with none, it is made on first use like the owner's New bot (purpose "Routes quick
    tasks to the bot that owns them." in SOUL.md, no greeting turn) on `forkQuickTaskRouterAgent`
    (claude) and `forkQuickTaskRouterModel` (haiku on claude). One task at a time, so two at once
    make one router. The first message tells the router to run `bot list` (which lists the bots
    on every paired server too, with the `--on` that reaches each), pick the owning bot, run the
    placement command for code work, and hand off with `orchestration send [--on <server>] --to
    bot:<name> --type handoff --chat new`, putting the machine and the `--on`/`--repo` values for
    `worker-start` in the body; when two or three bots could own it, ask the owner in its chat
    naming them; then stop. A bot cannot create a bot, so when none fits the router proposes one
    (`bot create --offer`) and the owner presses Create bot.
  - **Placement** (`forkQuickTaskPlacement`, on; `forkQuickTaskPlacementCommand`): empty runs the
    built-in ranking (`orca placement --json` with the session's own orca); any other command
    runs as typed in the router's shell and the router reads its output. `orca settings` cannot
    write the command (`runs-command`) or the router name (`agent-limit`).
  - **Phone.** `quickTask.submit` routes to the paired desktop (`runtime-rpc-mobile-method-routing.ts`),
    whose router sees every paired server's bots.
  - Code is in `src/shared/fork/quick-task*.ts`, `src/main/fork/quick-task/`,
    `src/main/runtime/rpc/methods/fork/fork-quick-task.ts`, `src/preload/fork/quick-task-bridge.ts`,
    `src/cli/fork/quick-task-*.ts`, `src/renderer/quick-task.html` and
    `src/renderer/src/fork/quick-task/`.

- **Bot starting rules (SLRM-2459).** Upstream writes every new bot's SOUL.md with a `## Never`
  block that keeps it read-only ("Change anything ... until my owner says I can. I start by
  reading and reporting only."), so a new bot asks before every action. `forkBotStartingRules`
  (Settings > Blackfish > Chats > Bot starting rules, a multi-line field) holds the Markdown a
  new bot's SOUL.md gets in place of that block; it may hold any sections. Unset or empty keeps
  upstream's exact text, and a soul without the block (upstream reworded it) is left as written.
  - It applies wherever a bot is made from a seed, which all go through the bot controller: the
    New bot dialog, `bot create --offer` cards, built-in templates and the quick task router's
    first-use Dispatcher. A bot with no seed keeps upstream's starter line. Bots already made
    keep their SOUL.md.
  - The text is trimmed and capped at 4000 characters. `orca settings` cannot write it
    (`agent-limit`): it sets what new bots may do, and an agent must not loosen that for the bots
    it makes.
  - Code is in `src/shared/fork/bot-starting-rules.ts` and
    `src/renderer/src/fork/bot-starting-rules/`.

- **Bot model from the CLI, and a model for new bots (BAD-635).** A bot with no model of its own
  starts every chat on the native chat defaults (the last model picked in any chat), and changing
  that meant opening each bot's settings.
  - `orca bot set (--bot <name> | --all [--agent <agent>]) [--model <id>] [--effort <level>]
    [--clear] [--json]` saves the same launch the bot's settings save, through `bots.list` and
    `bots.update` (`updates.launch`; effort is the `effort` option, as the picker writes it). It
    prints each bot changed with what its new chats start on. `--effort` alone keeps the bot's
    model; a new `--model` without `--effort` drops the old options, as the picker does;
    `--clear` puts the bot back on the native chat defaults. `--all --model` needs every chosen bot
    on one agent (`--agent` narrows it), since a model belongs to its agent. Every launch is
    checked before any is saved. With `--environment` it sets the bots of that paired server, and
    it works against any host whose `bots.update` takes `launch` (upstream 1.4.265 on).
  - Agents may run it. A model is a cost choice, not a limit on what a bot may do, and upstream's
    `bots.update` already lets an agent's CLI change a launch while it keeps members and
    permissions owner-only.
  - New bots: the `bot` kind of `forkLaunchDefaults` (Settings > Blackfish > Launch defaults, New
    bots row; e.g. `{"bot":{"claude":{"model":"opus","effort":"medium"}}}`) is the launch a bot is
    made with when its create brings none: the New bot dialog, offer cards, templates and imports.
    A launch the create brings wins, so the quick task router keeps `forkQuickTaskRouterModel`.
    Unset keeps upstream. Bots already made keep theirs.
  - Code is in `src/shared/fork/launch-defaults/launch-defaults-bot.ts` and
    `src/cli/fork/bot-set-*`.

- **Bot connect from the CLI (BAD-640).** Linear and GitHub keep the owner's link once per
  computer, but each bot is turned on for them one at a time in its Connectors setup.
  - `orca bot connect (--bot <name> | --all) [--linear] [--github] [--json]` links what is already
    connected on the host to the bots that lack it, through the calls the setup's Turn on makes:
    `bots.linear.state` and `bots.github.state` read the host's links, and `bots.update` saves the
    bot's `linearWorkspaces` (every linked workspace where Orca's Linear app is installed, after the
    bot's own) and `github: {}` (once the account is linked and the Orca app installed somewhere).
    Without `--linear` or `--github` it links both. It prints each bot with what it linked and why
    anything was not: already linked, not connected, not installed, or a host that could not be read.
  - It never starts a sign-in (`bots.connect.*`): a connector not connected on that computer is
    connected once from any bot in Orca. Slack stays per bot, since each bot is its own Slack app.
  - `--all` is the bots of the computer asked only (`bots.list`), so a paired server's bots never
    get this computer's accounts; `--environment` links that server's bots with its own accounts.
  - Code is in `src/cli/fork/bot-connect-*`.

- **Bot items: workers on a paired server (BAD-642).** A bot that starts a worker with
  `orchestration worker-start --on <server>` links it to its item, but its host knows that worker
  only by its own record, so upstream's item chip could not open it ("Orca can't find where ... is
  running") and showed "PR not shown for server work yet".
  - The item marks such a link with the server that runs it (`server.environmentId` on the
    dispatch link view). Clicking the worker, as a chip or as a row behind "+N", asks that server to
    find its Dispatch and opens the server's workspace on the worker's pane in this window, as the
    sidebar opens a server workspace.
  - While the item is open, the desktop reads each such worker from its server
    (`orchestration.workerShow`, then `worktree.show`), every 15 s while it may still be working or
    its server did not answer. The chip takes the server's live state and shows the server and its
    last activity (`m2mac-server · 13 s ago`; its hover card says `Working on m2mac-server · 13 s
    ago`).
  - Its PR replaces upstream's "PR not shown" mark: the PR this window's workspace card shows for
    the server's workspace, with its state, else the workspace's `linkedPR` (its URL from the
    server's `github.repoSlug`) as a plain PR link. A worker with neither shows no PR mark.
  - Only for bots on this desktop: a server's own bot names servers by that server's pairings. A
    server that can't be read leaves the host's record and upstream's mark as they were.
  - Code is in `src/shared/fork/bot-server-worker.ts` and `src/renderer/src/fork/bot-server-worker/`.

- **Card routing (BAD-694).** A Linear card reaches the bot that takes it without a "which bot?"
  question, and the work it starts can be found from the card.
  - `orca card route <KEY> [--hand-off] [--bot <name>] [--label-only] [--json]` reads the card
    through this Orca's Linear (`linear.issueContext`), the bots of this computer and its paired
    servers (`bots.roster`) and the settings (`fork.settings.get`). A `bot:<name>` (or `bot/<name>`)
    label wins; then the card's project, then its team key, in `forkCardRoutes` (a map such as
    `{"Docs":"Writer"}`, matched in any case; unset is no map). The quick task router bot never
    takes a card, and a paused bot or a label naming no bot does not count.
  - `--hand-off` starts that bot in a new chat (`fork.cardRoute.start`, on the bot's own paired
    server for a bot there) acting for the owner, as a quick task does, titled "KEY: summary". Its
    first message is the card, its description fenced as content, and how to keep work on it: start
    workers with `--card KEY` and comment the PR link on the card. The card gets the comment
    "<Bot> bot on it, chat <id>, machine <m>", and the command prints the chat id and machine (a
    failed comment is reported, not fatal).
  - When neither names a bot it offers 2 or 3: the ones whose name and purpose share most words
    with the card's title, project, team and labels, then the rest in roster order. From a bot's
    chat, `--hand-off` posts them as a Needs you item with tap choices (`bots.items.add`, then
    `.set` with the ask); anywhere else it starts the router bot on the card, which posts the
    choice from its own chat. The answer is handed off with `--bot <choice>`.
  - `--label-only` acts only when a `bot:` label decides: for an automation on new cards
    (`linear.issue_created`), so a card made with that label goes to its bot in one step.
  - Every bot's tools name `card route` and `worker-start --card`, and the quick task router's
    brief sends a task naming a card key to `card route` first.
  - `orchestration worker-start --card <KEY>` links a new workspace (new-child or new-top-level)
    to the card (`linkedLinearIssue`, the field `worktree ps` lists), so its agent lists under the
    card; the param (`forkCard`) is in the start's schema, so it reaches a paired server. An
    existing workspace is left as it is.
  - A `--chat new` handoff whose subject starts with a card key ("BAD-12: ...") is titled with the
    subject alone, not "<Sender>: ...", so a search for the key finds it.
  - `quickTask.submit` also returns the `machine` its chat runs on; `orca quick-task` prints it.
  - Code is in `src/shared/fork/card-routing.ts`, `src/main/fork/card-routing/` and
    `src/cli/fork/card-route*`.

- **Nothing waits on the owner (BAD-715).** The default for bot work is to finish it and report,
  not to park it on the owner. Blackfish is public, so this is written as general behavior with
  settings, and no name, host or card is in shipped text.
  - Bot rules (`bot-preamble.ts`): "Nothing waits on your owner". A bot finishes end to end (opens
    the PR, merges its own once checks pass in a repository it owns, deploys or releases as that
    repository's process says) and reports in one line. A decision goes first to the bot or
    coordinator that gave it the work (`orchestration ask` or a `question`). These stay with the
    owner: sending to other people, secrets and sign-ins, forgetting memory, deleting data,
    physical-security devices, force pushes, spending money, and a real security or data-loss risk
    (also still kept: a Slack workspace or another bot's chat that nothing decides, and a new bot's
    Create button). Merge rights: a bot may merge its own PRs in repositories it owns; approving or
    requesting changes on others' PRs is for when the owner asks, and reviews for anyone else stay
    comment reviews. The PR-wait prompt merges a green PR it owns (`gh pr merge`) instead of saying
    "ready to merge" (it still says it where the bot may not merge), and after the fix attempts it
    escalates to the bot or coordinator that gave it the work, to the owner only for a hard gate.
    The rules are text with conditions ("a repository you own"), not a setting: a SOUL.md "Never"
    section or a repository's own rules still narrows them per bot.
  - `card route --hand-off` first message: finish the card end to end (PR, merge in a repo it owns,
    deploy or release, move the card) and report to the bot that ran the route (the roster's
    `self`) or its coordinator; decisions go to that bot first, to the owner only for the hard gates.
  - A card nothing routes no longer waits for a choice: after the label, project map and team map,
    `forkCardDefaultBot`, then the bot that ran the route (never the router), then the quick task
    router takes it (`via: default`). `forkCardAskOwner` (default off) brings back the Needs you
    choice, which is also what happens when none of those exists. `--label-only` still needs a label.
  - The quick task router's brief hands a task to the likeliest bot instead of asking which.
  - Card comment: it names the receiving bot's own chat (the id `fork.cardRoute.start` returned),
    its title and the machine. The router's choice chat (only in the ask-owner path) is now titled
    "Routing KEY: ..." so two chats do not carry the card's title, and `card route` prints
    "<Bot> chat id: <id>". Tests in `card-route.test.ts`.
  - Code is in `src/shared/fork/card-routing.ts`, `src/cli/fork/card-route*.ts`,
    `src/main/fork/quick-task/quick-task-brief.ts` and `src/main/bots/bot-preamble.ts`.

- **Card routing dedupe, owner inference, owner token (BAD-737).** Routing a card twice opened a
  second "Which bot takes KEY?" while a bot already had it, and an MCP server could not answer an
  item without a bot's chat.
  - Before routing, `card route` checks who already has the card, in this order: an earlier
    hand-off's card comment ("<Bot> bot on it, chat <id> ..., machine <m>"), a bot item of this
    computer's bots that links the card's URL or names its key in its title (open first, then done;
    canceled ones and the router's own do not count), the owner's answer to an earlier
    "Which bot takes KEY?" item (its done-means names `card route KEY`) when it names one bot, and
    that question while it still waits. The first two print `kind: owned` and the third hands off to
    the answered bot (`via: chosen`); the last prints `kind: asked` with its item. None opens a chat
    or a question. `--bot <name>` still moves a card to a different bot; naming the bot that has it
    prints `owned`. A failed lookup routes as before.
  - Owner inference: when no label or map entry decides, `fork.cardRoute.claims` (asked of this
    computer and each paired server with a bot) lists each running bot's repos: the projects it
    loads skills from (`skillProjects`) and the repos its SOUL.md names, by display name and folder
    name. The card's title, description, project and labels are matched against them (a whole-word
    repo name; else a relative file path in the card that exists in that repo, checked on the host,
    never outside the repo). Exactly one bot is the owner (`via: inferred`, source the repo); none or
    several go on to the defaults, and several become the choices if it still has to ask.
  - `forkCardNoProjectBot` (unset by default): the bot for a card with no Linear project, after
    inference and before the default chain, even with `forkCardAskOwner` on (`via: no-project`).
    With it unset, a no-project card already reaches `forkCardDefaultBot`, the bot that ran the
    route or the router without asking; the only path that asked was `forkCardAskOwner`.
  - Reads need no terminal: `bot item list --bot X` already took a bot, and `bot item show` takes
    `--bot X` too (refusing another bot's item), so both work from a plain shell.
  - Owner token: Settings > Blackfish > Remote servers > Owner token creates, replaces or revokes
    one token (none exists by default). It is shown once; the host keeps only its SHA-256 in
    `fork-owner-token.json` (owner-only mode). `fork.ownerToken.mint`, `.revoke` and `.status` are
    refused for an agent's CLI (`ownerOnly`). `orca bot item answer <id> --text T [--question eN]
    [--plain] [--bot X] [--request-id R] [--owner-token-file P] [--json]` reads the token from the
    file (refused unless no group or other access, except on Windows) or `ORCA_OWNER_TOKEN` and calls
    `fork.botItems.ownerAnswer`, the only thing the token allows: the token is compared in constant
    time, then the owner panel's own `bots.items.owner.comment` body runs with the actor
    `{kind: owner, device: owner-token}`, so it answers the question, moves a Needs you item to In
    progress and mails (wakes) the bot exactly as a UI answer does. The comment ends with
    "_Answered via owner token._" and the host logs each answer and each refused token, never the
    token.
  - Code is in `src/cli/fork/card-route-prior-owner.ts`, `card-route-lookups.ts`,
    `card-route-format.ts`, `bot-item-answer*.ts`, `src/shared/fork/card-owner-inference.ts`,
    `src/shared/fork/owner-token.ts`, `src/main/fork/card-routing/card-route-claims.ts`,
    `src/main/fork/owner-token/`, `src/main/runtime/rpc/methods/fork/fork-owner-token.ts` and
    `src/renderer/src/fork/owner-token/`.

- **Tasks GitHub list: one slow project cannot block the rest (BAD-703).** The Tasks > GitHub
  list (PRs and Issues, All projects) merged every project's answer with one `Promise.all`, and
  every list call held one of 8 shared request slots until it answered. A project or host that
  never answered (a paired server that accepts the call and says nothing, a stuck SSH relay)
  kept the list on skeleton rows with no error, and enough of them took every slot.
  - **Cause.** Local calls (`window.api.gh.listWorkItems`) had no deadline in the renderer, and the
    remote path's 30 s timer starts only after the compatibility probe, which has none. Only a host
    already known unreachable was skipped. The main process was healthy in the same session: its
    trace showed 7.8k git spans, none stuck, so the wait was in the renderer fan-out.
  - **Fix.** Each project's list and count call is bounded (40 s, `GITHUB_SOURCE_DEADLINE_MS`), which
    also frees its slot. The merged list bounds each project at 60 s from the start, slot wait
    included. A project that times out or fails with no cached rows is dropped from the merge and
    named in `failedSources`; the list fills with the rest.
  - **Display.** One row per failed project: its name, "did not answer in time" or the error, and a
    Retry (the list's refresh). The old "N of M projects failed" line shows only for failures
    that have no named source. Issues uses the same list code, so it behaves the same.
  - Code is in `src/shared/fork/github-source-deadline.ts` and
    `src/renderer/src/fork/github-source-errors/`.

- **Model and effort per automation (BAD-704).** A project or bot automation can name the model
  and effort its runs use, such as Claude Opus 5.5 at xhigh. "Agent default" keeps each as it was.
  - The Create/Edit automation dialog shows Model and Effort rows under the Agent field, with the
    lists the chat composer's model menu offers that agent. A project automation keeps them as its
    launch preferences (`launchPreferences.model` and `options.effort`); a bot automation (runs in
    a new conversation) in its own agent setup.
  - Runs use them for chat and terminal launches. They also win over a model or effort flag in the
    Arguments, which used to make a chat run follow the Arguments; the dialog says so.
  - `orca automations create|edit` accept `--model` and `--effort` on a project automation
    (`--provider ... --repo ...`); an empty value goes back to the default, and they cannot be
    combined with `--extra-agent-args`. `automations list` and `show` print them, and the
    automation's detail card and its row tooltip show them.
  - Code is in `src/renderer/src/fork/automation-model-effort/`,
    `src/shared/automations/launch/automation-model-effort-summary.ts` and
    `src/cli/automations/automation-project-launch-flags.ts`.

- **Completion contract: Orca checks a worker's done before it settles the Task (BAD-676).** A
  worker's `worker_done` used to settle its Task at once, so only the coordinator or you could
  catch a false done. A Task can now declare done checks, and Orca runs them when the worker
  reports done. A Task that declares none behaves exactly as before.
  - **Declaring.** `orchestration task-create` and `orchestration worker-start` take
    `--done-check '<command>'` (repeatable, up to 8), `--require-pr-checks` and
    `--done-max-rounds <1-10>`. The commands come only from that request, which the coordinator
    writes; nothing a worker writes is ever run. They are stored with the Task in two fork-owned
    tables of the orchestration database (`fork_done_contracts`, `fork_done_attempts`, created on
    first use, so upstream's schema version is untouched).
  - **Checking.** On a succeeded `worker_done` for a Task with a contract, Orca runs each command
    in the worker's workspace, on the host that workspace lives on: this computer, WSL through
    `wsl.exe`, or an SSH workspace through the app's own SSH connection. A worker that reports
    `failed` is not asked to prove it. `--require-pr-checks` reads the pull request of the
    workspace's branch with `gh` in that workspace and needs it open, at the commit the workspace
    has checked out (so a commit that was never pushed fails), with every required check green
    (when the repository has no required checks, every check on that commit). Checks still
    running are not a failure: the report is turned back without using a round, at most 10
    times. A folder (non-git) workspace supports command checks only.
  - **Pass.** The done settles the Task as before, and the checks' result is added to the done
    message the coordinator reads.
  - **Fail.** The worker's `orca orchestration send --type worker_done` fails with the output's
    last lines in a fenced block that is marked as data, not instructions (the fence is longer
    than any backtick run inside it), and the Task stays open. The worker fixes the work and
    reports again. Nothing reaches the coordinator for a turned-back report.
  - **Escalation.** Once failures pass the limit (the Task's `--done-max-rounds`, else
    `forkCompletionContractMaxRounds`, default 2) the done is not settled: it is delivered to the
    coordinator as an `escalation` message with the last output, and the Task is listed in
    `orca contract show` as escalated. The coordinator re-dispatches the Task or accepts it with
    `task-update`; a later passing done clears it.
  - **Evidence.** `orca contract show <task_id>` (RPC `fork.completionContract.show`) prints the
    declared checks and every attempt with its exit code, time and the tail of its output.
  - **Settings** (Settings > Blackfish, `orca settings`): `forkCompletionContract` (on; off makes
    every contract a plain done), `forkCompletionContractMaxRounds` (2),
    `forkCompletionContractTimeoutSeconds` (600 per command; a command past it is killed by its
    own handle and counts as failed), `forkCompletionContractOutputLines` (40).
  - **Decision inbox.** An escalated Task is a row "Task <id>" (`orca inbox list` shows it as
    `done-checks`) until the Task completes or you dismiss it. It has no chat to answer: the
    reason names `orca contract show`. The inbox source is installed where the orchestration
    database opens, so it lists after a restart once orchestration has been used.
  - **Limits.** The gate runs on the host that holds the Task's database: a worker started
    `--on` a paired server is judged there only when that server runs this fork build and
    receives the flags.
  - Code is in `src/main/fork/completion-contract/` (`completion-gate.ts` the settle/bounce rule
    over the store, `check-runner.ts`, `pr-checks.ts`, `contract-store.ts`,
    `completion-gate-live.ts` the hooks), `src/shared/fork/completion-contract.ts` (the pure
    state machine, fencing and settings), `src/cli/fork/completion-contract-*.ts` and
    `src/main/runtime/rpc/methods/fork/fork-completion-contract.ts`.

- **Reviewer gate: a second agent reviews a worker's head before its done settles the Task (BAD-683).**
  Cross-model review was a ritual run by hand. A Task can now ask for it, and Orca runs it when the
  worker reports done. A Task that asks for none (and with `forkReviewerGateAllTasks` off) behaves
  exactly as before.
  - **Asking.** `orchestration task-create` and `worker-start` take `--review`, `--review-focus
    correctness|security|perf`, `--review-agent claude|codex` and `--review-max-rounds <1-10>`
    (any of them asks for a review). The reviewer is the other provider than the worker's (Claude
    worker, Codex reviewer; anything else is reviewed by Codex). `forkReviewerGateAllTasks` makes
    every Task ask. The request is stored with the Task in two fork-owned tables of the
    orchestration database (`fork_review_gates`, `fork_review_runs`, created on first use).
  - **Order.** The completion contract (BAD-676) runs first: a second agent is never asked to
    review work whose own done checks fail.
  - **Review.** The first `worker_done` of a head (the checkout's commit plus its uncommitted
    changes, hashed) starts exactly one reviewer on that head, in the worker's workspace on the
    host the workspace lives on, and the report is turned back at once ("held", the Task stays
    open). The reviewer is a command from settings, run with a prompt Orca writes (the head, the
    focus, read-only rules; no worker text). Defaults are read-only by the tool's own flags:
    `codex exec --sandbox read-only` and `claude -p --permission-mode plan` with read and
    `git diff/log/show/status` tools only, `--disallowedTools Edit Write`. Orca also reads the
    checkout before and after: a review that changed it is not trusted (an error run). The
    reviewer ends with `VERDICT: CLEAN` or `VERDICT: FINDINGS <n>`.
  - **Result.** It is sent to the worker's own chat (or terminal) as a message: findings fenced as
    data from another agent, or "clean, report done again". A clean head settles the Task on the
    worker's next report with `Reviewed by <reviewer> (<model>)` added to the done message; a
    report of the same head with findings is turned back without a new review or a round.
  - **Rounds.** Each review that finds something is a round, up to the Task's `--review-max-rounds`
    else `forkReviewerGateMaxRounds` (2). A new head is reviewed again; past the limit (the
    worker is told the rounds are used up) the next report is delivered to the coordinator as an
    `escalation` and the Task stays open. A review that gave no verdict (timeout, no VERDICT line,
    the checkout changed) is retried on the next report of the head, then escalates.
  - **Evidence.** `orca contract show <task_id>` also lists the review request and every run:
    reviewer, model, head, round, status, findings count and the findings text.
  - **Settings** (Settings > Blackfish, `orca settings`): `forkReviewerGate` (on; off makes every
    request a plain done), `forkReviewerGateAllTasks` (off), `forkReviewerGateMaxRounds` (2),
    `forkReviewerGateTimeoutSeconds` (1200), `forkReviewerGateMaxConcurrent` (2 reviews at once on
    a host; the rest wait), `forkReviewerGateOutputLines` (120), `forkReviewerClaudeCommand` and
    `forkReviewerCodexCommand` (empty is the read-only default; `{prompt}` and `{model}` are filled
    in; the line is run with `exec`), `forkReviewerGateModel` (empty is the tool's own default).
  - **Security.** The command comes from settings and the prompt from Orca, never from a worker.
    The reviewer's words reach the worker and the coordinator only inside a fence longer than any
    backtick run in them. A reviewer that reads a hostile repository can be talked into a
    wrong verdict: a clean verdict is evidence, not proof.
  - **Limits.** Folder (non-git) workspaces have no commit, so they are not reviewed. The gate runs
    on the host that holds the Task's database. The result message is sent when the worker is idle
    (retried for about 8 minutes); a worker that never receives it is not stopped, but nothing
    wakes it. The review does not use the agent launch queue (BAD-518); `forkReviewerGateMaxConcurrent`
    bounds it. No Decision inbox row yet: an escalation is the message to the coordinator.
  - Code is in `src/main/fork/reviewer-gate/` (`reviewer-gate.ts` the engine over the store,
    `reviewer-store.ts`, `reviewer-gate-live.ts` the hooks), `src/shared/fork/reviewer-gate.ts`
    (params, settings, prompt, verdict parser, the pure decision and texts),
    `src/cli/fork/reviewer-gate-flag.ts` and the review part of `fork.completionContract.show`.

- **Goal loop: keep any agent going until a check or a judge passes (BAD-682).** Goals were
  harness-native (Codex and Grok thread goals, Claude /goal), so a terminal agent or a provider
  without a goal mode could not be told "keep going until the tests pass", and nothing capped such a
  loop. `orca goal set` gives every agent the pattern, under Orca's own limits. With no goal set
  nothing is read and no agent is touched.
  - **Setting a goal.** `orca goal set <id> (--until-cmd '<command>' | --until-judge '<criteria>')
    [--max-rounds <n>] [--budget <usd>]` for a native chat of any provider (its session id) or a
    terminal agent (its pane key); a unique prefix of 4+ characters is enough. Exactly one of the
    two `--until` flags. `orca goal list` shows each goal with its rounds, spend and, for a stopped
    one, why; `orca goal clear <id>` removes it. Goals are kept in `fork-goal-loop.json` in the data
    folder (mode 0600), so a restart keeps them; a stopped goal is kept a day.
  - **Each turn end.** A sweep (every 10 s while a goal is active, backing off to 2 min with none)
    reads the same idle agents the Sleepers list and idle recovery read, and looks at a turn end
    once, after the agent rested `forkGoalLoopIdleSeconds`. A goal set on an agent that is already
    idle looks at that ending at once. An agent with background work pending is not looked at. The
    check is `--until-cmd`, run in the agent's workspace (exit 0 is met), or the judge. A failure
    is sent to the agent as a continue message with the output's last lines in a fenced block that
    is marked as data, not instructions. The send is idle recovery's: never into a chat that is
    asleep or in a turn, nor a terminal with typed text or a dialog, and never twice.
  - **Judge.** `--until-judge` runs the command in `forkGoalJudgeCommand` (none by default, and
    the flag is refused without it). It is one shell line that reads a JSON object on stdin
    (`criteria`, and `agent_output`, the agent's last message fenced as untrusted data) and prints
    `{"met": true, "reason": "..."}` or `met` / `not met` and a reason. A failed, slow or
    unreadable judge is "not met": it never ends a goal. The judge is skipped once the budget is
    spent.
  - **Stops.** The loop stops on success; after `--max-rounds` continue messages (else
    `forkGoalLoopMaxRounds`, 10); when the spend since the goal was set reaches `--budget`; or when
    the same failure comes back `forkGoalLoopStallLimit` times in a row (2). A failure is the
    check's output with digits, ids and times taken out, plus a fingerprint of the workspace (its
    uncommitted changes and head commit): the same output with the workspace changed is progress,
    not a stall. Also `unreachable` (a judge is missing, or the agent refused five sends) and
    `gone` (the agent closed, which ends the goal quietly).
  - **Where a stop is told.** Every stop but success and gone is a row in the Decision inbox
    ("Goal loop", `orca inbox list` shows `goal`; Dismiss removes it), goes to the inbox's notify
    targets, and, with `forkGoalLoopPostToChat` on, is told to the agent in its chat in one line
    (the agent answers it, which costs one short turn). A passing goal needs none of these.
  - **Budget.** Counted from the usage ledger BAD-679 feeds (Claude and Codex chats, and Claude
    Code and Codex terminals). An agent the ledger knows nothing of counts as $0, so its goal is
    stopped by rounds and stalls only.
  - **Security.** The command and the criteria come only from the `orca goal set` request, never
    from what an agent wrote; the check output and the agent's words reach the agent and the judge
    only inside a fence longer than any backtick run in them. The check runs with the user's own
    rights in the agent's workspace, with a timeout (`forkGoalLoopTimeoutSeconds`).
  - **Hosts.** Each host runs the loop for its own agents; `--environment` sets a goal on an agent of
    a paired server, which must run this fork build. An agent in an SSH workspace is not looked at.
  - **Settings** (Settings > Blackfish, `orca settings`): `forkGoalLoop` (on; off pauses every
    goal), `forkGoalLoopIdleSeconds` (15), `forkGoalLoopMaxRounds` (10), `forkGoalLoopStallLimit`
    (2), `forkGoalLoopTimeoutSeconds` (600), `forkGoalLoopOutputLines` (40),
    `forkGoalLoopPostToChat` (on) and `forkGoalJudgeCommand` (none).
  - **Not done.** It does not detect a harness's own /goal and defer to it; and goals are not yet
    drawn as a row in the chat or in the Sleepers and crew views.
  - Code is in `src/main/fork/goal-loop/` (`goal-engine.ts` the turn-end step, `goal-service.ts`
    the sweep and the set, clear and list, `goal-live.ts` the wiring, `goal-judge.ts`,
    `goal-send.ts`, `goal-store.ts`, `goal-inbox.ts`), `src/shared/fork/goal-loop.ts` (the pure
    stop rules, signatures, fencing and settings), `src/shared/fork/goal-loop-wire.ts`,
    `src/cli/fork/goal-loop-*.ts` and `src/main/runtime/rpc/methods/fork/fork-goal-loop.ts`.
- **Worker retry policy: Orca restarts a failed worker after a backoff (BAD-681).** A worker that
  exited, was lost or stopped on a provider error used to raise an escalation and wait for the
  coordinator or you, so one flaky provider error overnight stalled a whole batch. With a retry
  policy on, Orca restarts the worker itself. Off by default.
  - **Policy.** `forkWorkerRetry` (Settings > Blackfish, off) switches it on for every Run; a Run's
    own policy overrides it either way: `orca retry policy --run <run_id> [--on | --off]
    [--max <0-10>] [--backoff <seconds>] [--clear]` (stored in the fork-owned
    `fork_run_retry_policy` table). Without `--run` it shows what the settings give. Other
    settings: `forkWorkerRetryMax` (2 restarts per Task), `forkWorkerRetryBackoffSeconds` (30: the
    first wait, doubling each time) and `forkWorkerRetryMaxBackoffSeconds` (300: the cap).
  - **What is retried.** A stop reported as `exited` or `lost`, and an `errored` stop whose chat
    request failed with a transient provider kind (`providerUnavailable`, `providerResponseFailed`,
    `providerExited`, `restartFailed`). Never retried: a worker that sent its own worker_done
    (succeeded or failed on purpose), a Task that already completed or failed, a worker that never
    started (the start breaker has its own count), an exit the user or the app chose (`user-close`,
    `quit`), a usage limit, an untyped error, a finished or waiting worker, and a Task past its
    restarts. The decision table is `decideWorkerRetry` in `src/shared/fork/worker-retry.ts`.
  - **How it restarts.** The same path as a message to a finished worker: the worker's own
    workspace, its saved conversation when its agent keeps one, and a new Task whose brief says why
    and repeats the original spec unchanged. No new permissions and no new spec. The restarts of
    one worker chain, so the limit counts across them.
  - **What the coordinator sees.** Instead of the demand to act, a normal status notice "Worker
    ended; Orca is retrying it" with the reason, the wait and "retry N of M", which tells it not
    to start the worker itself. When the retry cannot start, or the limit is reached, it gets the
    usual escalation (the limit case is the unchanged stop report).
  - **Visibility.** `orca retry show [--task] [--run]` (RPC `fork.workerRetry.show`) lists every
    retry with its reason, state (scheduled, started, failed, cancelled) and the Dispatch it
    started; the digest has a "Worker retries" block per host. Retries waiting for their time
    arm again after an app restart.
  - **Not done.** Moving the retry to another host (placement) or to the other provider (chat
    handoff) is not part of this change: a retry stays in its own workspace.
  - Code is in `src/main/fork/worker-retry/` (`worker-retry-live.ts` the hooks and the timers,
    `retry-store.ts`, `retry-digest.ts`), `src/shared/fork/worker-retry.ts`,
    `src/cli/fork/worker-retry-*.ts` and
    `src/main/runtime/rpc/methods/fork/fork-worker-retry.ts`.

- **Agent profiles: named launch bundles that coordinators and the UI pick from (BAD-687).** A
  profile is an agent, an optional model, effort, permission mode, MCP profile and account, an
  optional preamble and a when-to-use note. Nothing is set by default: no profiles exist until the
  user makes or imports one.
  - **Use.** `--profile <name>` on `orca agent launch`, `orca worktree create`,
    `orca orchestration worker-start` and `orca automations create`. The host resolves the name
    from its own settings (`fork.agentProfiles.resolve`), so a paired server applies its own
    profiles and permission policy; the CLI writes the result into the flags the command already
    reads. Order: an explicit flag (`--agent`, `--model`, `--effort`, `--mcp-profile`) wins, then the
    profile. `--agent` that differs from the profile's drops the profile's model and effort. A
    profile model or effort the agent refuses is left out with a `profile note:` line on stderr.
    The preamble goes in front of `--prompt` (launches, automations) or `--spec` (workers) when one
    is given. Launch defaults (SLRM-2102) still fill a model the profile and flags left empty.
  - **Catalog.** `orca profiles list [--json]` gives every profile with its fields and when-to-use
    note, so a coordinator picks a worker without restating flags. `show <name>` prints one with
    its full preamble; `set <name> [--agent ...]` makes or changes one (an empty value clears a
    field); `remove <name>`.
  - **Import.** `orca profiles import [<file-or-folder>]` reads `.claude/agents` and
    `.agents/agents` markdown (frontmatter `name`, `description`, `model`; the body is the prompt)
    and `.codex/agents` TOML (`name`, `description`, `model`, `developer_instructions`). With no
    path it reads those three folders under the current folder and the home folder. The prompt
    becomes the preamble, the description the when-to-use note; a model of `inherit` is none. An
    existing profile name is skipped. `.claude/agents` and `.agents/agents` files import as
    Claude profiles, `.codex/agents` as Codex; `--agent` overrides.
  - **Security.** An imported preamble is not used until `orca profiles confirm <name>`, after
    `show` has printed it; changing the preamble asks again. A profile cannot widen permission:
    its mode is lowered to the agent's permission in Settings > Agents when that is set, else to
    `forkAgentProfilePermissionCap` (default `accept-edits`), and a launch says so.
  - **Settings.** `forkAgentProfiles` (the list, also editable in the settings file or with
    `orca settings`) and `forkAgentProfilePermissionCap`.
  - **Not covered yet.** The permission mode and account are resolved, capped and shown, but a
    launch does not apply them: Orca has no per-launch permission or account input, so the agent
    runs on Settings > Agents' permission and the account chosen with `orca account select`.
    There is no profile picker in the new-chat UI or the automation dialog.
  - Code is in `src/shared/fork/agent-profiles/`, `src/main/fork/agent-profiles/` and
    `src/cli/fork/agent-profile-*`.

- **Services mail a bot's chat as the owner (BAD-742).** A background service that runs outside
  every Orca terminal and chat (an MCP bridge, a scheduler) has no handle to send from, so
  `orca orchestration send` refused it with `no_active_sender_terminal`.
  - **Use.** `orca orchestration send --as-service --to bot:<name> [--chat <id> | --item <n>]
    --subject ... --body-file -` sends with no sender: the host already treats a caller with no
    terminal or chat as the owner's own orchestration, so the mail lands in the chat as the
    owner's. Nothing is set by default; the flag is opt-in per command.
  - **Refused when it could be misused.** From inside an Orca terminal or chat (any of
    `ORCA_TERMINAL_HANDLE`, `ORCA_PANE_KEY`, its scrub-safe alias, `CODEX_THREAD_ID`, a chat
    session marker or id, a bot tools token) it is refused, because that agent's mail is held to
    whom its turn is for and `--as-service` would drop that. It is also refused with `--from`,
    `--on`, a recipient that is not `bot:<name>`, and `worker_done` or `heartbeat`. Without the
    flag, nothing changes: terminals send as their terminal and an identity-less process is
    still refused. The caller reaches Orca the way every CLI call does, with the runtime's own
    authentication.
  - Code is in `src/cli/orchestration/identity/service-sender.ts`.

- **Pause all: one switch that stops every unattended feature from starting work (BAD-685).**
  `orca pause-all` writes one persisted switch; while it is engaged, nothing unattended starts new
  work. Turns already running finish. `orca resume-all` releases it, and `orca pause-status` shows
  it here and on every paired server.
  - **What it stops.** Scheduled and event automations (webhook runs included) record the run as
    skipped with "Paused by pause-all" in run history and launch nothing; idle recovery reads,
    classifies and wakes nothing; the PR babysitter sends no fix request and merges nothing; PR
    nudges send nothing; limit resume leaves parked chats and terminals parked; the automatic
    continue after a restart continues no chat; goal loop steps wait; a due worker retry stays
    scheduled and is looked at again every 30 seconds; worker launches wait in the agent launch
    queue even when the queue is off ("paused by pause-all" shows as the held reason); a card
    routed to a bot (`fork.cardRoute.start`) is refused.
  - **What it never stops.** A person's own chats, sends and launches, "Run now" on an automation,
    `orca limits resume-now`, answering the Decision inbox, and a message an agent sends to a chat
    that already exists. A bot request that opens a new conversation for another bot is not gated.
  - **Fails closed.** The switch is `fork-pause-all.json` in the app's data folder (mode 0600,
    written atomically). A missing file is "not paused"; a file that exists but cannot be read or
    parsed counts as paused, and `orca resume-all` clears it. A process with no app data folder
    (unit tests) reads as not paused.
  - **Paired servers.** `fork.pauseAll.set` sets this host first, then asks every paired server
    (4 at a time, 8 s each) to set its own with `relayed: true`, so servers never fan out again. A
    server that did not answer, has no pause-all or refused is listed by name, in the CLI and in a
    toast. `--hosts local` changes this host only. The setting `forkPauseAllPairedServers` (on)
    makes local-only the default when off.
  - **Who can toggle it.** `fork.pauseAll.set` needs the `host-admin` permission: the local user
    and a paired client that manages this host. `fork.pauseAll.status` is a read. A phone cannot
    change it.
  - **Where it shows.** A Pause button in the status bar (red "Paused" chip while engaged), the
    digest (`paused` on each host's section, a `PAUSED` line in the text digest, so the phone's
    digest shows it), and the held reason of a waiting worker launch.
  - **Not done.** No Pause control in the mobile app itself; mobile reads the digest.
  - Code is in `src/main/fork/pause-all/` (`pause-all-state.ts` the switch, `pause-all-fleet.ts`
    the fan-out), `src/shared/fork/pause-all.ts`, `src/cli/fork/pause-all-*.ts`,
    `src/main/runtime/rpc/methods/fork/fork-pause-all.ts` and `src/renderer/src/fork/pause-all/`.

- **Agent slice limits (BAD-684).** On a Linux server the terminal host already starts every
  terminal in its own systemd user scope, all under one slice that lives and dies with the host.
  This feature puts limits on that slice, so every agent together is capped and the server,
  Tailscale and SSH keep running when one misbehaves.
  - **Off by default.** `ORCA_AGENT_SLICE=1` in the environment that starts `orca serve` turns it
    on. Orca reads it when the terminal host starts, so a host that is already running keeps its
    old limits until it restarts. Nothing changes on macOS or Windows.
  - **Limits.** `ORCA_AGENT_SLICE_CPU_WEIGHT` and `ORCA_AGENT_SLICE_IO_WEIGHT` (default 10, the
    systemd default is 100, so the server wins any contention), `ORCA_AGENT_SLICE_TASKS_MAX`
    (default 25% of the kernel's `pid_max`) and `ORCA_AGENT_SLICE_MEMORY_HIGH` (default 75% of RAM
    plus 25% of swap, at least 512M). `MemoryHigh` throttles and reclaims; it never kills, so memory
    exhaustion becomes a slowdown.
  - **Safe fallback.** Each limit is set on its own with `systemctl --user set-property --runtime`
    and kept only when the slice's cgroup file shows the kernel enforces it. A limit the host
    cannot enforce is skipped, and one `agent-slice` line in the terminal host log lists what was
    applied and what was refused, or says the terminal scopes are off and why. A launch is never
    affected. User slices only, no privilege.
  - **Leftover scopes.** The slice is bound to the terminal host's scope (`BindsTo`), so systemd
    removes the slice and its scopes when the host stops; there is nothing to clean up by hand.
  - **Not done.** Chat providers keep the stock process tree and are not placed in the slice;
    the slice's pressure is not shown in Resource Usage yet.
  - Code is in `src/main/fork/agent-slice/`.

- **Automation run triggers: an automation that starts when another automation's run finishes or fails (BAD-689).**
  A bot automation can listen for `automation.run_succeeded` or `automation.run_failed`, so a
  nightly research run chains into a summary, or a failure into triage, with no webhook or GitHub
  side effect.
  - **Authoring.** `--on "automation.run_failed automation=<id,...> bot=<id,...> depth=<n>"`.
    `automation=` limits it to runs of those automations (default: any other automation); `bot=`
    to automations of those bots; `depth=` narrows the chain depth limit for this rule. Shown in
    `orca automations trigger-options`.
  - **What counts.** A run that ends `completed` raises `run_succeeded`; a run that ends
    `dispatch_failed` raises `run_failed`. Skipped runs and events a bot's chat answered in a turn
    raise nothing. An automation never starts itself.
  - **The switch.** Having an `automation.*` rule is that automation's "can be triggered by
    automations" switch: nothing chains into an automation without one. `forkAutomationChaining`
    (default on) switches every chained start off on this host.
  - **Loop guard.** Each chained run records its depth on its event (`event.chain.depth`: 1 for
    a run started by an automation that a person or schedule started). A start deeper than
    `forkAutomationChainMaxDepth` (default 3, 1 to 10; a rule's `depth=` can only lower it) is not
    run: the target gets a skipped run (`skipped_unavailable`) saying "Chain depth limit: ...", and
    the chain stops. A skipped run raises no event, so the refusal cannot loop.
  - **Untrusted payload.** The run summary (automation name, run number, error, the end of the
    output) goes in the event's quoted text, so it is fenced as information, never instructions;
    only the source, event and time sit outside the fence.
  - **Same path as other triggers.** A chained start goes through `runForEvent`, so Pause all,
    the spend caps, dedupe (one start per source run, key `automation:<runId>:<event>`) and the
    missed-run grace apply. Rules are checked on this host and never sent to Orca Cloud.
  - **Not done.** No event for a run that is skipped or still running; no dedicated authoring
    field in the Automations editor (rules show in the events list; author them from the CLI).
  - Code is in `src/shared/automation-chain-triggers.ts`, `src/main/automations/automation-chain-runs.ts`
    (matching and depth) and `automation-chain-start.ts` (starting and recording refusals), and
    `src/cli/automations/automation-chain-trigger-spec.ts`.

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
48. `SLRM-1569 The update card shows the restart guard's wait instead of staying on Installing`
49. `SLRM-1758 Stamp the fork version into the shipped orcad template`
50. `SLRM-1758 Follow upstream 1.4.255's moved renderer modules in fork code`
51. `SLRM-1966 Sidebar agent rows wear their tab's color dot`
52. `SLRM-1966 Follow upstream 1.4.256's moved modules in fork code`
53. `SLRM-1966 Tint done chat rows and ring tab colors in the collapsed agent strip`
54. `SLRM-2095 Sidebar agent rows count the workers, sub-agents and tasks they own`
55. `SLRM-2097 Custom app themes: paste or import a whole app theme`
56. `SLRM-2096 Lost work: find and handle unmerged or lost work across agent worktrees`
57. `SLRM-2093 Chat sleep: idle native chats give up their provider, on screen chats stay awake`
58. `SLRM-2105 Follow upstream 1.4.258's moved modules in fork code`
59. `SLRM-2099 Truthful memory: whole process trees, system memory and a warning`
60. `SLRM-2098 Agent launch queue: a limit on running agents with a queue for the rest`
61. `SLRM-2127 Chat stall marks stuck chats, writer kill under a broker, broker test hang`
62. `SLRM-2100 Worker cleanup: finished workers give up their agent, with guards and Undo`
63. `SLRM-2102 Launch defaults: a default model and effort per kind of launch`
64. `SLRM-2094 Sleepers: list, sleep, wake and pin chats and terminal agents in one place`
65. `SLRM-2106 Agent state colors: tabs and agent rows colored by agent state`
66. `SLRM-2101 MCP profiles: choose which MCP servers a chat loads`
67. `SLRM-2136 Agent lifecycle: memory pause queues, Sleepers shows stalled and queued`
68. `SLRM-2103 Cache-cold cue: a usage ledger and a hint when an idle chat cache has expired`
69. `SLRM-2104 Usage report: tokens and estimated cost per chat, coordinator, workspace, day or card`
70. `SLRM-2105 Sync status: fork-sync publishes its outcome, the update check shows when the fork is behind`
71. `SLRM-2138 Fork main passes every push and pull request check`
72. `SLRM-2160 Settings from the CLI: orca settings lists, edits, exports and applies every setting`
73. `SLRM-2175 Lost work scan: batched git reads, shared repositories read once, progress`
74. `SLRM-2196 Idle recovery skeleton: settings, contracts and hooks, off by default`
75. `SLRM-2206 Finish orca inbox: table, prefix ids, answer and pause`
76. `SLRM-2208 Notify by desktop, webhook or command when chats start waiting on the user`
77. `SLRM-2204 Idle recovery: run the classifier command, add the built-in check`
78. `SLRM-2207 Decision inbox: toolbar button, dialog, palette entries and the paused list`
79. `SLRM-2203 List idle recovery candidates and read their endings`
80. `SLRM-2205 Idle recovery: the sweep, the wake and the Decision inbox service`
81. `SLRM-2211 Idle recovery: whole-feature test, paused and stalled rows, user guide, example classifier`
82. `SLRM-2216 Follow upstream 1.4.259's moved modules in fork code`
83. `SLRM-2216 Fix the settings JSONC line on Bun and the agent queue list params for the mobile RPC fence`
84. `SLRM-2228 Give the fork settings their own Settings pane, with one project list`
85. `SLRM-2230 Lost work: in-use guard, select all, project groups, suggested actions, bulk summary`
86. `SLRM-2257 Boundary compaction: ask an idle chat with a large context to compact between turns`
87. `SLRM-2263 Chat survive: carry chats over an app update, say why a claim is refused`
88. `SLRM-2266 Auto placement: pick the machine with the most spare CPU and memory for --on auto and --host auto`
89. `SLRM-2267 Endpoint failover: try a saved server's routes in order and move back to the better one`
90. `SLRM-2265 Worktree move: move a workspace and its chats to another host`
91. `SLRM-2264 Pairing on a pinned bind: pair a server bound to a Tailscale or LAN address, and release the Linux server tarballs`
92. `SLRM-2270 APFS clone: fast new worktrees on macOS with copy-on-write clones of node_modules and, opt-in, the checkout`
93. `SLRM-2271 Device approval and webhook automations: approve new paired devices, start automations from signed webhooks`
94. `SLRM-2278 Follow upstream 1.4.261's moved modules and APIs in fork code`
95. `SLRM-2269 Snooze: hide a workspace or chat until a time, its merge or idle days, waking early when it needs you`
96. `SLRM-2307 Settings on a server: orca settings writes a headless host's own store, and boundary compaction runs there`
97. `SLRM-2311 Server health: alert when a paired server stops answering and when it is back, and an optional heartbeat`
98. `SLRM-2309 Limit resume: resume chats and terminal agents when a usage limit resets`
99. `SLRM-2310 Server updates: update every paired server from the desktop over its own RPC, with a rollback`
100. `SLRM-2316 Follow upstream 1.4.262's moved modules and native provider launch in fork code`
101. `SLRM-2349 Chat visuals: show image files and take unquoted values, and servers --wait takes a separate value`
102. `SLRM-2383 Worktree ports: a block of ports per workspace, exported as ORCA_PORT and ORCA_PORT_0..N-1`
103. `SLRM-2386 PR babysitter: send a pull request's chat fix requests when CI fails, merge on green when allowed`
104. `SLRM-2384 Keep main current and server memory protection: fetch and fast-forward default branches, orca serve service protect`
105. `SLRM-2392 Pooled limits: Claude and Codex usage limits pooled across every account and paired server`
106. `SLRM-2390 Row status: spend, context, pull request checks and a fix button on agent rows`
107. `SLRM-2385 Agent guards: warn and pause agents stuck in a failure loop or past a spend cap`
     Follow-up: an inbox answer to a guard-paused agent lifts the pause only once the send is taken.
108. `SLRM-2394 Branch clashes: warn when parallel worktree branches change the same files, across paired servers`
109. `SLRM-2395 Batch start: a prompt per worktree and model from the composer, placed with auto placement`
110. `SLRM-2393 Best of N: one task to 2 to 4 agents in their own worktrees, compared and picked`
111. `SLRM-2312 Set up on a server: clone a project onto a paired server that lacks it from the host picker or --setup-missing`
112. `SLRM-2391 Chat handoff: hand a chat from Claude to Codex or back with a budgeted history`
113. `SLRM-2396 Review guides: an agent-written tour of a pull request in a Guide tab, on the phone and in orca review-guide`
114. `SLRM-2387 Agents on the iPhone Lock Screen: a Live Activity and an Agents widget`
115. `SLRM-2405 Typecheck caps: environment variables for parallel projects and tsrs checker threads`
116. `SLRM-2388 Digest: what finished, failed, merged and cost, and what waits on you, across this host and its paired servers`
117. `SLRM-2397 Small extras: approval triage by risk, workspace tags and archive on merge, prompt stash, saved prompts`
118. `SLRM-2389 Letters and the board: chats message each other between turns, and agents file asks for the user`
119. `SLRM-2406 Set up on a server from the phone and from batch start's Auto machine`
120. `SLRM-2408 Follow upstream 1.4.263's moved modules in fork code`
121. `SLRM-2411 Chat survive: an Orca env key only one launch has does not refuse adoption, say why in the start error`
122. `SLRM-2428 Quick task on the phone: a Feed button and sheet that send a typed or dictated task to the paired computer's router`
123. `SLRM-2428 Quick task: a shortcut box hands a typed or spoken task to the bot that owns it`
124. `SLRM-2459 Bot starting rules: a setting for the rules a new bot's SOUL.md starts with`
125. `SLRM-2453 Decision inbox: bot asks listed, answered, counted and told once`
126. `SLRM-2472 Bot row: clicking a bot that needs you shows its first waiting ask`
127. `BAD-635 Bot model: orca bot set for one bot or all, and a launch default for new bots`
128. `BAD-641 Bot ask answers: one typed answer may be as long as an item comment, 8,000 characters` (empty since the 1.4.268 resync: upstream replaced typed decision answers with comment replies, so no cap is left to raise)
129. `BAD-640 Bot connect: orca bot connect links connected Linear and GitHub to one bot or all`
130. `BAD-642 Bot items: open and show a worker that runs on a paired server`
131. `BAD-658 Bot row: needs-you and working badges, an idle look and a color per bot`
132. `BAD-658 Bot chats: list a handed-off chat under its bot, open it from the row's line and from the handoff card`
133. `BAD-669 Worker archive: remove finished workers' own workspaces when safe, stop idle terminals, hide and close bot chats`
134. `BAD-694 Card routing: a Linear card goes to its bot by label or project map, and its work carries the card`
135. `BAD-703 Tasks GitHub list: a project that never answers times out on its own row with a Retry, and the rest of the list fills`
136. `BAD-704 Automations: pick the model and effort of a project or bot automation, in the dialog and the CLI`
137. `BAD-707 Usage-limit continue: a forgotten draft no longer holds it for good, the bot row says Paused: usage limit, continues at HH:MM`
138. `BAD-715 Nothing waits on the owner: bots finish and merge their own work, a card nothing routes goes to a default bot, and the card comment names the receiving bot's chat`
139. `BAD-542 BAD-524 Lost work counts a live worker chat as in use and its CLI waits for the whole scan; usage report links workers to their coordinator chat`
140. `BAD-560 Auto-continue filter: replace the fork unattended-resume pass; upstream continues cut chats, the fork limits it to workers and automation runs unless forkAutoContinueInteractive`
141. `BAD-734 Auto-close finished bot chats: card done, reported back or idle; the list clients get leaves closed chats out; orca bot chats-cleanup`
142. `BAD-677 Worktree snapshots: save uncommitted, untracked and unpushed work under refs/orca/snapshots before any worktree removal; orca worktree snapshots and restore`
143. `BAD-676 Completion contract: --done-check and --require-pr-checks on a Task; Orca runs them before a worker's done settles it, turns a failure back to the worker as untrusted output, and escalates after the rounds`
144. `BAD-678 Turn checkpoints: shadow-git file checkpoints at the end of each agent turn for every harness; orca checkpoint list, diff, restore and undo`
145. `BAD-735 Fork sync merges each upstream tag into main as one signed merge commit instead of rebasing, so main is never force-pushed; a conflict stops before the build with a FORK-SYNC-CONFLICT marker`
146. `BAD-680 PR nudges: the PR watcher's owning chat gets new review comments (fenced, deduplicated) and a rebase request per conflicted head; attempt-capped into the Decision inbox; off by default`
147. `BAD-679 Spend caps for every agent: Codex chats and Claude Code or Codex terminals are priced into the ledger; caps per Run and per automation (run, day, 7 days); guards list shows every cap with its spend`
148. `BAD-682 Goal loop: orca goal set keeps any agent going until a check command or a judge passes, under a round limit, a budget and a stall limit; a stop is told in chat and the Decision inbox`
149. `BAD-681 Worker retry policy: Orca restarts a worker that exited, was lost or hit a provider error in its workspace after an exponential backoff, up to a limit; per Run or by setting, off by default; orca retry policy and show`
150. `BAD-684 Agent slice limits: on Linux the terminal host's systemd slice gets CPUWeight, IOWeight, TasksMax and MemoryHigh, so a runaway agent cannot take the server down`
151. `BAD-683 Reviewer gate: --review on a Task has a second agent (the other provider) review the worker's exact head read-only before its done settles; findings go back to the worker as a message, rounds are capped, then the Task escalates`
152. `BAD-685 Pause all: orca pause-all stops schedulers, automations, idle-recovery wakes, babysitter and nudge sends, unattended resume, goal steps, worker retries and worker launches from starting work, here and on paired servers; running turns finish; a switch that cannot be read counts as paused; status-bar toggle, digest line`
153. `BAD-686 Command guards: Orca-managed deny rules for an agent's shell commands (delete outside the workspace, force push, default-branch rewrites, worktree removal) in Claude Code's PreToolUse hook, with per-project allows, an audit list and a list of unguarded agents; orca command-guards`
154. `BAD-737 Card routing: an owned card is never routed or asked about twice, the owner is inferred from the repos a card names, forkCardNoProjectBot; owner token for orca bot item answer from any shell`
155. `BAD-687 Agent profiles: named launch bundles (agent, model, effort, permission mode, MCP profile, account, preamble, when-to-use note); --profile on agent launch, worktree create, worker-start and automations create; orca profiles list|show|set|remove|import|confirm; import from .claude/agents, .codex/agents and .agents/agents with the preamble held until confirmed`
156. `BAD-742 Services mail a bot's chat as the owner: orchestration send --as-service`
157. `BAD-688 Session export: orca agent export writes a chat or terminal agent session as Markdown, one self-contained HTML file or JSON with secrets and home paths redacted by default, and --share publishes the redacted file as an unlisted artifact link; Copy chat as Markdown in the chat tab menu`
158. `BAD-689 Automation run triggers: automation.run_succeeded and automation.run_failed start a bot automation when another automation's run ends, with the run summary quoted as untrusted text, a per-automation switch (having the rule), a chain depth limit (forkAutomationChainMaxDepth, default 3) that records a skipped run when it stops a chain, and forkAutomationChaining to turn it off`

The Settings page carries three one-line hooks for the fork's own pane (SLRM-2228):
`settings-navigation-types.ts` lists the `fork` pane id, `useSettingsNavigationMetadata.ts`
spreads `buildForkSettingsNavSections` and `settings-page-renderer.tsx` calls
`renderForkSettingsSection` (all three from `src/renderer/src/fork/settings-pane/`).
`AdvancedPane.tsx` no longer renders any fork setting. Where a section below says
`AdvancedPane.tsx` renders a fork setting, `ForkSettingsPane.tsx` renders it.

`AppRootSurfaces.tsx` carries one hook for the fork's always-mounted hosts: `ForkRootHosts`
(`src/renderer/src/fork/ForkRootHosts.tsx`) renders `ForkChatSleepReporter`,
`ForkWorkerCleanupReporter`, `ForkSleepersDialogHost` and `ForkUsageReportHost`. Where a section below says
`AppRootSurfaces.tsx` mounts one of those, it is mounted there.

`src/cli/dispatch/handler-group-manifest.ts` carries one hook for the fork's CLI commands: it
spreads `FORK_HANDLER_GROUPS` (`src/cli/fork/fork-handler-groups.ts`). Where a section below says the
manifest lists a fork command group, it is listed there.

Fork-only code lives in `fork/` folders:

- `src/shared/fork/`
- `src/main/fork/`
- `docs/fork/`
- `src/main/updater/fork/`
- `src/preload/fork/`
- `src/renderer/src/components/native-chat/fork/` (since upstream 1.4.261 this folder also holds
  upstream's own `ForkMarkedName.tsx` and `fork-marked-name-text.ts`, the "Fork" mark of a forked
  conversation; those two are upstream code)
- `src/renderer/src/fork/`
- `src/cli/fork/`
- `mobile/src/components/fork/`
- `mobile/modules/fork-live-activity/`
- `mobile/plugins/fork/`
- `config/scripts/fork/`
- `native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/fork/`
- `native/computer-use-macos/Tests/OrcaComputerUseMacOSTests/fork/`

- **Usage ledger and cache-cold cue (SLRM-2103).** One small ledger of per-call token usage
  of native Claude chats, kept by the main process (`src/main/fork/usage-ledger/`).
  - **The ledger.** A hook in Claude's structured event delivery passes every live frame to it.
    Assistant frames carry the usage of one API call under its message id (input, output, cache
    read and cache write, with the 1 h share); the ledger counts each call once, keeping the
    highest counts a repeated frame reports, and includes sub-agent calls. Root `result` frames
    end a turn; `system/init` gives billing (`apiKeySource` `none` means an account sign-in, so
    a subscription); a compaction resets the context size. Transcript imports never pass that
    hook, so nothing is counted twice. Codex and terminal agents are not counted.
  - **Saved.** `fork-usage-ledger.json` in the app's data folder, written atomically at most
    every 10 s and on quit. Per chat: name, workspace, the coordinator that dispatched it (from
    the agent queue's worker note), billing, turns, and tokens and calls per day and model. Kept
    `forkUsageRetentionDays` days (90) and at most 2000 chats, oldest dropped first. The prune
    runs at start-up, then hourly, backing off to every 6 h while nothing ages out (SLRM-2138).
  - **The cue.** When a chat has sat idle past its cache lifetime and its last context is at
    least `forkCacheColdThresholdTokens` (50000), the composer shows "Cache likely expired: the
    next message re-reads about N tokens", and the chat's tab and agent rows show a snowflake.
    The lifetime is the one the usage reported (1 h when the last call wrote 1 h cache, 5 min
    when it wrote 5 min cache), else `forkCacheWindowMinutes` (5). Nothing shows while a turn
    runs. "Compact first" sends `/compact`, then any waiting draft through the composer's own
    send (its handle's `submit`), which queues it behind the compaction. Sending is never
    blocked.
  - **Settings** (Settings > Blackfish): `forkCacheColdCue` (on), `forkCacheWindowMinutes` (5),
    `forkCacheColdThresholdTokens` (50000).

- **Usage and cost report (SLRM-2104).** Reads the usage ledger (SLRM-2103) and adds up tokens
  and an estimated cost (`src/main/fork/usage-ledger/usage-report.ts`).
  - **Groups.** Per chat, per coordinator (a chat plus every worker and sub-agent it
    dispatched, following the worker's parent chat), per workspace, per day, or per card. A card
    comes from `forkUsageCardPattern`, a regular expression over the workspace name (group 1 or
    the whole match, case-insensitive). It is empty by default, so no card names are built in.
    A range of 1, 7, 30 days or everything kept.
  - **Prices.** `forkUsagePrices` is the user's table, USD per million tokens per model. Empty
    means the app's own Claude prices (`claude-model-pricing.ts`). A row for the exact model id
    or its family wins and is applied flat, without long-context rates. A model with no price
    shows "+?". Every cost is marked as an estimate. A chat on a subscription (`apiKeySource`
    `none`) counts its tokens only, shown as "subscription": it is not billed per token.
  - **Where.** "Usage report" in the command palette and in Settings > Blackfish > Usage report
    (with the card pattern, the history kept and the price table), and
    `orca usage-report [--by chat|coordinator|workspace|day|card] [--days N] [--json]` over
    runtime RPC (`fork.usageLedger.report`). "Clear history" in the report forgets the ledger.
  - **Worker link (BAD-524).** A worker's coordinator is read from the `from` it was started with.
    A chat coordinator spells it `orca_session_id:<id>`, which was not parsed, so no chat was
    ever linked and the coordinator rollup stayed one row per chat. History saved before this
    stays unlinked.
  - **Settings** (Settings > Blackfish): `forkUsageCardPattern` (empty), `forkUsagePrices`
    (empty: built-in prices), `forkUsageRetentionDays` (90, shared with SLRM-2103).
  - **Not covered.** Only native Claude chats counted on this computer. `apiKeySource` `none`
    can also be a cloud provider account rather than a subscription.

- **Row status: spend, context, pull request checks and a fix button on agent rows (SLRM-2390).**
  Sidebar agent rows, compact and full, show small chips after the title, in the child count's
  chip style. Sub-agent rows show none. Code is in `src/renderer/src/fork/row-status/`.
  - **Spend.** A native Claude chat's estimated cost so far, priced like the usage report
    (SLRM-2104, the same user price table). The ledger push that feeds the cache-cold cue now
    carries each chat's `costUsd`, `unpriced` and `billing` (`src/main/fork/usage-ledger/row-spend.ts`),
    so it updates live with no new channel. A subscription chat shows `~$1.23`, what its tokens
    would cost per token; `+` means some models have no price. A compacted chat stays in that
    push with context 0, so its spend does not drop off.
  - **Context.** `ctx 142.3k`: the tokens the chat's last main-thread call read, from the same
    push. Hidden at 0. Terminal agents and Codex have neither chip (the ledger counts native
    Claude chats only).
  - **Pull request.** The workspace's PR or MR number with the card's review glyph, colored by
    its checks: pending, passing or failing (merged, closed and draft keep their state color).
    It reads the same two cache entries as the workspace card, so it follows the stock PR
    watcher and never polls.
  - **Ask agent to fix.** While an open GitHub PR's checks fail, a Fix chip sends the stock
    fix-checks prompt (`buildFixBrokenChecksPrompt`, with the failed jobs' log tails, as the
    Checks panel's fix action builds it) to that row's own agent through the stock agent
    message send, instead of starting a new agent. The checks are read at click time. It shows
    only where the stock AI actions switch is on, and refuses with a toast when the agent is not
    running or cannot take a message.
  - **Settings** (Settings > Blackfish > Agents and workers > Agent row status), all on:
    `forkRowSpend`, `forkRowContext`, `forkRowPrChip`, `forkRowFixChecks` (needs the PR chip).
  - **Hooks.** One element and an import each in `worktree-card-compact-agent-row.tsx` (after
    the child count) and `DashboardAgentRow.tsx` (after the model), and the ledger hook
    `useCacheState` is now exported.

Upstream files only get short hooks, which keeps merges small:

- One line each in `NativeChatCodeBlock.tsx` and `MobileMarkdownCodeBlock.tsx`.
- An optional `executionHostId` on `runQuickCommandInNewTab` and `createTab`, so a Run tab
  opens on the host captured at confirm.
- One provider wrap in `MobileSessionRouteScreen.tsx`.
- Agents on the Lock Screen (SLRM-2387): an import and one hook call in `MobileHomeScreen.tsx`
  (`useForkAgentLiveActivity`), an import and one element in `mobile/app/notifications.tsx`
  (`ForkLiveActivitySettings`), one plugin line in `mobile/app.json` and one extra source in
  `mobile/fingerprint.config.js` (the widget Swift, so a change rebuilds the dev client).
- Quick task on the phone (SLRM-2428): an import and one element (`MobileQuickTaskButton`) before
  the Settings button in the Feed header's `trailing` fragment in `MobileHomeFeedTab.tsx`, and an
  import and one element (`ForkQuickTaskSettings`) in `appearance-settings-screen.tsx`.
- One element and a `relative` class in `worktree-card-compact-agent-row.tsx` for the row
  tint, and an import, one element and a `relative` class on the strip icon in
  `worktree-card-compact-agents.tsx` for the icon ring (SLRM-1966). Since upstream 1.4.261 a
  strip icon carries only its pane key, so the ring finds the tab by pane key across worktrees
  (`resolveAgentIconTabColor`).
- An import and one element in each of those two files for the child count:
  `ForkAgentRowChildTally` before the row's `+N` span and `ForkAgentStripChildTally` after the
  strip's hidden-agent count (SLRM-2095).
- Agent state colors (SLRM-2106): the row's existing `ForkAgentRowTabTint` element in
  `worktree-card-compact-agent-row.tsx` also passes `dotState` and `isUnvisited`, and
  `SortableTab.tsx` gets an import and one `ForkTabHue` element after its unread overlay.
  `ForkAgentStateColorSetting` renders at the end of `AdvancedPane.tsx`.
- The updater feed repoints.
- One call each in `release-channel.ts`, `updater-release-builds.ts` and
  `electron-updater-loader.ts`.
- One `vi.mock` in each of four upstream tests that cover release repos. It swaps in
  `src/shared/fork/testing/fork-release-repo-upstream-policy.ts`, so those tests keep
  covering upstream's channels.
- Fork strings live only as inline `t()` defaults. Upstream's `en.json` files carry no fork
  keys: `verify-localization-catalog.mjs` and `config/i18next.config.ts` skip the fork folders
  listed in `config/scripts/fork/fork-localization.mjs`, except the upstream files it lists in
  `UPSTREAM_SOURCES_IN_FORK_DIRS` (in `native-chat/fork`, which i18next sees through
  `FORK_LOCALIZED_IGNORE_GLOBS`).
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
  wraps `updater:quitAndInstall` in `src/main/updater/lifecycle/main-window-updater.ts`;
  `...forkRestartGuardMenuItems()` follows `checkForUpdatesItem` in
  `src/main/menu/register-app-menu.ts`; and one `notifyForkRestartGuardUpdaterStatus()` call
  after the status send in `src/main/updater/lifecycle/updater-status.ts` refreshes the menu row
  (so do wait progress and the app or a window coming to the front; there is no timed refresh,
  SLRM-2138).
  `app:relaunch` passes a third, deferred callback (cleanup, `relaunchApp`, `quitProcess`) for a
  relaunch that runs after a wait. These come from the import-light
  `src/main/fork/restart-guard/restart-guard-hooks.ts`, which passes through until the guard
  installs, so upstream tests of those files are unchanged. A held restart resolves
  `ForkRestartHeld` (`src/shared/fork/restart-guard-held.ts`), not an error: `app-bridge.ts`
  passes it as `willRestart`'s refusal so the renderer drops its restart state, `app-api.ts`
  widens the two return types, and one `handleForkRestartHeld` call
  (`src/renderer/src/fork/restart-guard-held-toast.ts`) in each of `help-menu-controller.tsx`,
  `AdvancedPane.tsx`, `WindowMaterialSetting.tsx` and `UpdateCard.tsx` clears its spinner and
  shows a neutral toast instead of "Couldn't restart Orca."
- The update card's wait view (SLRM-1569): `src/preload/index.ts` adds
  `forkUpdateInstallWait` (`src/preload/fork/update-install-wait-bridge.ts`) and `api-types.ts`
  types it as optional (one import and one line each), so the web preload needs nothing.
  `UpdateCard.tsx` calls `useForkUpdateInstallWait` (which resets `hasStartedDownload` when the
  guard drops the install) and renders `forkUpdateWaitingCard(...) ??` before its stock
  content (`src/renderer/src/fork/update-install-wait/`).
- Sync status (SLRM-2105): `installForkSyncStatusBridge()` in `src/main/index.ts`;
  `forkSyncStatus` in `src/preload/index.ts` and (optional) in `api-types.ts`, one import and one
  line each; one import and one `<ForkSyncStatusNotice updateState={updateStatus.state} />` under
  the status line in `GeneralUpdateSettingsSection.tsx`; `ForkSyncNoticeSetting` at the end of
  `AdvancedPane.tsx`. Code: `src/shared/fork/fork-sync-status.ts`, `src/main/fork/sync-status/`,
  `src/renderer/src/fork/sync-status/`.
- The chat-survive broker entry (SLRM-1394): one entry in `main-build-entry-points.ts`, and in
  `plain-node-entry-guard.ts` it shares the `daemon-entry` line (a two-name `map`, so the file
  stays under max-lines). The builder overlay adds it to `asarUnpack`.
- Chat survive spawn hook (SLRM-1394): `createClaudeCodeProcessSpawn` passes its `spawnImpl`
  through `forkChatSurviveSpawner` (`src/main/fork/chat-survive/chat-survive-spawn.ts`);
  `spawnProviderProcess` (`src/main/provider-process/provider-process-spawn.ts`) asks
  `forkLegacyProviderLaunch` (`chat-survive-legacy-launch.ts`) whether that spawner wants
  upstream's Node supervisor instead of the native launcher (SLRM-2316, one changed line and an
  import). Upstream wraps the spawned child, so the broker registry finds its entry by the
  child's stdin, which the wrapper keeps;
  `main-process-ready-foundation.ts` awaits `installForkReady(store)` in one line (chat survive's
  install and first readiness check, plus the usage ledger's retention watch), imported
  with `forkPostReadyAppName` from `src/main/fork/fork-ready-foundation-hooks.ts` (one import line,
  so the file stays at max-lines);
  `forkChatSurvive` is in `src/shared/fork/fork-global-settings.ts`; `AdvancedPane.tsx` renders
  `src/renderer/src/fork/ForkChatSurviveSetting.tsx`.
- Chat survive quit hook (SLRM-1394): `createClaudeCodeProcessSpawn` wraps the managed process in
  `forkChatSurviveManaged` (one line), and `evictOwnedStructuredAgentSessions` calls
  `forkChatSurviveQuit` before the stop and skips the stop when it returns true, then awaits
  `forkChatSurviveSettled` (queued record writes and removals) after every session; both come in
  one import from `src/main/fork/chat-survive-quit-hooks.ts`, so the file stays at max-lines
  (`src/main/fork/chat-survive/chat-survive-detach.ts`, `chat-survive-registry.ts`).
- Chat survive adopt hooks (SLRM-1394): `resolveStructuredSessionRecovery` asks
  `forkChatSurviveAdopt` before it stops a proven-alive local owner and skips the stop when it
  returns true; `StructuredAgentSessionHost`'s tab recovery callback goes through
  `forkChatSurviveRecover`, which starts each adopted chat
  (`src/main/fork/chat-survive/chat-survive-adopt.ts`). That file is at max-lines, so
  `forkChatSurviveRecover` and upstream's `createStartupRecovery` come in one import from
  `src/main/fork/session-host-hooks.ts` (SLRM-2138).
- Chat survive consumed hook (SLRM-1394): `openClaudeStreamJsonConnection` hands each message to
  `forkConsumeClaudeMessage` (`src/main/fork/claude-stream-hooks.ts`), which calls `onMessage` and
  then `forkChatSurviveConsumed`, so the replay mark moves past messages the chat consumed
  (`src/main/fork/chat-survive/chat-survive-registry.ts`). The file is at max-lines, so the hook
  replaces the `onMessage` line and its exit-error import comes through the same module
  (SLRM-2138).
- Test runner PATH (SLRM-1394): `run-vitest.mjs` puts `node_modules/.bin` first on the Vitest
  PATH when it runs the pinned Bun. Under Bun the Claude SDK runs a script CLI with `bun`, and the
  pinned binary is `bun.exe`, so without the shim `claude-stop-ack-race.test.ts` and
  `structured-claude-thinking-display-refusal.test.ts` failed with `spawn bun ENOENT` when the
  runner ran outside `pnpm run`.
- Fork settings (SLRM-1503): `global-settings-types.ts` builds `GlobalSettings` on
  `WithForkSettings<GlobalSettingsBase>` (`src/shared/fork/fork-global-settings.ts`, one import
  and one changed line), which adds `forkChatSurvive`, `forkShowAccountChip` and the SLRM-2095
  child count switches (`forkShowChildTally`, `forkChildTallyCountFinished`,
  `forkChildTallyCountTasks`); the file is at max-lines. `AdvancedPane.tsx` renders
  `ForkChildTallySetting` after `ForkAccountChipSetting` (SLRM-2095).
- Account chip hooks (SLRM-1503): `SortableTab.tsx` renders its title through `ForkTabTitle`
  (the stock title span plus the chip, one line, swapping the `TAB_LABEL_WIDTH_CLASSES` import
  so the file stays at max-lines); `DashboardAgentRow.tsx` renders
  `ForkClaudeAccountAgentRowChip` after the agent icon for non-subagent rows (worktree card
  inline rows use it too; the compact row does not); the template `Title` part in
  `card-identity-parts.tsx` adds `ForkClaudeAccountWorktreeChip` after the title;
  `AdvancedPane.tsx` renders `ForkAccountChipSetting`. The chip reads chats through the move
  RPC, so it adds no RPC hook of its own.
- Chat sleep (SLRM-2093): `StructuredAgentSessionIdleSweepDeps` takes an optional `keepAwake`,
  and `tickUnderSerialize` renews and skips a kept-awake session right after its owed-work check
  (one field, four lines). `workspace-process-listing.ts` passes its `idleSweep` through
  `forkChatSleepIdleSweep` (`src/main/fork/chat-sleep/chat-sleep-sweep.ts`), which keeps the
  stock window while the setting is off. `src/main/index.ts` calls
  `installForkChatSleepBridge()` after `installForkRestartGuard()`. `src/preload/index.ts` adds
  `forkChatSleep` (`src/preload/fork/chat-sleep-bridge.ts`) and `api-types.ts` types it as
  optional. `AppRootSurfaces.tsx` mounts `ForkChatSleepReporter` and `AdvancedPane.tsx` renders
  `ForkChatSleepSetting`. The moon and the dim render inside the existing fork hooks
  (`ForkTabTitle`, `ForkClaudeAccountAgentRowChip`, `ForkAgentRowTabTint`), so they add no
  upstream lines of their own. The settings are in `src/shared/fork/fork-global-settings.ts`.
- Chat stall (SLRM-2127): `StructuredAgentSessionIdleSweepDeps` takes optional `stall` and
  `attachStall`; `start()` hands the sweep's tick to `attachStall`, and in
  `tickUnderSerialize` the owed-work branch passes the journal cursor and the lease's owner pid
  to `stall` and, on `release`, retires the chat with the sweep's own `stopAgent` and
  `closeConversation`; a chat not held busy is reported with null. `forkChatSleepIdleSweep`
  returns the stall hooks too, so `workspace-process-listing.ts` is unchanged; like
  `keepAwake`, they reach the sweep through the untyped spread of `idleSweep` (the host deps
  type picks only `intervalMs` and `idleMs`, and that file is over the line budget).
  `src/main/index.ts` calls `installForkChatStallBridge()` through `installForkChatBridges()`
  (`src/main/fork/chat-bridges-app-hooks.ts`, SLRM-2408) after the chat sleep bridge;
  `src/preload/index.ts` adds `forkChatStall` and `api-types.ts` types it as optional;
  `AdvancedPane.tsx` renders `ForkChatStallSetting`. The marks render inside `ForkTabTitle` and
  `ForkClaudeAccountAgentRowChip`. The account move's `stopTurn` moved to
  `src/main/fork/chat-host-turn-stop.ts`, which Interrupt shares.
- Writer kill (SLRM-2127): `killProviderWriter` in `provider-process-teardown.ts` matches writer
  groups under `forkProviderWriterParents(child.pid, snapshot)` instead of `child.pid` alone
  (one import, two lines).
- Broker test (SLRM-2127): the "refuses a broker that welcomes in another protocol version"
  test in `chat-survive-broker.test.ts` hung until its 30 s timeout because its fake server
  never read its socket, so it never saw the client hang up and `server.close()` waited
  forever. The fake now reads and drops the hello; the code under test was right.
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
- Custom app themes (SLRM-2097): `useAppThemePaint`
  (`src/renderer/src/app-shell/appearance/use-app-theme-paint.ts`, so pop-out windows paint it
  too) calls `useForkCustomAppTheme`, which takes precedence over the plugin and Match Terminal
  paint and does not wait for the plugin list; its `appTheme` type admits the custom paint.
  `useDocumentAppearance` (`src/renderer/src/app-shell/appearance/use-document-appearance.ts`) calls
  `useForkCustomAppThemeExtras` last for the radius and UI font.
  `usePluginAppThemeSync` (`plugin-themes.ts`) prefers `activeCustomAppThemePaintId`, so the
  startup cache of a custom theme is not cleared before the plugin list loads.
  `AppearanceInterfaceSection.tsx` renders `ForkCustomAppThemeSetting` after the theme slots.
  The settings `forkCustomAppThemes`, `forkCustomAppThemeDark`, `forkCustomAppThemeLight` and
  `forkCustomAppThemeTerminalBefore` join `ForkGlobalSettings` in
  `src/shared/fork/fork-global-settings.ts`.

- Lost work (SLRM-2096), from `src/main/fork/lost-work/`, `src/renderer/src/fork/lost-work/` and
  `src/cli/fork/lost-work-*`:
  - `registerWorkspaceCleanupHandlers` (`workspace-cleanup.ts`) ends with one
    `installForkLostWork(store)` call, which registers the `fork:lostWork:*` IPC handlers and
    gives the RPC method the store.
  - `rpc-method-registry.ts` spreads `FORK_LOST_WORK_METHODS` last, and the generated
    `rpc-params-catalog.generated.ts` lists its params.
  - `src/cli/specs/index.ts` spreads `FORK_LOST_WORK_COMMAND_SPECS`, `handler-group-manifest.ts`
    adds the `fork-lost-work` group, and `cli-command-names.ts` lists `lost-work`.
  - `src/preload/index.ts` adds `forkLostWork` (`src/preload/fork/lost-work-bridge.ts`) and
    `api-types.ts` types it as optional.
  - `workspace-cleanup-dialog-header.tsx` renders `ForkLostWorkButton`, hidden without the
    bridge; `AdvancedPane.tsx` renders `ForkLostWorkSettings`; `forkLostWork` is in
    `src/shared/fork/fork-global-settings.ts`.
  - The list also opens from the command palette (`getForkLostWorkQuickActions`, one spread in
    `cmd-j/quick-actions.ts`) and from the Sleepers dialog, through `ForkLostWorkHost` in
    `ForkRootHosts.tsx`.
  - The faster scan (SLRM-2175) adds no upstream hook: its progress event is one more
    `fork:lostWork:*` channel, sent from `lost-work-host.ts` and read through
    `onScanProgress` on the same preload bridge.
- Sleepers (SLRM-2094): `StructuredAgentSessionIdleSweepDeps` takes an optional `attach`, called
  with the sweep from its constructor, and the sweep gains `sweepNow(sessionId)`, which runs the
  stock `sweepSession` with a `force` flag: no idle window, no keep-awake, and it also refuses a
  starting provider and a queued or mid-delivery send. `forkChatSleepIdleSweep` passes
  `attachForkSleepersSweep` as `attach` and its `keepAwake` also keeps pinned chats awake.
  `rpc-method-registry.ts` spreads `FORK_SLEEPERS_METHODS` last, and the generated
  `rpc-params-catalog.generated.ts` lists their params. `src/cli/specs/index.ts` spreads
  `FORK_SLEEPERS_COMMAND_SPECS`, `handler-group-manifest.ts` adds the `fork-sleepers` group and
  `cli-command-names.ts` lists `sleepers`. `quick-actions.ts` spreads
  `getForkSleepersQuickActions()`, `AppRootSurfaces.tsx` mounts `ForkSleepersDialogHost` and
  `SidebarToolbar.tsx` renders `ForkSleepersButton`. `forkSleepersPinned` is in
  `src/shared/fork/fork-global-settings.ts`.

- Memory truth (SLRM-2099):
  - `src/main/memory/collector.ts` reads the process table through
    `readForkUnixProcessTable()` (adds the process group) and returns
    `forkAugmentMemorySnapshot(...)`, which adds `forkTruth` and makes the stock rows and totals
    count whole trees. The collector stays electron-free: chat roots and settings are injected
    by `installForkMemoryWatch`, called in `src/main/index.ts` after `installForkRestartGuard()`
    (one line; it waits for app ready before its first sample).
  - `forkTruth?` on `MemorySnapshot` (`process-stats-types.ts`), `ForkMemoryGlobalSettings` in
    `fork-global-settings.ts`.
  - The structured chat create handler calls `assertForkAgentLaunchAllowed()`, and
    `openAgentInNewTab` (`launch-agent-in-new-tab.ts`) refuses through
    `forkRefuseAgentLaunchOverMemory()` right after its route is planned (SLRM-2136 moved it
    there from `launchAgentInNewTabWithOutcome`, so it knows whether the launch is a native chat
    that can wait in the queue). The main
    process exposes `isMemoryOverLaunchThreshold()` (`pressure-state.ts`).
  - `src/preload/index.ts` and `api-types.ts` add the optional `forkMemory` bridge.
  - `ResourceUsageStatusSegment.tsx` renders `ForkMemoryStatusCue` and `ForkMemoryTruthSection`;
    `AdvancedPane.tsx` renders `ForkMemorySettings`; `orca diagnostics` wraps its formatter in
    `withForkMemoryTruth`.
  - Not gated: terminal agents launched through the CLI or RPC. Headless `orcad` uses default
    settings and does not count native chats.
- Agent launch queue (SLRM-2098), from `src/main/fork/agent-queue/`, `src/cli/fork/agent-queue-*`
  and `src/renderer/src/fork/agent-queue/`:
  - `claimStructuredAgentSessionAgent` (`structured-agent-session-agent-start.ts`) returns
    `forkAgentQueueClaimStart(...)` around its stock `registerStructuredAgentSessionStart` call,
    with a refusal path for a cancelled launch and a re-claim callback. Off and nothing waiting,
    it calls the stock start directly.
  - `deliverAndSettleWorkerStartReadiness` (`worker-start-readiness-settlement.ts`) calls
    `forkAgentQueueNoteWorker` once, so the gate ranks the chat as a worker of its coordinator.
  - `sendStructuredSessionTurn` (`send-agent-turn.ts`) wraps its settlement wait in
    `forkAgentQueueRaceSettlement`, which ends the wait at once for a queued chat so a worker
    start reports instead of blocking until a slot frees.
  - `src/main/index.ts` calls `installForkAgentQueueApp(() => state.store?.getSettings())`
    after the memory watch install. Settings are read on each launch and on the queue's 2 s
    check, so no settings-change subscription is needed.
  - `rpc-method-registry.ts` spreads `FORK_AGENT_QUEUE_METHODS` last and the generated
    `rpc-params-catalog.generated.ts` lists their params; `src/cli/specs/index.ts` spreads
    `FORK_AGENT_QUEUE_COMMAND_SPECS` last and `handler-group-manifest.ts` adds the
    `fork-agent-queue` group last.
  - `agent-launch.ts` and `worktree-create-agent-launch.ts` call `noteForkQueuedAgentLaunch`
    after printing; `worker-launch-handler.ts` reads `readForkQueuedLaunch` before setting the
    exit code (a queued worker exits 0) and prints `printForkQueuedLaunch` after the result.
  - `src/preload/index.ts` adds `forkAgentQueue` (`src/preload/fork/agent-queue-bridge.ts`) and
    `api-types.ts` types it as optional.
  - `NativeChatStructuredSessionStatus.tsx` renders `ForkAgentQueueBanner` first (it sits right
    under the queued-message list; `NativeChatStructuredSession.tsx` is at max-lines);
    `ForkTabTitle` renders `ForkAgentQueueTabBadge`; `AdvancedPane.tsx` renders
    `ForkAgentQueueSetting` after `ForkChildTallySetting`; the five settings are in
    `fork-global-settings.ts`.
- Claude account pin at terminal spawn: both `spawn-preflight.ts` files (`src/main/ipc/pty/ipc/`
  and `src/main/ipc/pty/runtime/`) now `await forkPinTerminalClaudeAccount(...)`, since it writes
  its pane pointer with `node:fs/promises` (SLRM-2138).
- Worker cleanup (SLRM-2100), from `src/main/fork/worker-cleanup/`:
  - `orchestration-database-binding.ts`: `db.workerAutoReleaseEnabled` also requires
    `!forkWorkerCleanupOwnsRelease(settings)`, one `installForkWorkerCleanup(this, this.store)`
    call starts the sweep, and the settings listener rearms the stock scheduler when
    `forkWorkerCleanup` changes too.
  - `WorkerAutoReleaseActivity.apply` calls `noteForkWorkerTurn(paneKey, working)` first, so the
    sweep knows when a worker was used after it reported.
  - `src/main/index.ts` calls `installForkWorkerCleanupBridge()` through
    `installForkChatBridges()` after `installForkChatSleepBridge()`. `src/preload/index.ts` adds `forkWorkerCleanup`
    (`src/preload/fork/worker-cleanup-bridge.ts`) and `api-types.ts` types it as optional.
  - `AppRootSurfaces.tsx` mounts `ForkWorkerCleanupReporter` and `AdvancedPane.tsx` renders
    `ForkWorkerCleanupSetting`. The held mark renders inside the existing `ForkTabTitle` and
    `ForkClaudeAccountAgentRowChip` hooks. The settings are in
    `src/shared/fork/fork-global-settings.ts`.

- Idle recovery and the Decision inbox, from `src/shared/fork/idle-recovery*.ts`,
  `src/main/fork/idle-recovery/`, `src/renderer/src/fork/decision-inbox/` and
  `src/renderer/src/fork/idle-recovery/`. Off unless `forkIdleSweepMode` is set:
  - `src/main/index.ts` calls `installForkIdleRecoveryBridge()` and `startForkIdleRecovery(...)`
    (with readers of the settings, the settings store and the runtime) after
    `installForkSyncStatusBridge()`. `src/preload/index.ts` adds `forkIdleRecovery`
    (`src/preload/fork/idle-recovery-bridge.ts`) and `api-types.ts` types it as optional.
  - `rpc-method-registry.ts` spreads `FORK_IDLE_RECOVERY_RPC_METHODS`, `src/cli/specs/index.ts`
    spreads `FORK_INBOX_COMMAND_SPECS` and `cli-command-names.ts` lists `inbox`.
  - `quick-actions.ts` spreads `getForkDecisionInboxQuickActions()` and `SidebarToolbar.tsx`
    renders `ForkDecisionInboxButton`; both give nothing while the mode is off.
  - The bot row's ask jump (SLRM-2472): `BotRow.tsx`'s click wraps upstream's
    `openBotFromSidebar(bot, onOpen)` in `forkOpenBotRow(bot, ...)` (one import, one call).
  - Bot asks (SLRM-2453) add no upstream hook: `ForkRootHosts` mounts `ForkBotAsksWatcher`, the
    window bridge gains `reportBotAsks` (`fork:idleRecovery:botAsks`), and the main side reads
    idle recovery's settings and runtime (`forkIdleRecoveryHostReaders`).
  - `orca settings` cannot write the classifier command, the notification command or the
    webhook address (`settings-access.ts`, kind `runs-command`); the Settings screen can.

- Boundary compaction (SLRM-2257), from `src/shared/fork/boundary-compaction.ts`,
  `src/main/fork/boundary-compaction/` and `src/renderer/src/fork/boundary-compaction/`. Off
  unless `forkBoundaryCompactMode` is `on`:
  - `src/main/index.ts` calls `startForkBoundaryCompaction(...)` (with readers of the settings
    and the settings store) after `startForkIdleRecovery(...)`. `src/preload/index.ts` adds
    `forkBoundaryCompaction` (`src/preload/fork/boundary-compaction-bridge.ts`) and
    `api-types.ts` types it as optional.
  - `NativeChatUserMessageRow.tsx` renders `ForkBoundaryCompactionMark` under the message, which
    gives nothing for any row the feature did not send.
  - orcad's `src/main/backend/core-runtime-activation.ts` calls `installForkHeadlessHost(...)`
    (`src/main/fork/headless-host.ts`) before its RPC server is made (one import, one call, with
    the call's result registered as a cleanup). It starts the same sweep with `windowless` set
    and marks the host for `orca settings` writes (SLRM-2307).
  - Since upstream 1.4.261 stores chats in SQLite, it and idle recovery read a chat's newest
    page through the host's `history` (`src/main/fork/chat-journal-tail.ts`, at most 200 rows),
    not the whole current journal.
  - The reporter is mounted in the fork's `ForkRootHosts.tsx` and the card in the fork's
    Settings pane, so neither adds an upstream hook. The five settings are in
    `src/shared/fork/fork-global-settings.ts`.

- Auto-continue filter (BAD-560), from `src/shared/fork/auto-continue.ts`,
  `src/main/fork/auto-continue/` and `src/renderer/src/fork/auto-continue/`:
  - `structured-agent-session-launch-continuation.ts`: the deps take an optional
    `chatsToContinue`, and the automatic `continueAfterRestart` passes its answer as the chat
    list (`await deps.chatsToContinue?.()`; undefined is every chat, as upstream).
  - `legacy-worker-runtime-recovery.ts` passes `() => forkAutoContinueForRuntime(this)`.
  - The card is in the fork's Settings pane; the setting is in
    `src/shared/fork/fork-global-settings.ts`, regenerates the settings catalog and is an
    `agent-limit` key in `settings-access.ts`.

- Limit resume (SLRM-2309), from `src/shared/fork/limit-resume*.ts`, `src/main/fork/limit-resume/`
  and `src/renderer/src/fork/limit-resume/`. On unless `forkLimitResume` is false:
  - `orca-runtime.ts` and orcad's `core-runtime-activation.ts` now call
    `startForkRuntimeSettleServices(...)` (`src/main/fork/runtime-settle-hooks.ts`) in place of
    `startForkUnattendedResume(...)`; it starts limit resume and the other settle services.
  - `runtime-structured-agent-host.ts`: the stock usage-limit continue's `isEnabled` reads
    `forkUsageLimitAutoContinueOn(settings)`.
  - `structured-agent-session-usage-limit-continue.ts`: the chain cap reads
    `forkUsageLimitChainLimit()` (two places), and the sweep and the send's `beforeRun` also skip
    a chat while `this.holds.held(...)`, which asks `forkUsageLimitHeld(id, overdueMs)` (BAD-707, in
    `structured-agent-session-usage-limit-account-hold.ts`: a draft holds only
    `forkLimitResumeHoldMaxMinutes` past the reset).
  - `src/main/index.ts` calls `installForkLimitResumeBridge()` through
    `installForkChatBridges()`, `src/preload/index.ts` adds
    `forkLimitResume` (`src/preload/fork/limit-resume-bridge.ts`) and `api-types.ts` types it.
  - `rpc-method-registry.ts` spreads `FORK_LIMIT_RESUME_METHODS`, `src/cli/specs/index.ts` spreads
    `FORK_LIMITS_COMMAND_SPECS` and `cli-command-names.ts` lists `limits`.
  - Fork files only: the labels render in `ForkTabTitle` and `ForkClaudeAccountAgentRowChip`, the
    card in the fork's Settings pane, and boundary compaction's message box reporter also runs
    (and its list is kept) while limit resume holds for drafts. `forkLimitResumeMessage` is kind
    `runs-command` in `settings-access.ts`.

- Usage-limit continue (BAD-707), small edits in stock files: `bot-usage-limit-stop.ts` no longer
  drops a scheduled stop 10 minutes after its time, and the `bots.usageLimit.continuesAt` string
  (`BotUsageLimitMark.tsx`, `en.json`) reads "Paused: usage limit, continues at {{time}}". The
  setting is in `limit-resume.ts`, `fork-global-settings.ts`, the Limit resume card
  (`ForkLimitResumeSetting.tsx`) and the generated settings catalog.

- Pooled limits (SLRM-2392), from `src/shared/fork/pooled-limits.ts`,
  `src/main/fork/pooled-limits/`, `src/cli/fork/limits-usage-handler.ts` and
  `src/renderer/src/fork/pooled-limits/`. On unless `forkPooledLimits` is false:
  - `FORK_LIMIT_RESUME_METHODS` (a fork file) spreads `FORK_POOLED_LIMITS_METHODS`
    (`fork.limits.machineUsage`, `fork.limits.usage`); `rpc-params-catalog.generated.ts` is
    regenerated with them. `limits-specs.ts` adds `limits usage` and the `fork-limits` handler
    group loads `FORK_LIMITS_USAGE_HANDLERS`.
  - `UsageRosterPanel.tsx` renders `ForkPooledLimitsRoster` after the provider rows.
  - `use-native-chat-composer-catalog.ts` passes its commands through
    `useForkUsageLimitsCatalog`, and `use-native-chat-composer-command-picker.ts` wraps its Orca
    commands in `useForkUsageLimitsCommand`, so `/usage-limits` never reaches the agent.
  - Fork files only: `ForkRootHosts` mounts `ForkPooledLimitsDialogHost`; the card is in the fork's
    Settings pane; the two settings are in `fork-global-settings.ts` and
    `settings-rows-fork.generated.ts` is regenerated.

- Endpoint failover (SLRM-2267), from `src/shared/fork/endpoint-failover*.ts`,
  `src/main/fork/endpoint-failover/` and `src/renderer/src/fork/endpoint-failover/`. On unless
  `forkEndpointFailover` is false:
  - `getPreferredPairedRuntimeConnection` (`runtime-environments.ts`) dials
    `forkActiveEndpointRoute(preferredEndpoint(environment))`, the saved endpoint until the
    failover picks another route. `getPreferredPairingOffer` is untouched.
  - `rpc-method-registry.ts` spreads `FORK_ENDPOINT_ADDRESSES_METHODS`
    (`fork.endpoints.addresses`).
  - `src/main/index.ts` calls `startForkEndpointFailover(...)` once the app is ready.
  - The card and the Remote servers section are in the fork's Settings pane; the section's
    types moved to `fork-settings-pane-types.ts` for the catalog's line budget.

- Server health (SLRM-2311), from `src/shared/fork/server-health.ts`,
  `src/main/fork/server-health/` and `src/renderer/src/fork/server-health/`. On unless
  `forkServerHealth` is false; the heartbeat is off until `forkServerHeartbeatUrl` is set:
  - `rpc-method-registry.ts` spreads `FORK_SERVER_HEALTH_METHODS` (`fork.serverHealth.list`) and
    `src/cli/specs/index.ts` spreads `FORK_SERVER_HEALTH_COMMAND_SPECS`.
  - No other upstream hook: the endpoint failover install feeds the readings and starts the
    heartbeat on the desktop, and `installForkHeadlessHost` starts it on a headless server.

- Server updates (SLRM-2310), from `src/shared/fork/server-update*.ts`,
  `src/main/fork/server-update/` and `src/renderer/src/fork/server-update/`:
  - `rpc-method-registry.ts` spreads `FORK_SERVER_UPDATE_METHODS` and `src/cli/specs/index.ts`
    spreads `FORK_SERVERS_COMMAND_SPECS`; `fork-handler-groups.ts` has one `servers` group for
    `servers health` (SLRM-2311) and `servers list|update|rollback`.
  - `startForkRuntimeSettleServices` (`runtime-settle-hooks.ts`, see Limit resume) also calls
    `startForkServerUpdate(...)`: it settles this host's own update and, with
    `forkServerUpdateAuto` on, starts a run over the paired servers.
  - The card is in the fork's Settings pane; its search entry is
    `server-update-search-entry.ts`, added to the Remote servers section by the catalog.
  - `src/cli/arguments/args.ts` asks `forkFlagTakesValue(commandPath, flag)`
    (`src/cli/fork/value-flags.ts`) before it treats a boolean-listed flag as bare, so
    `servers update|rollback --wait 5` reads like `--wait=5` while every other command keeps
    `--wait` boolean.

- Image files in chat visuals (SLRM-2349), from `src/shared/fork/visual-image-fallback.ts`,
  `src/main/fork/visual-image/` and `src/renderer/src/fork/visual-image/`:
  - `native-chat-visual-directive.ts` imports two hooks: `isNativeChatVisualFileName` also takes
    `forkIsVisualImageFileName(name)` and `parseAttributes` falls back to
    `forkUnquotedVisualAttribute(rest)`. Every caller of the name check (the grammar, the
    `agentSession.readVisual` params, the reader, the renderer placeholder and the guest-theme
    location) follows it. Its test's unquoted case now uses a value with a quote.
  - `native-chat-visual-file-read.ts` takes its byte cap from `forkVisualFileMaxBytes` and asks
    `forkVisualImageDocument` before it decodes text.
  - `mobile-native-chat-visual-read.ts` caps a reply's html at `forkVisualMaxDocumentChars`.
  - `installForkReady` and `installForkHeadlessHost` call `installForkVisualFallbackSettings`;
    `ForkRootHosts` mounts `ForkVisualFallbackReader`; the card is in the fork's Settings pane.

- Agent guards (SLRM-2385), from `src/shared/fork/agent-guards*.ts`, `src/main/fork/agent-guards/`,
  `src/cli/fork/guards-*` and `src/renderer/src/fork/agent-guards/`. The loop guard is on unless
  `forkAgentGuardLoop` is false; the spend cap is off until `forkAgentGuardSpendCapUsd` is set:
  - `server-status-hook-lifecycle.ts` (`respondToHook`) calls
    `forkAgentGuardsObserveHook(source, body, accepted)` before the plugin hooks answer.
  - `startForkRuntimeSettleServices` (`runtime-settle-hooks.ts`) also starts the guards, so they
    run in the desktop app and on a headless server.
  - `src/main/index.ts` calls `installForkAgentGuardsBridge()` through
    `installForkChatBridges()`, `src/preload/index.ts` adds
    `forkAgentGuards` (`src/preload/fork/agent-guards-bridge.ts`) and `api-types.ts` types it.
  - `rpc-method-registry.ts` spreads `FORK_AGENT_GUARDS_METHODS`, `src/cli/specs/index.ts` spreads
    `FORK_GUARDS_COMMAND_SPECS` and `cli-command-names.ts` lists `guards`.
  - Fork files only: the usage ledger tells turn starts and ends (`onForkUsageLedgerTurn`) and
    its chat names moved to `usage-ledger-meta.ts`; `installForkHeadlessHost` starts the ledger
    on a server; the Decision inbox lists, answers and resumes guard rows (idle recovery's
    service is wrapped in `withForkAgentGuardInbox`, its item's `verdict` takes `guard`, and the
    inbox shows while a guard holds an agent); idle recovery's candidates, limit resume (native and terminal)
    skip held agents (`isForkAgentGuardHeld`); the marks render in `ForkTabTitle` and
    `ForkClaudeAccountAgentRowChip`, and the card in the fork's Settings pane.

- Device approval and webhook automations (SLRM-2271), from `src/shared/fork/device-approval.ts`,
  `src/shared/fork/webhooks.ts`, `src/main/fork/device-approval/`, `src/main/fork/webhooks/`,
  `src/cli/fork/device-approval-*`, `src/cli/fork/webhooks-*` and
  `src/renderer/src/fork/device-approval/`, `src/renderer/src/fork/webhooks/`:
  - The `OrcaRuntimeRpcServer` constructor (`runtime-rpc.ts`) calls
    `attachForkDeviceApproval(this, options)` and `attachForkWebhooks(options)`.
  - `runtime-rpc-websocket-dispatch.ts` asks `forkDeviceApprovalWait(...)` once a request's
    device is known and replies `device_approval_pending` when it returns a message.
  - `automation-dispatch-request.ts` passes the automation through `withForkWebhookPayload`
    in upstream's `launchInMain`, so bot and repo targets both get it.
  - `webhooks list` is one command for both (SLRM-2445): `handler-group-manifest.ts` spreads
    `withoutForkSharedHandlerKeys(BOT_HANDLER_GROUPS)` so the fork's handler owns the key and
    passes `--bot` on to upstream's, and `src/cli/specs/index.ts` wraps its list in
    `withForkWebhookList`, which drops upstream's hidden spec for the fork's.
  - `rpc-method-registry.ts` spreads `FORK_DEVICE_APPROVAL_METHODS` and `FORK_WEBHOOK_METHODS`;
    `cli-command-names.ts` adds `devices` and `webhooks`; `src/cli/specs/index.ts` spreads their
    specs.
  - The two cards are in the fork's Settings pane. The settings are in
    `src/shared/fork/fork-global-settings.ts`.

- Launch defaults (SLRM-2102), from `src/shared/fork/launch-defaults/`,
  `src/main/fork/launch-defaults/`, `src/renderer/src/fork/launch-defaults/` and
  `src/cli/fork/launch-defaults-*`:
  - `resolveUnlaunchedIntent` (`agent-launch-intent-resolution.ts`) passes the intent through
    `applyForkCliLaunchDefault` and returns its `forkLaunch`; `runAgentLaunch` (`agent-launch.ts`)
    adds it to the result with `withForkLaunchChoice`.
  - `resolveWorkerStartAgent` (`worker-start-validation.ts`) calls
    `resolveForkWorkerLaunch(runtime, ..., resolveWorkerLaunchPreferences)` instead of
    `resolveWorkerLaunchPreferences` directly.
  - Both launchers in `runtime-automation-service.ts` (chat and terminal) receive
    `withForkAutomationLaunchDefault(runtime, request.automation)`.
  - `composeOrchestrationDispatch` (`orchestration-dispatch-context.ts`) spreads
    `forkWorkerRowLaunch(db, dispatch.id)` last; `AgentStatusOrchestrationContext` gains an
    optional `forkLaunch`, compared in `orchestrationContextsEqual`; the compact agent row builds
    its `title` through `forkAgentRowTitle`.
  - `formatAgentLaunch` (`agent-launch-request.ts`) ends with `...forkAgentLaunchLines(result)`;
    `worker-start-agent-view.ts` adds `modelFrom: forkWorkerModelFrom(value.launch)`.
  - `rpc-method-registry.ts` spreads `FORK_LAUNCH_DEFAULTS_METHODS`, and the generated
    `rpc-params-catalog.generated.ts` lists its params. `src/cli/specs/index.ts` spreads
    `FORK_LAUNCH_DEFAULTS_COMMAND_SPECS`, `handler-group-manifest.ts` adds the
    `fork-launch-defaults` group, and `cli-command-names.ts` lists `launch-defaults`.
  - `AdvancedPane.tsx` renders `ForkLaunchDefaultsSetting`; `forkLaunchDefaults` is in
    `src/shared/fork/fork-global-settings.ts`.
- Agent lifecycle (SLRM-2136):
  - The six lifecycle settings (chat sleep, memory, launch queue, chat stall, worker cleanup,
    launch defaults) render in the fork's own Settings pane (SLRM-2228); the
    `ForkAgentLifecycleSettings` group that held them is gone.
  - The memory hold reaches the queue through the existing `setLaunchHoldReader` seam
    (`installForkMemoryLaunchHold`, called by `installForkMemoryWatch`); no upstream file
    changes for it beyond the moved renderer refusal above.
  - `fork.sleepers.list` adds the chat stall and launch queue entries to its rows;
    `ForkChatStall.tsx` exports its menu as `ForkChatStallMenu` for the Sleepers rows.
    `forkSleepersButton` is in `src/shared/fork/fork-global-settings.ts`.

- MCP profiles (SLRM-2101), from `src/main/fork/mcp-profiles/`, `src/cli/fork/mcp-profile-*`
  and `src/renderer/src/fork/mcp-profiles/`:
  - `claude-structured-launch-resolution.ts` spreads `forkMcpClaudeExtraArgs(...)` last in the
    launch's `extraArgs`; it returns nothing unless a profile other than "all" applies.
  - `dispatcher.ts` runs unary calls through `withForkMcpLaunchScope` (imported through a
    re-export in `rpc-active-caller.ts`, as `dispatcher.ts` is at max-lines). It passes through
    every method but `agent.launch`, `agent.launchReplay`, `worktree.create` and
    `orchestration.workerStart`, which run in an AsyncLocalStorage scope holding the launch kind
    and the raw `forkMcpProfile` param (the methods' own schemas drop it).
  - `structured-agent-session-entry-delegates.ts` calls `noteForkMcpNewChat` in `create`, so a new
    chat records the scope it was launched in.
  - `automation-chat-agent-launch.ts` imports `launchBackgroundAgentOnHost as launchAgentOnHost`,
    which runs the stock launch in the background scope.
  - `rpc-method-registry.ts` spreads `FORK_MCP_PROFILE_METHODS` last and the generated
    `rpc-params-catalog.generated.ts` lists their params; `src/cli/specs/index.ts` wraps
    `COMMAND_SPECS` in `withForkMcpProfileFlag` and spreads `FORK_MCP_PROFILE_COMMAND_SPECS`;
    `handler-group-manifest.ts` adds the `fork-mcp-profile` group;
    `src/main/startup/cli-launch/cli-command-names.ts` lists `mcp-profile`.
  - `agent-launch-request.ts` and `worker-launch-handler.ts` add `readForkMcpProfileFlag(flags)`
    to their params.
  - `src/main/index.ts` calls `installForkMcpProfilesApp(...)` after the agent queue install.
  - `src/preload/index.ts` adds `forkMcpProfiles` (`src/preload/fork/mcp-profiles-bridge.ts`) and
    `api-types.ts` types it as optional.
  - `NativeChatStructuredSessionStatus.tsx` renders `ForkMcpProfileStrip` after
    `ForkAgentQueueBanner`; `AdvancedPane.tsx` renders `ForkMcpProfileSetting` after
    `ForkAgentQueueSetting`; the five settings are in `fork-global-settings.ts`.

- Usage ledger and cache-cold cue (SLRM-2103), from `src/main/fork/usage-ledger/`,
  `src/shared/fork/usage-ledger.ts` and `src/renderer/src/fork/cache-cold/`:
  - `emitClaudeStructuredSessionEvent` (`claude-structured-event-delivery.ts`) calls
    `forkUsageLedgerObserveClaudeEvent(event)` right after the translator handles the event.
  - `src/main/index.ts` calls `installForkUsageLedger(...)` after the agent queue install; it
    loads the ledger once the app is ready.
  - `agent-queue-service.ts` exports `forkAgentQueueWorkerParent` (the dispatching chat).
  - `src/preload/index.ts` adds `forkUsageLedger` (`src/preload/fork/usage-ledger-bridge.ts`)
    and `api-types.ts` types it as optional.
  - `NativeChatComposer.tsx` (the wrapper; the pane is at its line cap) renders
    `ForkCacheColdCue` above the pane and passes the pane a ref from `useForkComposerHandleRef`,
    which also hands the forwarded ref on. `ForkTabTitle` and `ForkClaudeAccountAgentRowChip` render the
    snowflake; `AdvancedPane.tsx` renders `ForkCacheColdSetting` after `ForkAgentQueueSetting`;
    `ForkUsageLedgerSettings` joins `fork-global-settings.ts`.

- Usage report (SLRM-2104), from `src/main/fork/usage-ledger/usage-report*.ts`,
  `src/shared/fork/usage-report.ts`, `src/cli/fork/usage-report-*.ts` and
  `src/renderer/src/fork/usage-report/`:
  - `rpc-method-registry.ts` registers `FORK_USAGE_REPORT_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-usage-report.ts`);
    `rpc-params-catalog.generated.ts` is regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_USAGE_REPORT_COMMAND_SPECS`,
    `handler-group-manifest.ts` adds the `fork-usage-report` group, and `cli-command-names.ts`
    lists `usage-report`.
  - `quick-actions.ts` spreads `getForkUsageReportQuickActions()`; `AppRootSurfaces.tsx`
    renders `ForkUsageReportHost`; `AdvancedPane.tsx` renders `ForkUsageReportSettings` after
    `ForkCacheColdSetting`.
  - The SLRM-2103 ledger IPC and preload bridge (fork files) gain `report`, `clear` and
    `defaultPrices`.

- Settings from the CLI (SLRM-2160), from `src/shared/fork/settings-catalog/`,
  `src/shared/fork/settings-wire.ts`, `src/main/fork/settings-cli/` and
  `src/cli/fork/settings-*.ts`:
  - `src/main/ipc/settings/settings.ts` passes its `settings:set` handler through
    `forkCaptureSettingsSet` before registering it, unchanged, so the fork RPC can call the
    same function. Nothing in the handler is edited.
  - `rpc-method-registry.ts` registers `FORK_SETTINGS_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-settings.ts`): `fork.settings.get` and
    `fork.settings.update`; `rpc-params-catalog.generated.ts` is regenerated with it. On a
    host marked by `installForkHeadlessHost` (orcad) the update is written by
    `forkApplyHeadlessSettings` (`settings-cli-headless.ts`) instead of the captured handler.
  - `src/cli/specs/index.ts` adds `FORK_SETTINGS_COMMAND_SPECS`, the manifest lists the
    `fork-settings` group, and `cli-command-names.ts` lists `settings`.
  - `src/cli/discovery/help.ts` wraps the root help in `withForkSettingsRootHelp`, which adds the
    "Settings:" section, and asks `forkSettingsFlagHelp` first for an option's help line.
  - `package.json` gains the `generate:fork-settings-catalog` script.

- Auto placement (SLRM-2266), from `src/shared/fork/auto-placement*.ts`,
  `src/main/fork/auto-placement/`, `src/cli/fork/auto-placement-*.ts` and
  `src/renderer/src/fork/auto-placement/`:
  - `rpc-method-registry.ts` spreads `FORK_AUTO_PLACEMENT_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-auto-placement.ts`): `fork.placement.load` and
    `fork.placement.pick`; `rpc-params-catalog.generated.ts` is regenerated with it.
  - `src/cli/index.ts` calls `forkResolveAutoPlacement(parsed, ...)` once the runtime client
    class is loaded, before any routing.
  - `src/cli/specs/index.ts` adds `FORK_AUTO_PLACEMENT_COMMAND_SPECS` and wraps the list in
    `withForkAutoPlacementNotes`; `fork-handler-groups.ts` adds the `fork-auto-placement` group
    and `cli-command-names.ts` lists `placement`.
  - The two settings are in `src/shared/fork/fork-global-settings.ts` and
    `settings-rows-fork.generated.ts` is regenerated; the card is in the fork's Settings pane.

- Set up on a server (SLRM-2312), from `src/shared/fork/server-setup*.ts`,
  `src/main/fork/server-setup/`, `src/cli/fork/server-setup-cli.ts` and
  `src/renderer/src/fork/server-setup/`:
  - `rpc-method-registry.ts` spreads `FORK_SERVER_SETUP_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-server-setup.ts`): `fork.serverSetup.plan`,
    `.readiness` and `.run`; `rpc-params-catalog.generated.ts` is regenerated with it.
  - `WorkspaceRunTargetCombobox.tsx` appends the rows from `useForkServerSetupHostOptions`
    (`use-fork-server-setup-host-options.tsx`) to the host options it hands upstream's
    run-target picker: each is a `RunTargetHostOption` listed with the ready hosts that keeps
    the picker open and starts the setup (SLRM-2445, after upstream 1.4.266 rebuilt the picker
    around generic host rows).
  - The auto placement files carry `--setup-missing`: `withForkAutoPlacementNotes` also adds the
    flag to `worktree create`'s allowed flags, and `fork.placement.load` and `.pick` take
    `setupMissing`.
  - Phone (SLRM-2406), from `mobile/src/components/fork/server-setup/`: `NewWorktreeModal.tsx` calls
    `useMobileForkServerRefresh` and `useMobileForkServerSetup`, appends its rows to the run-target
    items and renders its status before the batch toggle in the `forkBatchToggle` slot;
    `NewWorktreeModalDrawers.tsx` takes the rows in its run-target items and sends a picked one to
    `onForkServerSetup`; `use-new-workspace-repositories.ts` takes `serverGeneration` (passed to
    `useServerRepos`) and returns `serverRepos`.
  - The three settings are in `src/shared/fork/fork-global-settings.ts` and
    `settings-rows-fork.generated.ts` is regenerated; the card is in the fork's Settings pane.

- Snooze (SLRM-2269), from `src/shared/fork/snooze*.ts`, `src/main/fork/snooze/`,
  `src/cli/fork/snooze-*.ts` and `src/renderer/src/fork/snooze/`:
  - `rpc-method-registry.ts` spreads `FORK_SNOOZE_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-snooze.ts`); `rpc-params-catalog.generated.ts` is
    regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_SNOOZE_COMMAND_SPECS`, `fork-handler-groups.ts` adds the
    `fork-snooze` group and `cli-command-names.ts` lists `snooze`.
  - `src/main/index.ts` calls `installForkSnoozeApp` through `installForkProjectApps` (SLRM-2394); `preload/index.ts` and `api-types.ts` add
    `forkSnooze` (`src/preload/fork/snooze-bridge.ts`).
  - `use-visible-worktrees.ts` reads `useForkSnoozedWorktreeKeys()` and passes its list through
    `forkWithoutSnoozedWorktrees`; `WorktreeCardAgents.tsx` passes its root keys through
    `useForkWithoutSnoozedPanes` and wraps each root row in `ForkSnoozeAgentRowMenu`.
  - `sidebar/index.tsx` renders `ForkSnoozedSection` under the list;
    `WorktreeContextMenuView.tsx` renders `ForkSnoozeWorktreeMenuItem` after the move item.
  - `ForkRootHosts.tsx` mounts `ForkSnoozeCustomDialogHost` and `ForkSnoozeWatcher`; the card is
    in the fork's Settings pane and `forkSnoozeSettleCommand` is a runs-command key in
    `settings-access.ts`.

- Worktree snapshots (BAD-677), from `src/shared/fork/worktree-snapshots.ts`,
  `src/main/fork/worktree-snapshots/` and `src/cli/fork/worktree-snapshots-*.ts`:
  - `worktree-removal.ts` (`performRemoveWorktree`, after the lock check and before Git deletes)
    awaits `forkSnapshotBeforeWorktreeRemoval(repoPath, worktreePath, force, options)`.
  - `installForkReady` and `installForkHeadlessHost` call `installForkWorktreeSnapshots`.
  - `fork-lost-work.ts` spreads `FORK_WORKTREE_SNAPSHOT_METHODS` into `FORK_LOST_WORK_METHODS`
    (`fork.worktreeSnapshots.list|restore|prune`), so `rpc-method-registry.ts` is untouched;
    `rpc-params-catalog.generated.ts` is regenerated with it.
  - `fork-handler-groups.ts` adds the `fork-worktree-snapshots` group and `specs/index.ts` spreads
    `FORK_WORKTREE_SNAPSHOT_COMMAND_SPECS`.
  - `ForkGlobalSettings` gains `ForkWorktreeSnapshotSettings`; the settings catalog is regenerated.

- Turn checkpoints (BAD-678), from `src/shared/fork/turn-checkpoints.ts`,
  `src/main/fork/turn-checkpoints/` and `src/cli/fork/turn-checkpoints-*.ts`:
  - `installForkReady` and `installForkHeadlessHost` call `installForkTurnCheckpoints`;
    `startForkRuntimeSettleServices` calls `startForkTurnCheckpoints` (it subscribes to
    `agentHookServer.subscribeEnrichedStatus`, so no upstream status file changes).
  - `fork-lost-work.ts` spreads `FORK_TURN_CHECKPOINT_METHODS` into `FORK_LOST_WORK_METHODS`
    (`fork.turnCheckpoints.list|diff|restore|undo`); `rpc-params-catalog.generated.ts` is
    regenerated with it.
  - `fork-handler-groups.ts` adds the `fork-turn-checkpoints` group and `specs/index.ts` spreads
    `FORK_TURN_CHECKPOINT_COMMAND_SPECS`.
  - `ForkGlobalSettings` gains `ForkTurnCheckpointSettings`; the settings catalog is regenerated.

- Worktree ports (SLRM-2383), from `src/shared/fork/worktree-ports*.ts`,
  `src/main/fork/worktree-ports/` and `src/cli/fork/worktree-ports-cli.ts`:
  - `spawn-pane-env.ts` (`stampPtySpawnPaneEnv`, every desktop IPC and runtime terminal
    spawn) calls `applyForkWorktreePortEnv(env, pane?.worktreeId)`.
  - `setup-hook-env-vars.ts` (`getSetupEnvVars`) spreads
    `forkWorktreePortSetupEnvFor(identity?.worktreeId)`.
  - `structured-agent-launch-composition.ts` keeps `admittedRecord(...)` as `record` and passes
    `withForkWorktreePortEnv(env, record.location.workspaceId)` to the child seal.
  - `wsl-orca-env.ts` spreads `forkWorktreePortWslenvEntries(env)` into both WSLENV lists.
  - `main-process-pty-startup.ts` (`emitPluginWorktreeLifecycle`, which hears desktop IPC and
    runtime creates and removals) calls `forkWorktreePortsLifecycle(event)` first.
  - `installForkReady` and `installForkHeadlessHost` call `installForkWorktreePorts`;
    `startForkRuntimeSettleServices` calls `startForkWorktreePorts(runtime)`.
  - `rpc-method-registry.ts` spreads `FORK_WORKTREE_PORTS_METHODS`
    (`fork.worktreePorts.get`); `rpc-params-catalog.generated.ts` is regenerated with it.
  - `src/cli/workspace-ports/ports.ts` passes the scan through `withForkReservedPorts` and its
    text through `withForkReservedPortsText`; `src/cli/specs/ports.ts` adds `FORK_PORTS_NOTES`.
  - The four settings are in `fork-global-settings.ts` and `settings-rows-fork.generated.ts` is
    regenerated.
  - `config/main-sync-fs-baseline.txt` allows `worktree-port-registry.ts` its one synchronous
    read of the file, at first use (terminal env is built synchronously); writes are async.

- PR babysitter (SLRM-2386), from `src/shared/fork/pr-babysit*.ts`, `src/main/fork/pr-babysit/`,
  `src/main/fork/idle-recovery/idle-recovery-sources.ts`, `src/cli/fork/babysit-*` and
  `src/renderer/src/fork/pr-babysit/`:
  - `pr-watch-runtime.ts` passes the watcher's deps through `forkPrBabysitAttach(...)`, which
    returns them unchanged and keeps `chatWorkspace` (the call wraps the object literal).
  - `pr-event-delivery.ts` calls `forkPrBabysitLineDelivered(sessionId, delivery)` after each CI
    line it appends. Both hooks are in `pr-babysit-slot.ts`, which loads no fork code at run time.
  - `WorktreeCardReferenceRow.tsx` renders `ForkPrBabysitLine` under a pull request row.
  - `cli-command-names.ts` lists `babysit`. The RPC methods (`fork.prBabysit.*`) are spread into
    `FORK_IDLE_RECOVERY_RPC_METHODS` and the specs into `FORK_INBOX_COMMAND_SPECS`, so the upstream
    registry and spec list need no line; `rpc-params-catalog.generated.ts` is regenerated.
  - `installForkReady` and `installForkHeadlessHost` call `installForkPrBabysit(store)`. The
    Decision inbox (fork code) gains other sources' rows and a `babysit` call on its bridge; the
    five settings are in `src/shared/fork/pr-babysit.ts`, joined to `fork-global-settings.ts`.

- PR nudges (BAD-680), from `src/shared/fork/pr-nudge.ts`, `src/main/fork/pr-nudge/` and
  `src/renderer/src/fork/pr-nudge/`:
  - No change to `pr-watch-service.ts` (it sits at max-lines): `pr-babysit-slot.ts`'s
    `forkPrBabysitAttach` also returns the deps through `forkPrNudgeAttach` (`pr-nudge-slot.ts`,
    which loads no fork code at run time), wrapping the watcher's storage to learn each pull
    request's owning chat (the newest PR action's). The service listens to the stock PR read
    observer (`addPRRefreshOutcomeObserver`) itself, as the babysitter does for merges.
  - `installForkReady` and `installForkHeadlessHost` call `installForkPrNudge(store)`.
  - `pr-babysit-github.ts` exports `livePrGhRunner` (the gh runner the babysitter already used).
  - The Decision inbox gains the `nudge` source (`idle-recovery-sources.ts`,
    `idle-recovery-wire.ts`, `ForkDecisionInboxRow.tsx`, `inbox-format.ts`); the five settings are in
    `pr-nudge.ts`, joined to `fork-global-settings.ts`, and the settings pane lists them under idle
    recovery.

- Keep main current and server memory protection (SLRM-2384), from `src/shared/fork/main-sync.ts`,
  `src/shared/fork/serve-protect.ts`, `src/main/fork/main-sync/`,
  `src/main/fork/serve-protect/`, `src/cli/fork/main-sync-*.ts`, `src/cli/fork/serve-protect*.ts`
  and `src/renderer/src/fork/main-sync/`:
  - `startForkRuntimeSettleServices` calls `startForkMainSync(runtime)` (desktop, `orca serve`
    and orcad).
  - `rpc-method-registry.ts` spreads `FORK_MAIN_SYNC_METHODS`; `rpc-params-catalog.generated.ts`
    is regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_MAIN_SYNC_COMMAND_SPECS` and
    `FORK_SERVE_PROTECT_COMMAND_SPECS`; `fork-handler-groups.ts` adds the `fork-main-sync` and
    `fork-serve-protect` groups; `cli-command-names.ts` lists `main-sync`.
  - `src/main/daemon/daemon-entry.ts` awaits `forkRaiseDaemonOomScore()` right after naming the
    process.
  - The settings are in `fork-global-settings.ts` and `settings-rows-fork.generated.ts` is
    regenerated; the card is in the fork's Settings pane and its search entry in the pane catalog.
- Batch start (SLRM-2395), from `src/shared/fork/batch-start.ts`,
  `src/shared/fork/use-fork-batch-start.ts`, `src/main/fork/batch-start/`,
  `src/renderer/src/fork/batch-start/` and `mobile/src/components/fork/batch-start/`:
  - `rpc-method-registry.ts` spreads `FORK_BATCH_START_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-batch-start.ts`); `rpc-params-catalog.generated.ts` is
    regenerated with it. `fork-auto-placement.ts` exports `forkPlacementDeps` for its pick.
  - `NewWorkspaceComposerModal.tsx` calls `useForkBatchStartMode`, renders
    `ForkBatchStartModeSwitch` under the title and `ForkBatchStartBox` while it is on (the stock
    card stays mounted, hidden), and skips its Cmd+Enter handler then.
  - Mobile: `NewWorktreeModal.tsx` calls `useMobileForkBatchStart`; `NewWorktreeFormSheet.tsx`
    takes `forkBatchToggle` and `forkBatchBody` and shows the body in place of the form.
  - SLRM-2406: `fork-batch-start.ts` sets a picked server up through `forkServerSetupRunDeps`
    (exported from `fork-server-setup.ts`) and `runForkServerSetupOnEnvironment`.
  - The settings are in `src/shared/fork/fork-global-settings.ts` and
    `settings-rows-fork.generated.ts` is regenerated; the card is in the fork's Settings pane.
- Best of N (SLRM-2393), from `src/shared/fork/best-of/`, `src/main/fork/best-of/`,
  `src/cli/fork/best-of-*.ts` and `src/renderer/src/fork/best-of/`:
  - `rpc-method-registry.ts` spreads `FORK_BEST_OF_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-best-of.ts`); `rpc-params-catalog.generated.ts` is
    regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_BEST_OF_COMMAND_SPECS`, `fork-handler-groups.ts` adds the
    `fork-best-of` group and `cli-command-names.ts` lists `best-of`.
  - `quick-actions.ts` spreads `getForkBestOfQuickActions()`; `ForkRootHosts.tsx` mounts
    `ForkBestOfHost`; the card is in the fork's Settings pane (reusing the snooze card's
    `CommandSetting`, now exported), and `forkBestOfAttemptNote` is a runs-command key in
    `settings-access.ts`.

- Branch clashes (SLRM-2394), from `src/shared/fork/branch-clashes*.ts`,
  `src/main/fork/branch-clashes/`, `src/cli/fork/branch-clashes-*.ts` and
  `src/renderer/src/fork/branch-clashes/`:
  - `rpc-method-registry.ts` spreads `FORK_BRANCH_CLASHES_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-branch-clashes.ts`): `fork.clashes.local` and
    `fork.clashes.scan`; `rpc-params-catalog.generated.ts` is regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_BRANCH_CLASHES_COMMAND_SPECS`, `fork-handler-groups.ts`
    adds the `fork-branch-clashes` group and `cli-command-names.ts` lists `clashes`.
  - `src/main/index.ts` is at max-lines, so its snooze line now calls `installForkProjectApps`
    (`src/main/fork/projects-app-hooks.ts`), which starts snooze and then
    `installForkBranchClashesApp`; `preload/index.ts` and `api-types.ts` add `forkClashes` (`src/preload/fork/branch-clashes-bridge.ts`).
  - The chip renders inside the fork's `ForkClaudeAccountWorktreeChip` (the worktree row hook in
    `card-identity-parts.tsx`), so it adds no upstream line of its own. The settings are in
    `src/shared/fork/fork-global-settings.ts`, `settings-rows-fork.generated.ts` is regenerated,
    and the card is in the fork's Settings pane.
- Small extras (SLRM-2397), from `src/shared/fork/approval-risk*.ts`, `workspace-tags.ts`,
  `prompt-stash.ts`, `saved-prompts.ts` and `src/renderer/src/fork/{approval-triage,workspace-tags,prompt-stash,saved-prompts}/`:
  - `NativeChatApprovalCard.tsx` takes `forkTriage`, renders `ForkApprovalRiskLine` under the
    title and disables an option `forkApprovalOptionHeld` names.
    `NativeChatStructuredPromptCard.tsx` passes the chat's folder and session options;
    `use-structured-prompt-response-hold.ts` carries the folder (`NativeChatStructuredSession.tsx`
    passes `fileLinkContext` on its existing line, the file being at its line budget).
  - `NativeChatWorkerApprovals.tsx` renders `ForkApprovalBulkAllow` over the stack and gives
    each card its worker's folder.
  - `card-identity-parts.tsx` renders `ForkWorktreeTagChips` after the title;
    `WorktreeContextMenuView.tsx` renders `ForkTagsWorktreeMenuItem` after the snooze item;
    `use-visible-worktrees.ts` passes the list through `filterByTag`; `sidebar/index.tsx`
    renders `ForkTagFilterBar` over the list and `ForkArchivedSection` under the Snoozed row.
  - `NativeChatComposerPane.tsx` wraps its key handler in `forkWithPromptStashKey`;
    `NativeChatComposerActions.tsx` adds `ForkSavedPromptsMenu` to the left controls.
  - `ForkRootHosts.tsx` mounts `ForkWorkspaceTagsDialogHost` and `ForkArchiveOnMergeWatcher`; the
    four cards are in the fork's Settings pane, and the four agent-limit keys are in
    `settings-access.ts`.

- Chat handoff (SLRM-2391), from `src/shared/fork/chat-handoff*.ts`,
  `src/main/fork/chat-handoff/`, `src/cli/fork/chat-handoff-*.ts` and
  `src/renderer/src/fork/chat-handoff/`. On unless `forkChatHandoff` is false:
  - `rpc-method-registry.ts` spreads `FORK_CHAT_HANDOFF_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-chat-handoff.ts`); `rpc-params-catalog.generated.ts`
    is regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_CHAT_HANDOFF_COMMAND_SPECS` and `fork-handler-groups.ts`
    adds the `fork-chat-handoff` group (`chat handoff`, `chat history`; `chat` is already listed
    in `cli-command-names.ts`).
  - `SortableTabContextMenu.tsx` renders `ForkChatHandoffTabMenuItems` after the account move
    items. `ForkRootHosts.tsx` mounts `ForkChatHandoffLimitOffer`; the card is in the fork's
    Settings pane.
  - `runtime-settle-hooks.ts` (a fork file) calls `startForkChatHandoffOnLimit`, which listens to
    limit resume's entries. A new chat goes through `createStructuredAgentSessionForWorktree`, the
    create agent launches use, with the handoff as its first message.
  - The settings are in `src/shared/fork/fork-global-settings.ts` and
    `settings-rows-chat.generated.ts` is regenerated.

- Review guides (SLRM-2396), from `src/shared/fork/review-guide*.ts`,
  `src/main/fork/review-guide/`, `src/cli/fork/review-guide-*.ts`,
  `src/renderer/src/fork/review-guide/` and `mobile/src/components/fork/review-guide/`:
  - `rpc-method-registry.ts` spreads `FORK_REVIEW_GUIDE_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-review-guide.ts`); `rpc-params-catalog.generated.ts`
    is regenerated with it. `runtime-rpc-mobile-method-routing.ts` spreads
    `FORK_REVIEW_GUIDE_RPC_METHODS` into the execution-host methods so the phone may call them.
  - `src/cli/specs/index.ts` adds `FORK_REVIEW_GUIDE_COMMAND_SPECS`, `fork-handler-groups.ts`
    adds the `fork-review-guide` group and `cli-command-names.ts` lists `review-guide`.
  - `projects-app-hooks.ts` calls `installForkReviewGuideApp`; `preload/index.ts` and
    `api-types.ts` add `forkReviewGuide` (`src/preload/fork/review-guide-bridge.ts`).
  - `pull-request-page/page/tabs-shell.tsx` renders `ForkReviewGuideTabTrigger` after the Files
    trigger and `ForkReviewGuideTabContent` after the Files content.
  - `MobilePRSidebar.tsx` renders `MobileReviewGuideRow` after the changes card.
  - The settings are in `src/shared/fork/review-guide.ts`, intersected in
    `fork-global-settings.ts`; `settings-rows-fork.generated.ts` is regenerated and the card is in
    the fork's Settings pane.
- Typecheck caps (SLRM-2405), from `config/scripts/fork/typecheck-jobs.mjs`:
  - `run-typecheck-projects-in-parallel.mjs` imports it, wraps the default of
    `runTypecheckProjects`'s `parallelism` in `forkTypecheckParallelism(...)` and the `tsrs`
    default checker count in `forkTypecheckCheckers(...)`.

- Digest (SLRM-2388), from `src/shared/fork/digest*.ts`, `src/main/fork/digest/`,
  `src/cli/fork/digest-*.ts`, `src/renderer/src/fork/digest/` and
  `mobile/src/components/fork/digest/`. The daily send is off unless `forkDigest` is true:
  - `rpc-method-registry.ts` spreads `FORK_DIGEST_METHODS` (`fork.digest.local`,
    `fork.digest.collect`); `rpc-params-catalog.generated.ts` is regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_DIGEST_COMMAND_SPECS`, `fork-handler-groups.ts` adds the
    `fork-digest` group and `cli-command-names.ts` lists `digest`.
  - `startForkRuntimeSettleServices` (`runtime-settle-hooks.ts`) also calls `startForkDigest`.
  - Fork files only on the desktop: the palette entry rides on
    `getForkUsageReportQuickActions()`, `ForkRootHosts` mounts `ForkDigestHost`, the card is in the
    fork's Settings pane, and `forkDigestCommand` is a runs-command key in `settings-access.ts`.
  - Mobile: `app/h/[hostId]/digest.tsx` (the shell route) and `digest.web.tsx` (the page) are new
    route files with no strings; `host-stack-screens.ts` spreads `FORK_HOST_STACK_SCREENS` and
    `host-screen-header.tsx` adds `forkDigestHostAction(...)` to the host menu.
  - `runtime-rpc-mobile-paired-desktop-methods.ts` spreads `FORK_DIGEST_RPC_METHODS`
    (`fork.digest.collect`), so a paired phone may call it and the relaying desktop answers.

- Letters and the board (SLRM-2389), from `src/shared/fork/letters*.ts`,
  `src/main/fork/letters/`, `src/cli/fork/letters-*.ts` and `src/renderer/src/fork/letters/`:
  - `rpc-method-registry.ts` spreads `FORK_LETTERS_RPC_METHODS`
    (`src/main/runtime/rpc/methods/fork/fork-letters.ts`); `rpc-params-catalog.generated.ts` is
    regenerated with it.
  - `src/cli/specs/index.ts` adds `FORK_LETTERS_COMMAND_SPECS`, `fork-handler-groups.ts` adds the
    `fork-letters` group and `cli-command-names.ts` lists `letter` and `board`.
  - `projects-app-hooks.ts` calls `installForkLettersApp`; `preload/index.ts` and `api-types.ts`
    add `forkLetters` (`src/preload/fork/letters-bridge.ts`). `runtime-settle-hooks.ts` calls
    `startForkLetters` (the desktop, `orca serve` and orcad).
  - `NativeChatComposer.tsx` renders `ForkBoardTray` before the cache-cold cue.
  - The Decision inbox (`ForkDecisionInboxHost`, `ForkDecisionInboxButton`,
    `decision-inbox-store.ts`) lists and counts the board's asks and stays on while the board is;
    its palette entries add "Letters between chats...". `ForkRootHosts.tsx` mounts
    `ForkLettersDialogHost`.
  - The settings are in `src/shared/fork/letters.ts`, intersected in `fork-global-settings.ts`;
    `settings-rows-fork.generated.ts` is regenerated, the limits are `agent-limit` keys in
    `settings-access.ts`, and the card is in the fork's Settings pane (Chats).

- Quick task (SLRM-2428), from `src/shared/fork/quick-task*.ts`, `src/main/fork/quick-task/`,
  `src/cli/fork/quick-task-*.ts` and `src/renderer/src/fork/quick-task/`:
  - `electron.vite.config.ts` adds the `quick-task` renderer input (`src/renderer/quick-task.html`).
  - `fork-ready-foundation-hooks.ts` calls `installForkQuickTask(store)` (the shortcut, the box's
    IPC and the quit unregister).
  - `rpc-method-registry.ts` spreads `FORK_QUICK_TASK_METHODS` (`quickTask.submit`);
    `rpc-params-catalog.generated.ts` is regenerated with it. `runtime-rpc-mobile-method-routing.ts`
    routes `quickTask.submit` to the paired desktop.
  - `src/cli/specs/index.ts` adds `FORK_QUICK_TASK_COMMAND_SPECS`, `fork-handler-groups.ts` adds the
    `fork-quick-task` group and `cli-command-names.ts` lists `quick-task`.
  - `preload/index.ts` and `api-types.ts` add `forkQuickTask` (`src/preload/fork/quick-task-bridge.ts`).
  - The settings are in `src/shared/fork/quick-task.ts`, intersected in `fork-global-settings.ts`;
    the generated settings rows are regenerated, `forkQuickTaskPlacementCommand` is a
    `runs-command` key and `forkQuickTaskRouterBot` an `agent-limit` key in `settings-access.ts`,
    and the card is in the fork's Settings pane (Chats); its search entry is in
    `fork-settings-pane-catalog-chats.ts`.
  - Upstream fix (upstream has the same bug in 1.4.266): `src/main/bots/paired-bot-rosters.ts`
    bounds each paired server's `bots.roster` read with its own 4 s deadline. The transport's
    `timeoutMs` covers only the send, not the SSH tunnel preparation before it, so a server whose
    SSH target sat in "connecting" held `bot list` (and the router) until the CLI's 60 s timeout.
    That server now shows as not reachable after 4 s.
  - Same fix for the fork's own fan-outs (SLRM-2447): `src/main/fork/paired-server-call/` wraps a
    paired server call so it rejects with `runtime_timeout` once its own `timeoutMs` passes.
    `orca servers list` (`servers-fleet.ts`) asks every server at once with it and lists one past
    the 10 s status limit as unreachable; an update or rollback run fails that server and goes on.
    The digest, branch clashes, letters, pooled limits and auto placement wire their
    `callEnvironment` through it too.

- Bot starting rules (SLRM-2459), from `src/shared/fork/bot-starting-rules.ts` and
  `src/renderer/src/fork/bot-starting-rules/`:
  - `src/main/bots/bot-controller.ts` passes a seeded bot's `proposalSoul` through
    `forkBotStartingSoul(soul, settings)` (one import, one call); `bot-controller.test.ts` adds one
    test for it.
  - `src/shared/bots/bot-proposal.ts` exports `READ_ONLY_START` (was a private const), so the fork
    replaces exactly upstream's block and the card shows it as the placeholder.
  - The setting is intersected in `fork-global-settings.ts`, `settings-rows-fork.generated.ts` is
    regenerated, `forkBotStartingRules` is an `agent-limit` key in `settings-access.ts`, and the
    card is in the fork's Settings pane (Chats); its search entry is in
    `fork-settings-pane-catalog-chats.ts`.

- Bot model from the CLI (BAD-635), from `src/shared/fork/launch-defaults/launch-defaults-bot.ts`
  and `src/cli/fork/bot-set-*`:
  - `src/main/bots/bot-controller.ts` passes a new bot's create params through
    `withForkBotDefaultLaunch(input, settings)` before `newBotRecord` (one import, one call),
    beside the starting rules hook; `bot-controller.test.ts` adds one test for it.
  - `src/cli/specs/index.ts` adds `FORK_BOT_SET_COMMAND_SPECS` and `fork-handler-groups.ts` the
    `fork-bot-set` group (`bot` is already in `cli-command-names.ts`).
  - `FORK_LAUNCH_KINDS` gains `bot`, so the Launch defaults card, `orca launch-defaults` and the
    generated settings rows list it.

- Bot connect from the CLI (BAD-640), from `src/cli/fork/bot-connect-*`: `src/cli/specs/index.ts`
  adds `FORK_BOT_CONNECT_COMMAND_SPECS` and `fork-handler-groups.ts` the `fork-bot-connect` group.

- Bot items: workers on a paired server (BAD-642), from `src/shared/fork/bot-server-worker.ts` and
  `src/renderer/src/fork/bot-server-worker/`:
  - `BotWorkWorker` (`bot-work-types.ts`) gains `serverOwned?: true`, which
    `readServerOwnedWorker` sets; `BotItemLinkJoin.linkView` adds `server: { environmentId }` to
    such a worker's dispatch link, typed in `bot-items.ts` (`server?: ForkBotItemServerWorker`).
  - `BotChatTreeWorker` (`bot-chat-tree.ts`) gains `forkServer?`; `botItemWorkerRow` spreads
    `forkServerWorkerRow(link)` last, and `botChatTreeWorkerOpen` returns
    `forkServerWorkerOpen(bot, worker)` first when it gives one.
  - `BotItemHeader.tsx` passes the item's links through `useForkServerWorkerLinks(bot, links)`, and
    `BotItemLinkChips.tsx` renders `ForkServerWorkerNote` in the worker chip and its hover card.

- Bot row badges and colors (BAD-658), from `src/shared/fork/bot-row-badges.ts` and
  `src/renderer/src/fork/bot-row-badges/`:
  - `useBotRowLine` (`BotRowActivityLine.tsx`) also returns `counts`, from `forkBotRowCounts`.
  - `BotRow.tsx` calls `useForkBotRowDecor`, passes it to `BotSidebarRow` as `forkDecor` and adds
    `ForkBotColorMenu` to the context menu; `BotSidebarRow.tsx` renders the tint, the picture's
    ring and dim, and `ForkBotRowPills` from it.
  - `BotCollapsedPreview.tsx` renders `ForkBotHeaderRollup` after the faces.
  - Bot chats listed without a tab: `botSidebarListedChats`, `groupBotWorkspacesByChat` and
    `buildBotSidebarTree` take an optional `recent` (`bot-chat-listing.ts`), `BotSidebarChats.tsx`
    passes it; `BotRowPlace` (`bot-row-line.ts`) gains an optional `paneKey`, which
    `BotRowActivityLine.tsx` makes clickable and `BotRow.tsx` opens with `forkOpenBotPlace`;
    `NativeChatBotRequestCard.tsx` puts the subject inside the bot-name button.
  - The settings are intersected in `fork-global-settings.ts`, `settings-rows-*.generated.ts` is
    regenerated, and the card is in the fork's Settings pane (Agents and workers).

- Worker workspace archive and bot chat hide (BAD-669):
  - `installForkWorkerCleanup` (fork) also calls `installForkWorkerArchive(runtime)`, so no new
    line in `orchestration-database-binding.ts`; `worker-cleanup-release.ts` holds the release
    helpers `worker-cleanup-service.ts` used to define.
  - `FORK_LOST_WORK_METHODS` (`fork-lost-work.ts`) also spreads `FORK_WORKER_ARCHIVE_METHODS`
    (`fork.workerCleanup.run`, `.status`, `.focus`, `fork.botChat.close`), so
    `rpc-method-registry.ts`, over its line budget, is untouched; `rpc-params-catalog.generated.ts`
    is regenerated.
  - CLI: `src/cli/specs/index.ts` adds `FORK_WORKER_CLEANUP_COMMAND_SPECS` and
    `fork-handler-groups.ts` the `fork-worker-cleanup` group (`orchestration worker-cleanup`).
  - `card-identity-parts.tsx` renders `ForkWorkerArchiveRowNote` after the Claude account chip;
    `BotRow.tsx` adds `ForkBotHideFinishedMenuItem` and `ForkBotCleanupMenuItem` to the bot menu;
    `BotChatsPanel.tsx` renders `ForkBotCleanupButton`; `ForkRootHosts.tsx` mounts
    `ForkWorkerArchiveReporter` and `ForkWorkerCleanupDialogHost`.
  - `BotSidebarChats.tsx` calls `useForkBotHiddenChats`, passes the hidden set to
    `forkBotChatRecent` and wraps the chat row in `ForkBotChatRowMenu` with `ForkBotChatHideButton`.
    `botSidebarListedChats` skips `recent.hidden`, and `forkListsTablessBotChat` needs a
    `windowMs` above 0, so the rule can carry hidden chats while the window is off.
  - The settings are in `fork-global-settings.ts` and `bot-chat-listing.ts`
    (`ForkBotChatListingSettings`); `settings-rows-*.generated.ts` is regenerated.

- Card routing (BAD-694), from `src/shared/fork/card-routing.ts`, `src/main/fork/card-routing/`
  and `src/cli/fork/card-route*`:
  - `src/cli/specs/index.ts` wraps the spec list in `withForkCardFlag` (`--card` on
    `orchestration worker-start`) and adds `FORK_CARD_ROUTE_COMMAND_SPECS`;
    `fork-handler-groups.ts` adds the `fork-card-route` group and `cli-command-names.ts` lists
    `card`. `worker-launch-handler.ts` spreads `readForkCardFlag(flags)` into its params.
  - `orchestration-worker-start-params.ts` gains `forkCard`, and `worker-worktree-creation.ts`
    passes it to `createManagedWorktree` as `linkedLinearIssue`.
  - `bot-request-conversation.ts` titles a request whose subject `isCardChatSubject` with the
    subject alone.
  - `bot-preamble.ts` adds `forkCardToolLine(BOT_ORCA_CLI)` after the Linear tools line.
  - `FORK_QUICK_TASK_METHODS` (`fork-quick-task.ts`) also defines `fork.cardRoute.start`, so
    `rpc-method-registry.ts` is untouched; `rpc-params-catalog.generated.ts` is regenerated.
  - `forkCardRoutes` is intersected in `fork-global-settings.ts`; `settings-rows-*.generated.ts`
    is regenerated.

- Nothing waits on the owner (BAD-715), small edits in stock files: `bot-preamble.ts` rewords the
  owner-decision rule, the merge-rights rule, the pull request ownership rule and the PR-wait
  prompt (merge a green PR it owns; escalate to the delegating bot first); `quick-task-brief.ts`
  hands a task to the likeliest bot instead of asking. The two settings are intersected through
  `ForkCardRoutingSettings` in `fork-global-settings.ts`; `settings-rows-fork.generated.ts` is
  regenerated.

- Tasks GitHub list (BAD-703), from `src/shared/fork/github-source-deadline.ts` and
  `src/renderer/src/fork/github-source-errors/`:
  - `work-item-routing.ts` wraps `listGitHubWorkItemsForRepo` and `countGitHubWorkItemsForRepo` in
    `withGitHubSourceDeadline`.
  - `work-item-aggregate-actions.ts` bounds each project in `fetchWorkItemsAcrossRepos` and returns
    `failedSources`; `github-slice-contract.ts` types it.
  - `use-task-page-github-list-state.ts` holds `failedSources`; the landing refresh run (and its
    model type) sets it; `List.tsx` renders `ForkGitHubSourceErrors` and hides the generic count
    line when every failure is named.
  - The tests are `github-source-deadline.test.ts` and
    `github-work-items-hung-source.test.ts` (a source that never resolves).

- Auto-close finished bot chats (BAD-734), small edits in stock files:
  - `bots-chat-tree.ts` serves `forkOpenBotChatTree` for a read with no `chatId`; `BotChatTreeRead`
    (`bot-chat-tree.ts`) gains an optional `closedTotal`.
  - `session-recipient.ts` (`prepareSessionRecipient`) and `bots-chats.ts` (`botChatTakingMail`)
    each call `forkReopenAutoClosedChat` first.
  - `installForkWorkerArchive` also calls `installForkBotChatAutoClose`, so no new line in
    `orchestration-database-binding.ts`; `FORK_WORKER_ARCHIVE_METHODS` also spreads
    `FORK_BOT_CHAT_CLEANUP_METHODS` (`fork.botChat.cleanup`, `fork.botChat.older`), so
    `rpc-method-registry.ts` is untouched; `rpc-params-catalog.generated.ts` is regenerated.
  - CLI: `FORK_WORKER_CLEANUP_COMMAND_SPECS` also lists `bot chats-cleanup` and the `fork-worker-cleanup`
    handler group also holds its key, so `specs/index.ts` and the manifest are untouched.
  - `use-bot-chat-tree.ts` returns `closedTotal`; `BotChatsPanel.tsx` calls `useForkClosedBotChats`
    and renders `ForkClosedBotChatsToggle`; `ForkBotRowBadgesSetting.tsx` holds the three settings
    (intersected in `fork-global-settings.ts`; `settings-rows-fork.generated.ts` is regenerated).

- Model and effort per automation (BAD-704), from `src/renderer/src/fork/automation-model-effort/`:
  - `AgentLaunchDefaultsFields.tsx` renders `AgentLaunchModelEffortFields` after Permissions when
    `modelEffort` is set, and `AgentLaunchPicker.tsx` passes that prop through;
    `AutomationAgentLaunchPicker.tsx` sets it. `BotAgentLaunchPicker.tsx` renders the same fields
    (and reads the agent list while they show) for `AutomationBotAgentField.tsx`.
  - `automation-launch-choices.ts` drops a model or effort flag from the Arguments when the
    automation also picks that choice (`automationArgumentsWithoutPickedChoices`).
  - `AutomationDetail.tsx` spreads `automationModelEffortProperties` into its properties and
    `AutomationListLocalRow.tsx` adds `automationModelEffortSummary` to the agent tooltip.
  - CLI: `automations.ts` reads `getProjectLaunchChoicesPatch` into `launchSetupPatch` on create
    and edit; `automation-bot-create.ts` now refuses only `--agent` without `--bot`;
    `automation-format.ts` prints the model and effort; `specs/automations.ts` lists the flags; the
    orca-cli skill guide and `bundled-skill-guides.ts` carry one line on them.

- Completion contract (BAD-676), small edits in stock files: `send-methods.ts` calls
  `forkGateWorkerDone` after `assertSendParamsDeliverable` (a done turned back answers with a
  rejected receipt; an escalated one is sent as an `escalation`); `message-methods.ts` and
  `local-worker-start.ts` call `forkStoreDoneContract` after they create the Task;
  `orchestration-params.ts` (`TaskCreateParams`) and `orchestration-worker-start-params.ts` spread
  `ForkDoneContractShape`; `runtime-orchestration-database-access.ts` calls
  `installForkContractInboxSource` where the database opens; `idle-recovery-wire.ts`,
  `idle-recovery-sources.ts`, `inbox-format.ts`, `inbox-handlers.ts` and `ForkDecisionInboxRow.tsx`
  learn a `contract` row source. `src/cli/specs/index.ts` wraps the spec list in
  `withForkDoneContractFlags` and adds `FORK_COMPLETION_CONTRACT_COMMAND_SPECS`;
  `fork-handler-groups.ts` adds the `fork-completion-contract` group and `cli-command-names.ts`
  lists `contract`; `task-handlers.ts` and `worker-launch-handler.ts` spread
  `readForkDoneContractFlags(flags)`. `fork.completionContract.show` is spread into
  `FORK_BRANCH_CLASHES_METHODS`, so `rpc-method-registry.ts` is untouched;
  `rpc-params-catalog.generated.ts` is regenerated. The four settings are intersected in
  `fork-global-settings.ts`; `settings-rows-fork.generated.ts` is regenerated.

- Spend caps for every agent (BAD-679), small edits in stock files:
  `codex-structured-journal-translation.ts` calls `forkUsageLedgerObserveCodexChatUsage` after
  it records a primary thread's token usage; `automation-dispatch-request.ts` asks
  `forkAutomationCapRefusal` before launching a run and refuses it as `skipped_unavailable`;
  `automation-launch-runner.ts` calls `forkAutomationNoteLaunch` once the run's agent exists. The
  four new settings are in `ForkAgentGuardSettings`, so `fork-global-settings.ts` is untouched;
  `settings-rows-fork.generated.ts` and `rpc-params-catalog.generated.ts` are regenerated.

- Goal loop (BAD-682), small edits in stock files and fork files: `idle-recovery-classifier.ts`
  exports `stopClassifier` for the judge; `idle-recovery-sources.ts`, `idle-recovery-wire.ts`,
  `inbox-format.ts` and `ForkDecisionInboxRow.tsx` learn a `goal` row source;
  `runtime-settle-hooks.ts` calls `startForkGoalLoop`. `src/cli/specs/index.ts` adds
  `FORK_GOAL_LOOP_COMMAND_SPECS`; `fork-handler-groups.ts` adds the `fork-goal-loop` group and
  `cli-command-names.ts` lists `goal`. `fork.goal.set`, `.clear` and `.list` are spread into
  `FORK_BRANCH_CLASHES_METHODS`, so `rpc-method-registry.ts` is untouched;
  `rpc-params-catalog.generated.ts` is regenerated. The eight settings are intersected in
  `fork-global-settings.ts`; `settings-rows-fork.generated.ts` is regenerated.
- Worker retry policy (BAD-681), small edits in stock files: `worker-turn-stop-report.ts` calls
  `forkWorkerRetryOnStop` in `mailWorkerReport` and mails a scheduled retry as a notice instead of
  an escalation; `runtime-orchestration-database-access.ts` calls `installForkWorkerRetry` where
  the database opens. `src/cli/specs/index.ts` adds `FORK_WORKER_RETRY_COMMAND_SPECS`;
  `fork-handler-groups.ts` adds the `fork-worker-retry` group and `cli-command-names.ts` lists
  `retry`. `fork.workerRetry.policy` and `.show` are spread into `FORK_BRANCH_CLASHES_METHODS`,
  so `rpc-method-registry.ts` is untouched. The four settings are intersected in
  `fork-global-settings.ts`; the settings catalog is regenerated. The digest section gains an
  optional `retries` list (`digest.ts`, `digest-schema.ts`, `digest-format.ts`,
  `digest-local.ts`, `digest-runtime.ts`).

- Agent slice limits (BAD-684), one small edit in a stock file: `terminal-scopes-runtime.ts` calls
  `forkApplyAgentSlice(resolved, log)` right after the terminal scopes resolve. The limits are
  environment variables read by the terminal host, so there are no store settings and no catalog
  to regenerate.

- Reviewer gate (BAD-683), small edits in stock files and fork files: `completion-gate-live.ts`
  (`forkGateWorkerDone` runs the review after the contract passed; `forkStoreDoneContract` also
  saves the request); `orchestration-params.ts` (`TaskCreateParams`) and
  `orchestration-worker-start-params.ts` spread `ForkReviewGateShape`;
  `readForkDoneContractFlags` and `withForkDoneContractFlags` carry the four `--review` flags, so
  `task-handlers.ts`, `worker-launch-handler.ts` and `specs/index.ts` are untouched.
  `fork.completionContract.show` gains a `review` field. The nine settings are intersected in
  `fork-global-settings.ts`; `settings-rows-fork-more.generated.ts` is regenerated.
- Pause all (BAD-685), small edits in stock files: `automation-dispatch-request.ts` asks
  `forkPauseAllRefusal` after the spend cap check and refuses a scheduled or event run as
  `skipped_unavailable`; `idle-recovery-sweep.ts`, `idle-recovery-wake.ts`, `pr-babysit-core.ts`,
  `pr-nudge-service.ts`, `limit-resume-native.ts` (`forkUsageLimitHeld`), `limit-resume-service.ts`,
  `auto-continue-chats.ts`, `goal-service.ts`, `worker-retry-live.ts`, `card-route-start.ts` and
  `agent-launch-gate.ts` / `agent-queue-service.ts` ask `isForkPauseAllEngaged`;
  `StatusBarSurface.tsx` renders `ForkPauseAllStatusSegment` after the Caffeinate segment. The
  digest section gains an optional `paused` (`digest.ts`, `digest-schema.ts`, `digest-format.ts`,
  `digest-local.ts`, `digest-runtime.ts`). `src/cli/specs/index.ts` adds
  `FORK_PAUSE_ALL_COMMAND_SPECS`; `fork-handler-groups.ts` adds the `fork-pause-all` group.
  `fork.pauseAll.set` and `.status` are spread into `FORK_BRANCH_CLASHES_METHODS`, so
  `rpc-method-registry.ts` is untouched; `rpc-params-catalog.generated.ts` is regenerated. The one
  setting is intersected in `fork-global-settings.ts`; the settings catalog is regenerated.
- Agent profiles (BAD-687), small edits in stock files: `dispatch.ts` calls
  `applyForkAgentProfile` before each handler (it acts only on the four launch commands when
  `--profile` is given); `withForkMcpProfileFlag` also calls `withForkAgentProfileFlag`, so
  `src/cli/specs/index.ts` only spreads `FORK_AGENT_PROFILE_COMMAND_SPECS`;
  `fork-handler-groups.ts` adds the `fork-agent-profiles` group; `cli-command-names.ts` lists
  `profiles`; `FORK_AGENT_PROFILE_METHODS` is spread into `FORK_LAUNCH_DEFAULTS_METHODS`
  (`rpc-method-registry.ts` is untouched) and `rpc-params-catalog.generated.ts` is regenerated. The two settings are intersected in
  `fork-global-settings.ts`; the settings catalog is regenerated.

- Services mail a bot (BAD-742), two small edits in stock files, `message-send-handler.ts`
  calls `assertServiceSend` when `--as-service` is given and then sends with no `from`, and
  `withForkMcpProfileFlag` also calls `withForkServiceSendFlag` (`src/cli/fork/service-send-specs.ts`),
  which adds the boolean `--as-service` flag, usage and note to the `orchestration send` spec, so
  `src/cli/specs/orchestration.ts` is untouched. The host is untouched.

- Command guards (BAD-686), one small edit in a stock file: `agent-tool-plugin-hooks.ts`
  (`respondAfterAgentToolPluginHooks`) asks `forkCommandGuardAnswer` before it reads the plugin
  hooks and answers with its `deny` when a rule blocks. `startForkCommandGuards(runtime)` is one
  line in `runtime-settle-hooks.ts`; `fork.commandGuards.*` is spread into `FORK_AGENT_GUARDS_METHODS`
  (`fork-agent-guards.ts`), so `rpc-method-registry.ts` is untouched, and `FORK_COMMAND_GUARDS_COMMAND_SPECS` in `src/cli/specs/index.ts`; `fork-handler-groups.ts`
  adds the `fork-command-guards` group. The seven settings are intersected in
  `fork-global-settings.ts`; the settings and RPC params catalogs are regenerated.

- Automation run triggers (BAD-689), small edits in stock files: `automation-event-triggers.ts`
  adds the `automation` source to `AUTOMATION_EVENT_KINDS`, `AutomationEventTrigger`,
  `ConnectorEventSource` (excluded), `AutomationRunEvent.chain` and the validation;
  `automation-service.ts` (`markDispatchResult` calls `startChainedRuns` once a run is final);
  `connector-triggers.ts` keeps `automation.*` rules out of the cloud's list;
  `automation-event-trigger-spec.ts` parses, formats and describes them;
  `bot-event-sources.ts`, `bot-automation-rows.ts`, `bot-automation-when.ts`,
  `automation-run-row-copy.ts`, `automation-run-wording.ts`, `automation-run-message.ts`,
  `automation-run-row-words.ts`, `automation-chat-row.ts`, `automation-event-words.ts`,
  `automation-event-prompt.ts` and `bot-automation-eval-grading.ts` add the new source to their
  per-source tables. The two settings are intersected in `fork-global-settings.ts`; the settings
  catalog is regenerated.

- Session export (BAD-688), two small edits in stock files: `SortableTabContextMenu.tsx` renders
  `ForkSessionExportTabMenuItems` after the chat handoff items, and `src/cli/specs/index.ts` adds
  `FORK_SESSION_EXPORT_COMMAND_SPECS`. `fork.sessionExport.read` is spread into
  `FORK_CHAT_HANDOFF_METHODS` (`fork-chat-handoff.ts`), so `rpc-method-registry.ts` is untouched;
  `fork-handler-groups.ts` adds the `fork-session-export` group. The three settings are
  intersected in `fork-global-settings.ts`; the settings and RPC params catalogs are regenerated.

- Card routing dedupe and owner token (BAD-737), small edits in stock files:
  `bots-items-owner-methods.ts` moves the body of `bots.items.owner.comment` into an exported
  `ownerItemComment(params, context, actor)` that the method calls with `ownerActor(context)`, so
  the owner-token answer runs the same code. `src/cli/bots/bot-items.ts` and
  `src/cli/specs/bot-items.ts` add `--bot` to `bot item show`. `fork.cardRoute.claims` and the
  owner-token methods are spread into `FORK_QUICK_TASK_METHODS`, the `bot item answer` spec into
  `FORK_CARD_ROUTE_COMMAND_SPECS`, so `rpc-method-registry.ts` and `src/cli/specs/index.ts` are
  untouched; `fork-handler-groups.ts` adds the `fork-bot-item-answer` group. The Owner token card
  is in the fork settings pane. `forkCardNoProjectBot` is in `ForkCardRoutingSettings`, so
  `fork-global-settings.ts` is untouched; `settings-rows-fork.generated.ts` and
  `rpc-params-catalog.generated.ts` are regenerated.

`config/electron-builder.config.cjs` is upstream's. Commit 1 edited it and commit 7 restores
it, so the series leaves it as upstream has it. The fork identity is in
`config/scripts/fork/electron-builder.fork.config.cjs`.

## Contributing

Before you open a fork pull request, run these from the repo root (with `pnpm` 12.14.0, for
example `npx -y pnpm@12.14.0`). They are what the push and pull request workflows run, minus
the build and full test jobs.

```sh
pnpm typecheck
pnpm exec vitest run --config config/vitest.config.ts <the test files or folders you touched>
node config/scripts/static-analysis/ratchet-runner/run-ratchets.mjs
node config/scripts/static-analysis/ratchets/runtime-lifecycle/check-main-sync-fs-ratchet.mjs
node config/scripts/static-analysis/ratchets/runtime-lifecycle/check-main-blocking-api-ratchet.mjs
node config/scripts/static-analysis/process-boundaries/check-main-sync-spawn-ratchet.mjs
bun config/scripts/static-analysis/process-boundaries/check-import-boundaries.mjs
node node_modules/oxlint/bin/oxlint --format github
node node_modules/oxlint/bin/oxlint --config config/oxlint-anti-slop.json src config tests mobile --deny-warnings
node node_modules/oxlint/bin/oxlint --type-aware --config config/oxlint-code-quality-type-aware.json src config tests --deny-warnings
node config/scripts/static-analysis/structural-scan/ast-grep-gates.mjs --format=github
bun config/scripts/localization/source-extraction/audit-localization-coverage.mjs --check
node node_modules/oxfmt/bin/oxfmt --check .
```

- A ratchet failure names its rule. Fix the code. Do not raise an upstream file's baseline
  count.
- A fork file may get a baseline entry only for a one-shot startup or shutdown use. Give the
  reason in the commit message and in this file (as SLRM-2138 does).
- The pre-commit hook enforces max-lines: 300 code lines per `.ts` file and 400 per `.tsx` file.
  An upstream file already at the limit takes its fork hook through an existing import line
  (see the `*-hooks.ts` modules in `src/main/fork/`).

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
  hidden while the install runs, and refreshes on every updater status and whenever the app or
  one of its windows comes to the front.
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

A fork release is `M.m.(p*1000+N)`. Here `M.m.p` is the upstream base (the newest stable upstream
tag merged into `main`, found by ancestry; the sync job reads it with
`fork-sync.sh merged-tag`), and N runs from 1 to 999
for each base and starts again at 1 on a new base. For example, upstream `1.4.252` with fork
release 1 is `1.4.252001`, tagged `v1.4.252001`. A fork release on a newer base always sorts
above one on an older base. A base that would need N 1000 fails the build.

`package.json` keeps the upstream version in git (a tag merge takes the tag's version). The sync job works out the next version
with `config/scripts/fork/fork-version.mjs`, and the template and app jobs set it in their own
build copies only. The app version, the orcad template's `out/package.json`, `latest-mac.yml`
and the tag all match it, and the release is a normal release
(not a prerelease).

## Building locally

`node config/scripts/fork/build-mac-fork.mjs` runs the steps that come before packaging in
upstream's `build:mac`, then electron-builder with the fork overlay. Without `FORK_VERSION` it
makes a local build, `<version>-local.<time>.<sha>`. With `FORK_VERSION` set it needs
`package.json` to hold that version, and builds exactly that version. `--prerequisites` runs
only the steps before packaging and `--package` only electron-builder: the release workflow
runs them apart. The overlay signs with upstream's batched signer
(`config/scripts/desktop-distribution/macos/sign-mac-app.mjs`): one `codesign` call per group of
files, where electron-builder's default makes one call per file.

## How sync works

`.github/workflows/fork-sync.yml` runs every day at 09:17 UTC. You can also run it by hand
(Actions, Fork sync, Run workflow). Set `force_build` to rebuild and release anyway. It only
runs in a fork, never in the upstream repository (`stablyai/orca`). Every third-party action is pinned to a full commit SHA.

1. **sync** (ubuntu-latest):
   - Fails at once, with a message, if the `FORK_SYNC_DEPLOY_KEY` secret is empty.
   - Checks out `main` over SSH with that deploy key.
   - `config/scripts/fork/fork-sync.sh detect` finds the newest stable upstream tag with
     `git ls-remote --tags` and `sort -V`, and the newest one already merged into `main` (the
     base, see Base detection).
   - If the newest tag's commit is not under `main`, `fork-sync.sh merge` runs
     `git merge --no-ff <tag>`: one merge commit, SSH-signed when `FORK_GIT_SIGNING_KEY` is set
     (see Signed merge commits). With no newer tag it does nothing (a release-only run).
   - **If the merge conflicts**, the run fails at once, before any install or build: the merge is
     aborted, `main` is untouched and nothing is pushed. The step prints
     `FORK-SYNC-CONFLICT <tag>` as its first line, and the status job puts the same marker on
     the first line of the run summary, followed by the conflicting files and the commands to
     merge by hand (see Sync status and Merge model).
   - **If the merge succeeds**, it installs and checks the result:
     - root typecheck
     - the fork and updater tests
     - mobile install and typecheck
   - It disables every workflow except fork-sync, then pushes with
     `git push origin HEAD:main`, a plain push that fast-forwards (it fails if `main` moved
     during the run, and is never forced).
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
   has the fork version, and uploads it as `orcad-template-fork`. It starts with
   orcad-template, in the same three cases, installs while the lanes run, then waits in a step
   (`fork-run-gate.mjs lanes`) until upstream's `desktop_template` job reports that every lane
   passed. It fails as soon as a lane fails.
4. **build-mac** (macos-15) runs in three cases: `main` changed, `main` has no fork release
   yet, or `force_build` is set. The second case retries a failed build without waiting for a
   new upstream tag. It starts beside the template jobs, since nothing before packaging reads
   the template, and waits for them in steps (`config/scripts/fork/fork-run-gate.mjs`, which
   polls this run's jobs and fails as soon as one it waits for fails).
   - Sets the fork version from sync in the build copy of `package.json`.
   - Imports the fork signing identity (see Signing) and installs arm64 natives only.
   - Runs `node config/scripts/fork/build-mac-fork.mjs --prerequisites`: typecheck, the desktop
     bundles and the native helpers.
   - Waits for the orcad-template-fork job to succeed (`fork-run-gate.mjs fork-template`),
     downloads `orcad-template-fork` to `out/orcad-template`, then runs
     `node config/scripts/fork/build-mac-fork.mjs --package` with
     `ORCA_REQUIRE_ORCAD_TEMPLATE=1`, so the
     build fails if the template is missing. electron-builder ships it as
     `Contents/Resources/orcad-template`, and afterPack signs its Mach-O files with the fork
     identity. A step then checks the app has the template, its darwin-arm64,
     linux-x64-glibc and linux-arm64-glibc targets, and the fork version in its
     `out/package.json`.
   - Checks the app's designated requirement is the fork certificate, so Squirrel.Mac accepts it
     as an update.
   - Checks that `latest-mac.yml` and the app both carry the fork version.
   - Waits until every job of orcad-template has passed, upstream's own template assembly
     included (`fork-run-gate.mjs qualified`). Nothing is published before that.
   - Publishes the arm64 dmg, the arm64 zip and `latest-mac.yml` as release `v<fork version>`.
5. **orca-server-linux** calls upstream's `orca-server-artifact.yml` (unchanged) once
   orcad-template-fork has uploaded, with that template: it packs and smoke-tests
   `orca-server-linux-x64.tar.gz` (ubuntu-24.04) and `orca-server-linux-arm64.tar.gz`
   (ubuntu-24.04-arm). **publish-orca-server-linux** then, after build-mac has published,
   writes `orca-server-sha256sums.txt` and uploads all three to release `v<fork version>`, as
   upstream's release-cut does (SLRM-2264). Nothing waits on these, so a failure leaves only the
   tarballs missing.
6. **status** (ubuntu-latest) runs after every other job on every run, whatever failed or was
   cancelled, and publishes the sync status (see Sync status).

### Base detection

`fork-sync.sh detect` needs no record. The base is the newest stable upstream tag (`vX.Y.Z`,
version order) whose commit is an ancestor of `main`. The state is `in-sync` when the newest
upstream tag's commit is under `main` and `behind` otherwise, so a tag upstream moved to another
commit counts as new until that commit is merged. If upstream moved the tag `main` is on, no tag
commit is under `main`: the base then comes from `package.json`'s version (a tag merge takes the
tag's version). With neither, the run fails and a tag has to be merged by hand.
`config/scripts/fork/fork-sync.test.mjs` covers a clean merge, a conflict, the `package.json`
version line, a release-only run, a moved tag, a missing base and the version after a merge
against throwaway repos.

### Sync status

Issues are off on the repo, and the app's update check alone only sees that no newer fork
release exists, so the status job publishes each run's outcome where anyone can read it:

- `status.json` on the branch `fork-sync-status` (the workflow env `FORK_SYNC_STATUS_BRANCH`),
  served at `https://raw.githubusercontent.com/<repo>/fork-sync-status/status.json`. Its tree
  holds only `status.json`, so pushing it starts no workflow. Each run adds one
  commit, so the branch is also the sync history. It is pushed with `GITHUB_TOKEN`.
- Fields (`config/scripts/fork/fork-sync-status.mjs`): `schema` (1), `state` (`in-sync`,
  `behind`, `conflict`, `error`), `reason`, `upstreamVersion`, `upstreamSha`,
  `forkBaseVersion`, `forkBaseSha`, `conflicts`, `since` (first run of the current
  not-in-sync streak), `runUrl`, `checkedAt`.
- `error` covers a run that could not read upstream, a main with no upstream tag merged, a failed
  sync job that did not reach the merge, and a failed release build after a good sync.
- The run summary says the same in plain words. A conflict starts with the marker line
  `FORK-SYNC-CONFLICT <tag>` (once, on the first line). For `behind` and `conflict` it gives the
  commands to merge by hand: a branch from `origin/main`, `git merge <tag>`, and a plain push of
  the branch to `main`.
- The app reads it from the URL derived from `FORK_RELEASE_REPO`
  (`src/shared/fork/fork-sync-status.ts`) when Settings, About opens and after each update check
  settles, at most once per 5 minutes, through `net.fetch` in main. It shows one line under the
  update state for `behind`, `conflict` and `error` (upstream version, fork base, since when,
  why, a link to the run), and for a status older than the stale setting. It never blocks a
  check, download or install.
- Settings, Advanced, Fork sync status: `forkSyncNotice` (on by default) and
  `forkSyncNoticeStaleDays` (3 by default, 0 never calls it stale).

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

### Signed merge commits

When the Actions secret `FORK_GIT_SIGNING_KEY` holds an ed25519 SSH private key, the sync job
signs the merge commit with it (the fork commits keep their own signatures):

- Before the merge it writes the key to `$RUNNER_TEMP/git-signing/key` (mode 600), sets
  `gpg.format ssh`, `user.signingkey` and `commit.gpgsign true`, and commits as the author of
  the newest fork commit (the fork owner).
- After the merge the merge commit must show `%G?` = `G` against an allowed-signers file built
  from the key's public half, or the job fails before the push.
- An `always()` step deletes the key and unsets the signing config straight after the merge,
  before `pnpm install` runs any package script.
- Add the public key to the owner's GitHub account as a signing key, so GitHub shows the
  commit as Verified. Keep the private key in Infisical folder `/orca_fork`.
- With the secret empty the job prints a notice and commits unsigned as `github-actions[bot]`.

### Deploy key and tokens

`GITHUB_TOKEN` cannot push commits that change `.github/workflows/`, and upstream changes
those often. So the sync job checks out and pushes over SSH with a write deploy key:

1. Add a deploy key with write access to `saltyfireball/orca`.
2. Store its private key as the Actions secret `FORK_SYNC_DEPLOY_KEY`.

`GITHUB_TOKEN` is still used for the release and workflow API calls and the status branch push.
Its permissions are `contents: write` and `actions: write`.

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

- The merge commit is the only commit CI makes. It is signed only when `FORK_GIT_SIGNING_KEY` is
  set (see Signed merge commits); otherwise it is unsigned and committed by
  `github-actions[bot]`.
- Builds are self-signed, not notarized. On first launch, macOS Gatekeeper asks you to approve
  the app.
