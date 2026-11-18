// window.api.forkLetters: the board and a chat's letters (FORK.md "Letters and the board",
// SLRM-2389).
import { ipcRenderer } from 'electron'
import {
  FORK_LETTERS_CHANNELS as CHANNELS,
  type ForkLettersApi
} from '../../shared/fork/letters-wire'

export const forkLettersApi: ForkLettersApi = {
  board: () => ipcRenderer.invoke(CHANNELS.board),
  closeAsk: (request) => ipcRenderer.invoke(CHANNELS.boardClose, request),
  history: (chatId) => ipcRenderer.invoke(CHANNELS.history, chatId),
  onChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
