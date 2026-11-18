// The fork services that start once the runtime settles, in the desktop app and `orca serve`
// (`noteAgentLaunchStartupSettled` in `orca-runtime.ts`) and in orcad
// (`core-runtime-activation.ts`). One call per upstream file keeps each hook one line.
import {
  startForkUnattendedResume,
  type UnattendedResumeRuntime
} from './unattended-resume/unattended-resume-service'
import {
  startForkLimitResume,
  type LimitResumeServiceRuntime
} from './limit-resume/limit-resume-service'
import { startForkServerUpdate, type ForkServersRuntime } from './server-update/servers-live'
import {
  startForkWorktreePorts,
  type ForkWorktreePortsRuntime
} from './worktree-ports/worktree-ports-service'
import { startForkMainSync, type ForkMainSyncRuntime } from './main-sync/main-sync-live'
import { startForkAgentGuards } from './agent-guards/agent-guards-service'
import { startForkChatHandoffOnLimit } from './chat-handoff/chat-handoff-on-limit'
import type { ChatHandoffRuntime } from './chat-handoff/chat-handoff-host'
import { startForkLetters } from './letters/letters-runner'
import type { ForkLettersRuntime } from './letters/letters-deps'
import { startForkDigest, type ForkDigestRuntime } from './digest/digest-runtime'

export function startForkRuntimeSettleServices(
  runtime: UnattendedResumeRuntime &
    LimitResumeServiceRuntime &
    ForkServersRuntime &
    ForkWorktreePortsRuntime
    ForkMainSyncRuntime,
    ChatHandoffRuntime,
    ForkWorktreePortsRuntime &
    ForkMainSyncRuntime &
    ChatHandoffRuntime &
    ForkLettersRuntime,
    ForkDigestRuntime
): void {
  // SLRM-2268: continue cut unattended work once per process.
  startForkUnattendedResume(runtime)
  // SLRM-2309: park chats and terminal agents stopped on a usage limit, resume at the reset.
  startForkLimitResume(runtime)
  // SLRM-2310: settle this host's own update (the watchdog waits on it); auto-update servers.
  startForkServerUpdate(runtime)
  // SLRM-2383: release port blocks of workspaces gone while closed, then follow removals.
  void startForkWorktreePorts(runtime)
  // SLRM-2384: fetch and fast-forward each local project's default branch, when on.
  startForkMainSync(runtime)
  // SLRM-2385: warn and pause agents stuck in a failure loop or past their spend cap.
  startForkAgentGuards(runtime)
  // SLRM-2391: hand a chat parked on a usage limit to the other agent, when set to 'auto'.
  startForkChatHandoffOnLimit(runtime)
  // SLRM-2389: deliver letters a restart left queued, and collect answers from paired servers.
  startForkLetters(runtime)
  // SLRM-2388: send the daily digest when forkDigest is on.
  startForkDigest(runtime)
}
