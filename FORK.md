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
- **Agent state colors (SLRM-2106).** Off by default (Settings > Advanced > Agent state colors).
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
  - Settings > Advanced > Lost work (`forkLostWork`): which checks run (all on), the archive
    folder for saves (empty: ask each time), a default branch per project (empty: the remote's
    `HEAD`, then `main`, `master`, `trunk` or `develop`), squash lookback (500 base commits) and the pull request limit
    (200 per project).
  - Code is in `src/main/fork/lost-work/`, `src/renderer/src/fork/lost-work/`,
    `src/shared/fork/lost-work.ts`, `src/preload/fork/lost-work-bridge.ts` and
    `src/cli/fork/lost-work-*`.

- **Sidebar agent rows count their children (SLRM-2095).** A compact agent row shows a small
  `running/total` badge (for example `3/12`) for everything that agent is responsible for, and
  hovering it lists each child by name, kind and state, indented by lineage. Children are:
  orchestration workers the chat dispatched, in any worktree (from the runtime orchestration
  contexts' parent pane, falling back to the parent's terminal handle); the workers those
  workers dispatched, transitively; and each session's own child work, meaning sub-agents and
  background shell tasks or monitors, nested ones included. When a card collapses its agents
  into the icon strip, the strip shows one total for the card, each child counted once.
  Settings > Advanced has three switches, all on by default: show the badge
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
  (`forkChatSleep`, Settings > Advanced). Stock Orca already has an idle sweep for native chats
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
  the rest. Off by default; Settings > Advanced turns it on.
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
  - **Settings** (Settings > Advanced): `forkAgentQueueEnabled` (off), `forkAgentQueueMaxLive`
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
  default (`forkWorkerCleanup`, Settings > Advanced). Stock Orca already closes finished workers:
  when a dispatch settles it arms `auto_release_at` 2 minutes out unless
  `orchestrationWorkerAutoReleaseEnabled` is false (default on), suspends the countdown while
  the agent is in a turn, skips workers marked Keep open (`release_state = 'retained'`), archives
  a terminal worker's output, then closes the pane or stops the chat and hides its tab. It never
  touches the worktree. It does not wait for the coordinator to read the report, ignore open
  questions, notice the worker was used again, check for uncommitted or unpushed work, look at
  merges, or offer Undo. Worker cleanup takes over that release while on:
  - Stock auto-release (and its federated claims) reads as off while `forkWorkerCleanup` is on;
    while off, stock runs exactly as before.
  - A sweep runs every minute over owned workers whose dispatch succeeded or failed and that are
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
  is. Settings > Advanced > Launch defaults sets, per agent, an optional model and effort for
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
  - **Settings** (Settings > Advanced > MCP profiles): `forkMcpProfiles` ([]),
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
  - Settings > Advanced gathers chat sleep, Sleepers, stalled chats, worker cleanup, launch
    queue, launch defaults and memory under one "Agent lifecycle" heading, in that order. Each
    keeps its own section and behavior.
    Code is in `src/main/fork/memory-truth/memory-launch-hold.ts`,
    `src/shared/fork/sleepers-lifecycle.ts`, `src/main/fork/sleepers/sleepers-lifecycle.ts`,
    `src/renderer/src/fork/sleepers/ForkSleepersLifecycleActions.tsx`,
    `src/renderer/src/fork/sleepers/ForkSleepersSetting.tsx` and
    `src/renderer/src/fork/ForkAgentLifecycleSettings.tsx`.

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

`AppRootSurfaces.tsx` carries one hook for the fork's always-mounted hosts: `ForkRootHosts`
(`src/renderer/src/fork/ForkRootHosts.tsx`) renders `ForkChatSleepReporter`,
`ForkWorkerCleanupReporter` and `ForkSleepersDialogHost`. Where a section below says
`AppRootSurfaces.tsx` mounts one of those, it is mounted there.

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
- One element and a `relative` class in `worktree-card-compact-agent-row.tsx` for the row
  tint, and an import, one element and a `relative` class on the strip icon in
  `worktree-card-compact-agents.tsx` for the icon ring (SLRM-1966).
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
  `src/main/index.ts` calls `installForkChatStallBridge()` after the chat sleep bridge;
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
- Custom app themes (SLRM-2097): `useDocumentAppearance`
  (`src/renderer/src/app-shell/use-document-appearance.ts`) calls `useForkCustomAppTheme`, which
  takes precedence over the plugin and Match Terminal paint and does not wait for the plugin
  list, and calls `useForkCustomAppThemeExtras` last for the radius and UI font.
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
- Worker cleanup (SLRM-2100), from `src/main/fork/worker-cleanup/`:
  - `orchestration-database-binding.ts`: `db.workerAutoReleaseEnabled` also requires
    `!forkWorkerCleanupOwnsRelease(settings)`, one `installForkWorkerCleanup(this, this.store)`
    call starts the sweep, and the settings listener rearms the stock scheduler when
    `forkWorkerCleanup` changes too.
  - `WorkerAutoReleaseActivity.apply` calls `noteForkWorkerTurn(paneKey, working)` first, so the
    sweep knows when a worker was used after it reported.
  - `src/main/index.ts` calls `installForkWorkerCleanupBridge()` after
    `installForkChatSleepBridge()`. `src/preload/index.ts` adds `forkWorkerCleanup`
    (`src/preload/fork/worker-cleanup-bridge.ts`) and `api-types.ts` types it as optional.
  - `AppRootSurfaces.tsx` mounts `ForkWorkerCleanupReporter` and `AdvancedPane.tsx` renders
    `ForkWorkerCleanupSetting`. The held mark renders inside the existing `ForkTabTitle` and
    `ForkClaudeAccountAgentRowChip` hooks. The settings are in
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
  - `AdvancedPane.tsx` renders one `ForkAgentLifecycleSettings` in place of the six lifecycle
    settings it rendered (chat sleep, memory, launch queue, chat stall, worker cleanup, launch
    defaults); where a section above says `AdvancedPane.tsx` renders one of those, it renders
    through that group now.
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
    `src/main/startup/cli-command-names.ts` lists `mcp-profile`.
  - `agent-launch-request.ts` and `worker-launch-handler.ts` add `readForkMcpProfileFlag(flags)`
    to their params.
  - `src/main/index.ts` calls `installForkMcpProfilesApp(...)` after the agent queue install.
  - `src/preload/index.ts` adds `forkMcpProfiles` (`src/preload/fork/mcp-profiles-bridge.ts`) and
    `api-types.ts` types it as optional.
  - `NativeChatStructuredSessionStatus.tsx` renders `ForkMcpProfileStrip` after
    `ForkAgentQueueBanner`; `AdvancedPane.tsx` renders `ForkMcpProfileSetting` after
    `ForkAgentQueueSetting`; the five settings are in `fork-global-settings.ts`.

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
