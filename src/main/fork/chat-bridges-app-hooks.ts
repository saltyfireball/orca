// The desktop's chat-side fork IPC bridges, started from one line in src/main/index.ts, which is
// at max-lines (SLRM-2408): the chat stall cue, the "resumes at" labels of chats parked on a usage
// limit (SLRM-2309), the agent guard status line (SLRM-2385) and worker cleanup. See FORK.md.
import { installForkChatStallBridge } from './chat-stall/chat-stall-bridge'
import { installForkLimitResumeBridge } from './limit-resume/limit-resume-bridge'
import { installForkAgentGuardsBridge } from './agent-guards/agent-guards-bridge'
import { installForkWorkerCleanupBridge } from './worker-cleanup/worker-cleanup-bridge'

export function installForkChatBridges(): void {
  installForkChatStallBridge()
  installForkLimitResumeBridge()
  installForkAgentGuardsBridge()
  installForkWorkerCleanupBridge()
}
