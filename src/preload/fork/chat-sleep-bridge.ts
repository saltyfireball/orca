// window.api.forkChatSleep: the renderer's on-screen native chats for chat sleep (FORK.md
// "Chat sleep").
import { ipcRenderer } from 'electron'
import { FORK_CHAT_SLEEP_CHANNELS, type ForkChatSleepApi } from '../../shared/fork/chat-sleep'

export const forkChatSleepApi: ForkChatSleepApi = {
  setOnScreen: (sessionIds) => ipcRenderer.send(FORK_CHAT_SLEEP_CHANNELS.onScreen, sessionIds)
}
