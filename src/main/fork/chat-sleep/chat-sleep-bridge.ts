// Chat sleep (FORK.md): the renderer reports which native chats are on screen, so chat sleep
// keeps them awake. Kept apart from chat-sleep-sweep.ts so the host wiring never imports electron.
import { ipcMain } from 'electron'
import { FORK_CHAT_SLEEP_CHANNELS } from '../../../shared/fork/chat-sleep'
import { clearForkChatSleepOnScreen, setForkChatSleepOnScreen } from './chat-sleep-sweep'

let installed = false

export function installForkChatSleepBridge(): void {
  if (installed) {
    return
  }
  installed = true
  const watched = new Set<number>()
  ipcMain.on(FORK_CHAT_SLEEP_CHANNELS.onScreen, (event, ids: unknown) => {
    const sender = event.sender
    const sourceId = sender.id
    setForkChatSleepOnScreen(sourceId, ids)
    if (watched.has(sourceId)) {
      return
    }
    watched.add(sourceId)
    // A reloaded renderer reports again and replaces the list; a closed window never does.
    sender.once('destroyed', () => {
      watched.delete(sourceId)
      clearForkChatSleepOnScreen(sourceId)
    })
  })
}
