// Quick task (SLRM-2428, FORK.md): the box. A small frameless window, centered on the display
// under the pointer, above every other window. On macOS it is a non-activating panel, so the
// shortcut opens it over another app without bringing Blackfish's main window forward. It has the
// main preload (for dictation and its own bridge), its own session, and only microphone access.
import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import { join } from 'node:path'
import { installPrivilegedWindowNavigationPolicy } from '../../window/security/privileged-window-navigation'
import {
  hasSystemMediaAccess,
  requestSystemMediaAccess
} from '../../browser/site-settings/permissions/browser-media-access'
import { FORK_QUICK_TASK_CHANNELS } from '../../../shared/fork/quick-task'
import { installQuickTaskEditKeys } from './quick-task-edit-keys'

const WIDTH = 620
const HEIGHT = 168
const PARTITION = 'blackfish-quick-task'

let box: BrowserWindow | null = null

function live(): BrowserWindow | null {
  return box && !box.isDestroyed() ? box : null
}

export function isQuickTaskWindow(sender: Electron.WebContents): boolean {
  return live()?.webContents === sender
}

/** Centered on the display the pointer is on, a third of the way down. */
function placement(): { x: number; y: number } {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return {
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + area.height / 3 - HEIGHT / 2)
  }
}

function create(): BrowserWindow {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    ...placement(),
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
    title: 'Quick task',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      partition: PARTITION,
      webviewTag: false
    }
  })
  window.setAlwaysOnTop(true, 'floating')
  installPrivilegedWindowNavigationPolicy(window.webContents)
  installQuickTaskEditKeys(window.webContents)
  // The microphone for dictation, nothing else. The system's microphone prompt takes focus, so
  // the box stays open while it is up and takes focus back after.
  let asking = false
  window.webContents.session.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      if (permission !== 'media') {
        callback(false)
        return
      }
      asking = true
      void requestSystemMediaAccess(details)
        .then(callback, () => callback(false))
        .finally(() => {
          asking = false
          if (!window.isDestroyed()) {
            window.focus()
          }
        })
    }
  )
  window.webContents.session.setPermissionCheckHandler(
    (_contents, permission, _origin, details) =>
      permission === 'media' && hasSystemMediaAccess(details?.mediaType)
  )
  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })
  // Like a launcher: clicking anywhere else puts it away.
  window.on('blur', () => {
    if (!asking) {
      window.close()
    }
  })
  window.on('closed', () => {
    if (box === window) {
      box = null
    }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-task.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/quick-task.html'))
  }
  return window
}

/** The shortcut: opens the box, or closes it when it is already in front. */
export function toggleQuickTaskWindow(): void {
  const open = live()
  if (open?.isFocused()) {
    open.close()
    return
  }
  if (open) {
    const at = placement()
    open.setPosition(at.x, at.y)
    open.show()
    open.focus()
    open.webContents.send(FORK_QUICK_TASK_CHANNELS.shown)
    return
  }
  box = create()
}

export function closeQuickTaskWindow(): void {
  live()?.close()
}
