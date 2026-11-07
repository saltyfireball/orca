# Chat agents survive an app restart (SLRM-1394)

Status: phases 1-5 built and tested for Claude (the transport, the broker, the spawn hook, the
quit hook and adoption at start), behind `forkChatSurvive`, off by default. Adoption is macOS
only. Codex keeps today's behavior.

## Problem

Terminals survive a restart or an update of Blackfish because their PTYs live in Orca's terminal
daemon (`src/main/daemon/`, its own launchd job). Native chat agents do not. The chain is:

```text
Blackfish main process
  -> provider supervisor   (Electron run as node, ORCA_PROVIDER_SUPERVISOR_SPEC)
     -> claude --output-format stream-json --input-format stream-json ...   (or codex app-server)
```

The supervisor (`src/main/provider-process/provider-process-supervisor.ts`) polls its parent
every 100 ms. When the owner pid goes away it ends the provider's stdin, waits 1 s, then SIGTERMs
and SIGKILLs the provider group. On a normal quit the app gets there first:
`evictOwnedStructuredAgentSessions` (`src/main/native-chat/agent-session-wire/termination/structured-agent-session-host-lifetime.ts`)
stops every child it owns. Either way the running turn, its subagents and any background shell
tasks die. Chat history itself is not lost.

## How a chat runs today

- **Spawn.** Claude chats run through the Claude Agent SDK's `query()`
  (`src/main/claude/claude-stream-json-connection.ts`). Orca passes `spawnClaudeCodeProcess`, so
  Orca spawns the CLI itself through `spawnManagedProviderProcess`
  (`src/main/claude/claude-agent-sdk-process-spawn.ts`) and the SDK only sees a
  `PipedChildProcess`. Permission prompts (`canUseTool`) and user dialogs are SDK callbacks.
  Hooks are command hooks from a settings file, not SDK callback ids. Codex chats speak JSON-RPC
  to `codex app-server` (`src/main/codex/app-server/`). Grok and OpenCode use ACP
  (`src/main/acp/`).
- **Host.** All of them sit behind the structured agent session host
  (`src/main/native-chat/agent-session-wire/host/structured-agent-session-host.ts`), which turns
  provider events into an append-only journal. The renderer never talks to a provider: it calls
  `agentSession.ensure` / `agentSession.attach` and reads with `agentSession.subscribe`, passing a
  journal cursor, and gets a snapshot plus what it missed. **Renderer reattach is already solved;
  the gap is only between the main process and the provider.**
- **Single-writer leases.** Each session record carries a lease (`runtimeFence`, `ownerProcess`
  with pid, start time and spawn token). At start, `agent-session-restart-reconciliation.ts`
  probes every unreconciled lease. A proven-dead owner is evicted with a new fence; a proven-alive
  or unverifiable owner leaves the session `recovering` and refuses a second writer
  (`src/shared/agent-session/lifecycle/agent-session-lease-adjudication.ts`, which fails closed on
  purpose). Today the supervisor always kills the provider, so probes find the pid gone.
- **Quit and the restart offer.** On quit the host cuts the running turn, writes restart
  witnesses and records an offer in `agent-session-recovery.json`
  (`src/main/runtime/agent-session/records/agent-session-recovery-capsule.ts`). On the next start
  the chat offers Resume / Continue, which relaunches the CLI with `--resume <provider session>`.
  That restores the conversation but not the work that was in flight.
- **The terminal daemon** hosts only node-pty sessions. Its replay buffer is a headless terminal
  emulator grid (`sessions/session-output-plane.ts`, 1000 rows) plus durable terminal history, not
  a byte log. Its RPC union (`protocol/daemon-rpc-contract.ts`) has no pipe-process session, and
  every wire change is gated on `PROTOCOL_VERSION` (55 today, `protocol/daemon-protocol-version.ts`)
  with per-version socket names so old daemons keep serving across updates.
- **orcad** (`src/main/orcad/`) is the headless runtime behind `orca serve`, WSL and remote
  servers. It runs the same structured agent session host, so chats on a remote server or in WSL
  already keep running when the desktop disconnects, and the desktop reattaches with
  `agentSession.subscribe` and a cursor. A client-managed orcad stays up while any chat provider
  is loaded (`orcad-managed-idle-exit.ts`, probe `chat-providers`). There is no "local orcad
  as the chat host for this desktop" route: `RuntimeClientTarget` is `local` (in-process) or
  `environment` (a paired runtime). orcad and the desktop take the same `orcad.lock` in one data
  folder, so they cannot share one; `ORCA_USER_DATA` gives orcad its own.
  `src/main/wsl/orcad/__tests__/wsl-orcad-chat-provider-fixture.ts` is only a test lane that installs
  scripted provider CLIs into a WSL guest; it is not a reusable chat provider.

### Measured on this Mac (throwaway processes, stopped by their own pid)

- `claude` 2.1.319 in stream-json mode answers a **second `initialize` control request with
  success**, same command list, no error. A new SDK `query()` can therefore open on an
  already-running CLI.
- `codex app-server` 0.160.0 answers a second `initialize` with
  `{"error":{"code":-32600,"message":"Already initialized"}}`. A reattaching Codex client must skip
  or fake its handshake.

## Options

### (a) Host providers in the terminal daemon

Add a pipe-process session kind to the daemon: spawn without node-pty, keep a byte ring, serve it
through new `createOrAttach`-style RPCs.

- For: the daemon already outlives the app, is a launchd job, and has a careful update story.
- Against: it is upstream's most delicate code (see `src/main/daemon/AGENTS.md`). A new session
  kind means a protocol version bump the fork would carry against every upstream bump, and a
  fork-only `PROTOCOL_VERSION` would clash with upstream's numbering on the next sync. It also
  solves only the transport: the adapter and lease work below is the same.
- Cost: 3-4 weeks, and a large rebase surface forever.

### (b) A per-chat broker that outlives the app (recommended)

Replace the supervisor, for survivable chats, with a broker that does not die with its owner. The
broker owns the provider's pipes, logs stdout and stderr into bounded rings with absolute byte
offsets, and serves them over a private Unix socket to one owner at a time. The owner is
whichever app instance holds the session's lease; its socket closing is "owner gone". The broker
then arms an orphan timer instead of killing the provider. A new app instance says hello with the
token and its lease fence, gets everything after the offsets it persisted, and carries on.

This is option (b) of the brief with two changes: an in-memory ring instead of a spool file (the
ring lives exactly as long as the provider, which is what matters, and leaves nothing to clean up),
and a socket instead of a FIFO (one channel for both directions, a connection close is a reliable
owner-gone signal, and fences decide who may write).

- For: entirely fork-side code plus a few one-line hooks; no daemon protocol change; each chat is
  independent, so one broken broker cannot take others down; works the same for any provider.
- Against: the adoption work (below) touches the quit path, restart reconciliation and the
  Claude/Codex connection open, which are busy upstream files.
- Cost: about 2-3 weeks for Claude and Codex (see Plan).

### (c) Other

- **(c1) Run a local `orca serve` and use it as a paired server.** No code. Start
  `orca serve --bind 127.0.0.1 --pairing-address 127.0.0.1` with its own `ORCA_USER_DATA`, keep it
  up with a launchd job, and pair Blackfish to it (Settings, Remote Orca Servers). Chats and
  terminals on that server survive any Blackfish restart or update, through code upstream already
  tests. The price: projects, managed accounts and settings for that server are separate from the
  desktop's (projects have to be added on the server host), the server runs its own version until
  restarted, and it is a second Orca to update. Worth trying today as a stopgap for long-running
  agent work.
- **(c2) Route every local chat through a fork-managed local orcad.** Make the desktop start a
  hidden orcad and send `agentSession.*` for local chats to it as an environment. Architecturally
  the cleanest end state, but orcad cannot share the desktop's data folder, so it would need its
  own copy of projects and sessions kept in step with the desktop, or a split of the profile. Too
  large for the fork; it is upstream's call.
- **(c3) Only make restarts rarer.** The restart guard (built separately in the restart-guard
  worktree) waits for idle chats before restarting. It complements this; it does not replace it,
  because updates and crashes still kill work.

## Risks and how (b) handles them

- **Two owners.** The broker accepts one owner at a time. A hello must carry a fence at least as
  high as the last accepted one; a higher fence supersedes the current owner (it gets
  `superseded` and is closed), a lower one is refused `stale-fence`. The fence is the session
  lease's `runtimeFence`, so the broker enforces the same single-writer rule as the lease store.
  The token (random, per broker, stored only in the app's data folder) keeps other local
  processes out, and the socket is mode 0600 in a 0700 folder.
- **Orphans when the app is gone for good.** With no owner attached the broker starts its orphan
  timer; at the deadline it SIGTERMs the provider group, SIGKILLs it after the grace, removes its
  socket and exits. The first owner has the same deadline from spawn. Proposed default 60
  minutes, a fork setting. An idle provider costs only memory, so the default can be generous.
- **Permission prompts with no UI.** A `can_use_tool` control request that arrives while no owner
  is attached waits in the ring; the CLI blocks on it and does nothing unsafe. When the next app
  instance replays from its offset, the new SDK `query()` sees the request and calls `canUseTool`,
  so the prompt appears in the chat as usual. If nobody comes back, the orphan timeout ends it.
  Background tasks keep running meanwhile; only the turn that needs an answer waits.
- **Version skew after an update.** Three layers:
  - Broker wire: versioned hello (`CHAT_SURVIVE_PROTOCOL_VERSION`). A mismatch is refused, never
    guessed. A newer app that meets an older broker it cannot speak to falls back to today's path:
    it cannot adopt, so it treats the chat as interrupted and shows the restart offer, and the
    broker's orphan timeout reaps the old provider. (The protocol is small enough to keep
    backward compatible in practice.)
  - Provider protocol: the running CLI is the old one; the new app's SDK opens on it. The SDK's
    stream-json protocol is additive, and the measured second `initialize` works.
  - Broker code on disk: the broker runs Electron-as-node from the old bundle path while Squirrel
    replaces `Blackfish.app`. The binary stays mapped, but late file loads from the old bundle
    would fail. The broker must load nothing lazily (it is dependency-free by design) or run from a
    copy outside the bundle, as the terminal daemon's executable host does.
- **Journal gaps and duplicates.** The host journals by provider message ids. On adoption, replay
  starts from the offset persisted at the last journal flush, so some frames are seen twice; the
  adopter must drop provider items already journaled (Claude messages carry `uuid`) and must not
  write a turn-cut witness for a turn that is in fact still running.
- **The ring overflowing while detached.** A provider that writes more than the ring holds (16
  MiB by default) while nobody is attached loses its oldest bytes. The welcome says `truncated`;
  the adopter then rebuilds from the CLI's own transcript (what Resume reads today) instead of the
  stream, and journals from the stream only from the next turn.
- **Lease probes.** The broker pid becomes the lease's `ownerProcess`, so restart reconciliation
  finds it alive and leaves the session `recovering`, which is exactly the state that blocks a
  second writer. The fork adopter turns `recovering` into a re-acquisition with the next fence.
- **Crash of the broker itself.** Same as today's supervisor dying: the provider's pipes close,
  its next write fails with EPIPE and it most likely exits. Since phase 2 the broker runs
  upstream's supervisor and names itself its owner, so the supervisor stops the provider group
  within 100 ms of the broker dying. The lease probe then finds the pid gone and the restart offer
  appears.
- **Windows.** Out of scope; the fork builds for macOS arm64 only. The broker uses POSIX process
  groups.

## Plan

1. **Transport (done in this commit).** `src/main/fork/chat-survive/`:
   - `chat-survive-byte-ring.ts`: bounded byte log with absolute offsets.
   - `chat-survive-protocol.ts`: versioned line-JSON wire, hello parsing, constant-time token check.
   - `chat-survive-broker.ts`: spawns the provider in its own group, rings, owner fencing, orphan
     timer, stop, exit hand-off, socket cleanup.
   - `chat-survive-client.ts`: owner side; exposes stdout/stderr streams and input calls, the shape
     a spawn hook needs, and the offsets to persist.
   - `chat-survive-broker.test.ts`: reattach with replay, fencing and bad tokens, ring overflow,
     orphan timeout, reattach cancelling the timeout, owner process SIGKILLed (provider keeps
     running and its exit reaches the next owner), owner arriving after exit.
2. **The broker process (done).** `chat-survive-broker-entry.ts` is bundled beside the main
   bundle as `out/main/chat-survive-broker-entry.js` (unpacked from the asar, guarded as a
   plain-Node entry) and runs under `ELECTRON_RUN_AS_NODE`. The app spawns it, detached, in place
   of upstream's provider supervisor, which then runs unchanged under the broker:

       app -> broker -> provider supervisor -> provider

   - `chat-survive-launch.ts` turns a supervisor spawn into the broker spawn: same env, cwd and
     stdio, plus `ORCA_CHAT_SURVIVE_SPEC` (socket path, 64-hex token, owner pid, orphan timeout).
     Sockets live in `$TMPDIR/orca-chat-survive/` (0700, owner checked, path under 104 bytes). Any
     check failing returns null and the caller spawns as today.
   - The broker rewrites the supervisor's `ownerPid` to its own pid, so the provider dies with the
     broker and never with the app. It closes its IPC channel at once, so the app's group guard
     ends unproven and sweeps nothing.
   - While the app lives the broker is a transparent pipe (`directOwner`): stdin, stdout and
     stderr with backpressure, the close request (stdin end) and SIGTERM, SIGINT and SIGHUP reach
     the supervisor as they would directly, and the broker exits with the supervisor's code or
     re-raises its signal, so the app's exit proof and close ladder are unchanged. The broker never
     SIGKILLs the supervisor inside the supervisor's own stop budget.
   - The app is gone when the broker's parent pid changes (100 ms poll). A stdin end counts as a
     close request only if the app is still there 250 ms later; otherwise it is the app dying and
     the broker goes orphan: output goes to the rings and the orphan timer runs (default 60 min).
   - Single writer: a socket hello is refused `busy` while the app that spawned the broker lives.
   - Tests (`chat-survive-broker-entry.test.ts`, real processes via a stand-in app fixture): pipe
     and close request, `busy`, stop by signal, app SIGKILLed then a new owner reattaching with
     replay, broker SIGKILLed taking the provider down; plus the spec and launch-plan checks.
3. **Spawn hook, shipped dark (done).** The fork setting `forkChatSurvive` (optional, off unless
   `true`; Settings > Advanced > Chat survive; read on every spawn, so no restart). One hook in
   `createClaudeCodeProcessSpawn` passes its `spawnImpl` through `forkChatSurviveSpawner`
   (`chat-survive-spawn.ts`): with the setting on, darwin or linux, a provider supervisor spawn,
   a private socket folder and the broker entry on disk, it spawns the broker plan; anything else
   spawns as today. orcad never installs the setting reader, so it is always off there. Each
   broker gets a record `{v, sessionId, brokerPid, socketPath, token}` at
   `userData/chat-survive/<sessionId>.<brokerPid>.json` (folder 0700, file 0600), removed when the
   broker exits; a stale one after a crash names a dead pid and is harmless.
   - The exit-proof ladder needs no change: the managed child (and the lease owner pid) is the
     broker, which relays stdin end and SIGTERM to the supervisor and exits with its code or
     signal. In a forced teardown `killProviderWriter` finds no group-leading direct child (the
     supervisor shares the broker's group), but the descendant snapshot and the root-group kill
     still take the supervisor and the provider down, and the tree reaper proves it.
   - Reconciliation: the spawn-token process scan is Linux only (null on macOS). At the next app
     start, `resolveStructuredSessionRecovery` finds a `recovering` session whose owner (the
     broker, by pid and start time) is alive and stops it (`stopOwnerAndReprobe`: SIGTERM, then
     SIGKILL); the broker stops the supervisor and provider either way. So until phase 5 a
     surviving broker lives only until the next app start (or the orphan timeout), never as a
     second writer.
   - Tests (`chat-survive-spawn.test.ts`): every fallback case spawns the original spec, the
     broker plan and record (modes, removal on exit), record names, and a real Claude-shaped
     provider closed through the broker by `proveClaudeChildExit` with `{root, tree}` exited.
4. **Quit hook (done).** One hook in `evictOwnedStructuredAgentSessions` (quit and update):
   `forkChatSurviveQuit` (`chat-survive-detach.ts`) runs under the session's serialize, before the
   stop. For a `ready` child with no stop under way, whose provider runs under a live broker this
   instance started, with the setting still on, it hands the provider off; otherwise the stop runs
   as today.
   - Watching from the spawn (`chat-survive-registry.ts`, `chat-survive-stream-mark.ts`): every
     broker child is registered by session id. Its stdout is counted alongside the SDK's reader
     (bytes handed to the app, the end of the last whole line) and each line's head is checked
     for a provider `control_request` (kept pending with its line's offset until a
     `control_response` for its id goes in on stdin, or a `control_cancel_request` comes out).
   - Hand-off: the replay mark is `out` = the last whole line, or the earliest pending request
     before it; `seen` = the last whole line; `pending` = the ids. The app says hello on the
     socket with `takeover: true` and the chat's fence (a takeover is the only hello the broker
     accepts while the app that spawned it lives; the fence check comes first), within 1 s. The
     welcome must show no exit, no truncation from `out`, and at least `seen` bytes. Then the
     record is rewritten (whole file, by rename) with `detached: {fence, out, err, seen,
     pending}`, the entry is marked detached and the socket dropped, so the broker arms its orphan
     timer. A failed or late connect returns false (a late one is dropped, and the stop that
     follows signals the broker, which stops the provider); a bad welcome or a failed record write
     sends `stop` and returns false.
   - After a hand-off nothing in this instance signals the broker: `child.kill` does nothing, and
     `forkChatSurviveManaged` (a Proxy on the managed process, the second line of the spawn hook)
     answers `close`, `closeWriter` and `terminateTree` with `live` without signalling. That is
     the truth, so the lease stays held and the adapter's `closeAll` logs that it could not prove
     the child stopped (a teardown failure the quit already tolerates). The session stays in
     `retainOnFailure`, so its journal is not closed under a child that is still live, and its
     stop event, restart witness and shutdown cut are skipped (no resume offer; if the next start
     cannot adopt it, it recovers as crash state).
   - Restart guard: `readBusyChats` passes `chatSurviveWillSurvive`, so a busy Claude chat whose
     provider would be handed off does not hold a quit, restart or update. Codex chats always
     count.
   - The CLI resends unanswered `can_use_tool` prompts in the reply to a second `initialize`
     (`pending_permission_requests`, Claude Code 2.1.268+), which the SDK dispatches; the pending
     ids cover other requests and older CLIs.
   - Tests: the stream mark (split chunks, answers, cancels); the takeover against a live stand-in
     app (its later input and stdin end no longer reach the provider, a lower fence is refused,
     the next owner gets the provider); a real Claude-shaped provider handed off through
     `createClaudeCodeProcessSpawn`, after which the whole exit-proof ladder leaves it running,
     the record holds the mark and the next owner's replay starts at the unanswered request; the
     setting-off and unknown-session fallbacks; the guard filter.
5. **Adopt at start (done).** Two hooks, both in `chat-survive-adopt.ts`.
   - Claim, in `resolveStructuredSessionRecovery`: for a recovering session whose owner is proven
     alive on this host, before the stop, `forkChatSurviveAdopt` reads the record named for the
     session and the owner pid. It must hold a `detached` mark, name this session and exactly
     that pid, and the setting must be on (macOS only: Linux owner probes also read the spawn
     token from the process, which the next lease cannot match). It says hello with the saved
     fence plus one and `from` the saved offsets, within 2 s; the welcome must show the provider
     running, nothing truncated and at least `seen` bytes. Then the claim is held
     (`chat-survive-claims.ts`) and recovery releases the lease without signalling the owner.
     Anything else returns false and recovery stops the owner as before.
   - Start: the host's tab recovery callback goes through `forkChatSurviveRecover`, which starts
     each chat with a held claim (`startStructuredAgentSessionAgentForOperation`), so the
     provider is reattached at once. The spawn hook hands that start the claimed broker as its
     child (`chat-survive-adopted-child.ts`): pid = the broker's (the new lease, exit proof and
     signals name the real process), stdin to the socket (its end is an `end` frame), stdout
     through the replay filter (below `seen` only the still-pending control requests, then
     everything), and `exit`/`close` once the broker reports the provider's exit and the broker
     process is gone. The record is rewritten without the mark, and the child is registered with
     a tracker that continues the saved mark in the broker's offsets, so the chat survives the
     next quit the same way (that hand-off uses a fence above the claim's).
   - Fallbacks: a claim nothing takes within 60 s, or whose start settles without taking it, is
     stopped (today's outcome: the chat resumes from saved history). Until that stop has finished,
     a new provider for the chat is refused (the spawn throws), so there is never a second writer.
     A crash (no quit hook) leaves a record without a mark, which is never adopted.
   - Known gaps: the adopted child has no supervisor report channel, so the provider-group guard
     warns once and does not arm (the broker still stops its group); the SDK's second
     `initialize` meets a CLI already mid-turn, which is supported by the CLI but has not been run
     against a real Claude Code yet.
   - Tests: the replay filter and the continued mark; the recovery hook releases an adopted owner
     without a signal and stops it when the claim fails; a real Claude-shaped provider handed off
     at quit, adopted through `createClaudeCodeProcessSpawn` (same pid, the unanswered request
     replayed, nothing handled replayed, input reaching it), handed off and adopted a second time,
     then ended by stdin end with the broker gone and its record removed; claims refused for an
     undetached record, another pid, Linux, another session, a forged token and the setting off.
6. **Codex** (3-4 days). Same hooks in the app-server connection. Its second `initialize` is
   refused, so the client keeps the first `initialize` answer in the session file and the adopter
   skips the handshake, then re-subscribes to the loaded thread. ACP providers after that.

Estimate: phases 2-5 for Claude about 8-10 working days including tests on the scripted CLI
fixtures (`src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs`); Codex 3-4 more.
Phase 2 adds two build hooks (entry point and plain-Node guard) and one line in the fork's
builder overlay. Phases 3-5 each add one hook in an upstream file, listed in FORK.md as they land.

## Single writer first

Phases 3-5 change who may write to a provider session, the part of Orca that fails closed on
purpose (two writers corrupt a conversation). So every step that is unsure (no plan, a refused or
timed-out hello, a truncated ring, an unreadable record) falls back to today's path, where the
supervisor stops the provider with the app, and the feature ships dark behind `forkChatSurvive`.
