// window.api.forkChatStall: the stalled native chats and their row actions (FORK.md "Chat stall").
import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { FORK_CHAT_STALL_CHANNELS, type ForkChatStallApi } from '../../shared/fork/chat-stall'

export const forkChatStallApi: ForkChatStallApi = {
  list: () => ipcRenderer.invoke(FORK_CHAT_STALL_CHANNELS.list),
  onChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, entries: unknown) => listener(entries)
    ipcRenderer.on(FORK_CHAT_STALL_CHANNELS.changed, handler)
    return () => {
      ipcRenderer.off(FORK_CHAT_STALL_CHANNELS.changed, handler)
    }
  },
  act: (sessionId, action) => ipcRenderer.invoke(FORK_CHAT_STALL_CHANNELS.act, sessionId, action)
}
