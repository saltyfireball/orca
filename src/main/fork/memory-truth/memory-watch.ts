// SLRM-2099: Electron side of the memory warning. A light background check of system memory
// (vm_stat + sysctl on macOS, /proc reads on Linux; no process sweep) on the poll interval, one
// notification per time over the threshold, and the status pushed to the windows.
import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import {
  FORK_MEMORY_CHANNELS,
  type ForkMemoryGlobalSettings,
  type ForkMemoryStatus
} from '../../../shared/fork/memory-truth'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { translateMain } from '../../i18n/main-i18n'
import { installForkChatRecordSource } from './chat-roots'
import { installForkMemoryLaunchHold } from './memory-launch-hold'
import {
  createForkMemoryEpisode,
  forkMemoryNotificationText,
  shouldNotifyForkMemory
} from './episode'
import {
  emitForkMemoryStatus,
  forkMemorySettings,
  forkMemoryStatus,
  installForkMemorySettingsReader,
  onForkMemoryStatus,
  sampleForkSystemMemory
} from './pressure-state'

let installed = false
let timer: ReturnType<typeof setTimeout> | null = null
let lastPushed = ''

function push(status: ForkMemoryStatus): void {
  // Pushed on every sample; skip windows when nothing they show changed.
  const key = JSON.stringify([
    status.over,
    status.reasons,
    status.launchesPaused,
    status.launchesHeld,
    status.settings
  ])
  const sampleKey = JSON.stringify([status.system?.pressure, status.system?.swapUsed])
  if (`${key}${sampleKey}` === lastPushed) {
    return
  }
  lastPushed = `${key}${sampleKey}`
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(FORK_MEMORY_CHANNELS.changed, status)
    }
  }
}

function notify(status: ForkMemoryStatus): void {
  if (!Notification.isSupported()) {
    return
  }
  const text = forkMemoryNotificationText(status, (key, fallback, values) =>
    translateMain(key, fallback, values)
  )
  new Notification({ title: text.title, body: text.body }).show()
}

function schedule(): void {
  timer = setTimeout(() => {
    void sampleForkSystemMemory()
      .catch((err) => console.warn('[memory] system sample failed', err))
      .finally(schedule)
  }, forkMemorySettings().pollSeconds * 1000)
  timer.unref?.()
}

export function installForkMemoryWatch(
  readSettings: () => ForkMemoryGlobalSettings | null | undefined
): void {
  if (installed) {
    return
  }
  installed = true
  installForkMemorySettingsReader(readSettings)
  installForkMemoryLaunchHold()
  installForkChatRecordSource(() => {
    const host = getStructuredAgentSessionHost()
    const store = host?.deps.store
    return { hostId: store?.hostId ?? null, records: store?.listRecords() ?? [] }
  })
  const episode = createForkMemoryEpisode()
  onForkMemoryStatus((status) => {
    if (shouldNotifyForkMemory(episode, status)) {
      notify(status)
    }
    push(status)
  })
  ipcMain.handle(FORK_MEMORY_CHANNELS.get, async () => {
    await sampleForkSystemMemory().catch(() => null)
    // The renderer asks after a settings save, so re-judge (and maybe notify) with the new values.
    emitForkMemoryStatus()
    return forkMemoryStatus()
  })
  // Installed before ready (no settings yet means defaults); the first notification can only
  // come once the app is up.
  void app.whenReady().then(() => {
    void sampleForkSystemMemory().catch(() => null)
    schedule()
  })
}
