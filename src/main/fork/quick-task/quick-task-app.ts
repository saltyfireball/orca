// Quick task (SLRM-2428, FORK.md): the desktop's side, installed from `installForkReady`. The
// global shortcut follows the settings as they change and is let go at quit; the box's requests
// are taken only from the box window.
import { app, globalShortcut, ipcMain } from 'electron'
import type { ProfilePreferences } from '../../persistence/loading-store/profile-preferences/profile-preferences'
import { mainProcessState } from '../../startup/main-process-state'
import {
  FORK_QUICK_TASK_CHANNELS as CHANNELS,
  readForkQuickTaskConfig
} from '../../../shared/fork/quick-task'
import type { QuickTaskSubmitResult } from '../../../shared/fork/quick-task-contract'
import { forkQuickTaskShortcut } from './quick-task-shortcut'
import { closeQuickTaskWindow, isQuickTaskWindow, toggleQuickTaskWindow } from './quick-task-window'
import { openQuickTaskChat, runtimeQuickTask } from './quick-task-runtime'

function runtime() {
  const value = mainProcessState.runtime
  if (!value) {
    throw new Error('Orca is still starting. Try again in a moment.')
  }
  return value
}

function installIpc(): void {
  ipcMain.handle(CHANNELS.submit, async (event, text: unknown): Promise<QuickTaskSubmitResult> => {
    if (!isQuickTaskWindow(event.sender)) {
      throw new Error('Quick task request refused.')
    }
    return runtimeQuickTask(runtime()).submit({ text, source: 'desktop' })
  })
  ipcMain.handle(CHANNELS.openChat, async (event, chatId: unknown): Promise<void> => {
    if (!isQuickTaskWindow(event.sender) || typeof chatId !== 'string') {
      throw new Error('Quick task request refused.')
    }
    closeQuickTaskWindow()
    const window = mainProcessState.mainWindow
    if (window && !window.isDestroyed()) {
      window.show()
      window.focus()
    }
    await openQuickTaskChat(runtime(), chatId)
  })
  ipcMain.on(CHANNELS.close, (event) => {
    if (isQuickTaskWindow(event.sender)) {
      closeQuickTaskWindow()
    }
  })
}

export function installForkQuickTask(
  store: Pick<ProfilePreferences, 'getSettings' | 'onSettingsChanged'>
): void {
  installIpc()
  const shortcut = forkQuickTaskShortcut(globalShortcut, toggleQuickTaskWindow)
  shortcut.apply(store.getSettings())
  store.onSettingsChanged((updates, settings) => {
    if (Object.keys(updates).some((key) => key.startsWith('forkQuickTask'))) {
      shortcut.apply(settings)
      if (!readForkQuickTaskConfig(settings).enabled) {
        closeQuickTaskWindow()
      }
    }
  })
  app.on('will-quit', () => shortcut.dispose())
}
