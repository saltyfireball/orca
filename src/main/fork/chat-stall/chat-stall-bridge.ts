// Chat stall (FORK.md): the stalled chats for the renderer, and the row actions. Kept apart from
// chat-stall-service.ts so the host wiring never imports electron. Every action is refused for a
// chat that is not marked stalled now.
import { BrowserWindow, ipcMain } from 'electron'
import {
  FORK_CHAT_STALL_CHANNELS,
  isForkChatStallAction,
  type ForkChatStallEntry
} from '../../../shared/fork/chat-stall'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { forkStopChatTurn } from '../chat-host-turn-stop'
import { forkChatStallMonitor, onForkChatStallChanged } from './chat-stall-service'

const CALLER_KEY = 'trusted-local:fork-chat-stall'

let installed = false

function broadcast(entries: ForkChatStallEntry[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(FORK_CHAT_STALL_CHANNELS.changed, entries)
    }
  }
}

async function act(sessionId: unknown, action: unknown): Promise<boolean> {
  if (typeof sessionId !== 'string' || !isForkChatStallAction(action)) {
    return false
  }
  const monitor = forkChatStallMonitor()
  if (!monitor.entries().some((entry) => entry.sessionId === sessionId)) {
    return false
  }
  if (action !== 'interrupt') {
    return monitor.act(sessionId, action)
  }
  const host = getStructuredAgentSessionHost()
  return host ? forkStopChatTurn(host, sessionId, CALLER_KEY) : false
}

export function installForkChatStallBridge(): void {
  if (installed) {
    return
  }
  installed = true
  onForkChatStallChanged(broadcast)
  ipcMain.handle(FORK_CHAT_STALL_CHANNELS.list, () => forkChatStallMonitor().entries())
  ipcMain.handle(FORK_CHAT_STALL_CHANNELS.act, (_event, sessionId: unknown, action: unknown) =>
    act(sessionId, action).catch(() => false)
  )
}
