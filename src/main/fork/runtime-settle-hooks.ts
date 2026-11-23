// The fork services that start once the runtime settles, in the desktop app and `orca serve`
// (`markStartupSettled` in `agent-launch-record-warmup.ts`) and in orcad
// (`core-runtime-activation.ts`). One call per upstream file keeps each hook one line.
import {
  startForkLimitResume,
  type LimitResumeServiceRuntime
} from './limit-resume/limit-resume-service'
import { startForkServerUpdate, type ForkServersRuntime } from './server-update/servers-live'
import {
  startForkWorktreePorts,
  type ForkWorktreePortsRuntime
} from './worktree-ports/worktree-ports-service'
import { startForkTurnCheckpoints } from './turn-checkpoints/turn-checkpoint-live'
import {
  installForkWorkspaceFolders,
  type ForkWorkspaceFolderRuntime
} from './workspace-folder/workspace-folder-path'
import { startForkAgentGuards } from './agent-guards/agent-guards-service'
import {
  startForkCommandGuards,
  type ForkCommandGuardsRuntime
} from './command-guards/command-guards-live'
import { startForkMainSync, type ForkMainSyncRuntime } from './main-sync/main-sync-live'
import { startForkChatHandoffOnLimit } from './chat-handoff/chat-handoff-on-limit'
import type { ChatHandoffRuntime } from './chat-handoff/chat-handoff-host'
import { startForkDigest, type ForkDigestRuntime } from './digest/digest-runtime'
import { startForkLetters } from './letters/letters-runner'
import type { ForkLettersRuntime } from './letters/letters-deps'
import { startForkGoalLoop } from './goal-loop/goal-live'
import type { GoalLoopRuntime } from './goal-loop/goal-service'
import {
  startForkWorktreeSnapshotPrune,
  type ForkSnapshotPruneRuntime
} from './worktree-snapshots/worktree-snapshot-prune'

export function startForkRuntimeSettleServices(
  runtime: LimitResumeServiceRuntime &
    ForkServersRuntime &
    ForkWorktreePortsRuntime &
    ForkMainSyncRuntime &
    ForkCommandGuardsRuntime &
    ForkWorkspaceFolderRuntime &
    ChatHandoffRuntime &
    ForkDigestRuntime &
    ForkLettersRuntime &
    GoalLoopRuntime &
    ForkSnapshotPruneRuntime
): void {
  // SLRM-2309: park chats and terminal agents stopped on a usage limit, resume at the reset.
  startForkLimitResume(runtime)
  // SLRM-2310: settle this host's own update (the watchdog waits on it); auto-update servers.
  startForkServerUpdate(runtime)
  // SLRM-2383: release port blocks of workspaces gone while closed, then follow removals.
  void startForkWorktreePorts(runtime)
  // BAD-678: folder workspaces resolve to their folder for checkpoints and command guards.
  installForkWorkspaceFolders(runtime)
  // BAD-678: checkpoint workspace files at the end of each agent turn.
  startForkTurnCheckpoints()
  // SLRM-2385: warn and pause agents stuck in a failure loop or past their spend cap.
  startForkAgentGuards(runtime)
  // BAD-686: deny destructive shell commands of agents whose hook can block a call.
  startForkCommandGuards(runtime)
  // SLRM-2384: fetch and fast-forward each local project's default branch, when on.
  startForkMainSync(runtime)
  // SLRM-2391: hand a chat parked on a usage limit to the other agent, when set to 'auto'.
  startForkChatHandoffOnLimit(runtime)
  // SLRM-2388: send the daily digest when forkDigest is on.
  startForkDigest(runtime)
  // SLRM-2389: deliver letters a restart left queued, and collect answers from paired servers.
  startForkLetters(runtime)
  // BAD-682: keep an agent going until its goal's check or judge passes, when a goal is set.
  startForkGoalLoop(runtime)
  // BAD-767: prune expired worktree snapshots on a timer, not only when another is taken.
  startForkWorktreeSnapshotPrune(runtime)
}
