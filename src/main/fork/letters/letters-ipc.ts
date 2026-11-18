// Letters and the board (FORK.md, SLRM-2389): the desktop window's side. Reads the board and a
// chat's letters, and takes Done and Throw back from the main window only. Tells the window when
// this host's letters or asks change; a paired server's are read again on the window's own poll.
import { ipcMain } from 'electron'
import { FORK_LETTERS_CHANNELS as CHANNELS } from '../../../shared/fork/letters-wire'
import { mainProcessState } from '../../startup/main-process-state'
import { liveForkLetters } from './letters-deps'
import { closeForkBoardAskFromWindow, forkBoardView, forkLettersHistory } from './letters-view'

function mainWindowContents(): Electron.WebContents | null {
  const window = mainProcessState.mainWindow
  return window && !window.isDestroyed() ? window.webContents : null
}

/** Main-process start-up hook. */
export function installForkLettersApp(): void {
  const deps = liveForkLetters()
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    event.sender === mainWindowContents()
  const refused = { now: Date.now(), unreachable: [] }
  ipcMain.handle(CHANNELS.board, (event) =>
    fromMainWindow(event) ? forkBoardView(deps) : { ...refused, asks: [] }
  )
  ipcMain.handle(CHANNELS.history, (event, chatId: unknown) =>
    fromMainWindow(event)
      ? forkLettersHistory(deps, typeof chatId === 'string' && chatId ? chatId.slice(0, 512) : null)
      : { ...refused, letters: [] }
  )
  ipcMain.handle(CHANNELS.boardClose, async (event, request: unknown) => {
    const value = (request ?? {}) as Record<string, unknown>
    const action = value.action === 'done' || value.action === 'back' ? value.action : null
    if (!fromMainWindow(event) || typeof value.id !== 'string' || !action) {
      return { ok: false, error: 'Not allowed.' }
    }
    return closeForkBoardAskFromWindow(deps, {
      id: value.id.slice(0, 512),
      action,
      environmentId:
        typeof value.environmentId === 'string' && value.environmentId
          ? value.environmentId.slice(0, 200)
          : null,
      ...(typeof value.note === 'string' ? { note: value.note.slice(0, 4000) } : {})
    })
  })
  deps.store.onChanged(() => {
    mainWindowContents()?.send(CHANNELS.changed)
  })
}
