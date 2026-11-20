// window.api.forkIdleRecovery (FORK.md "Idle recovery"), item E2: the Decision inbox's calls
// to the main process. Contract: one invoke per `FORK_IDLE_RECOVERY_CHANNELS` entry and the
// change event; no logic here.
import { ipcRenderer } from 'electron'
import {
  FORK_IDLE_RECOVERY_CHANNELS as CHANNELS,
  type ForkIdleRecoveryApi
} from '../../shared/fork/idle-recovery-wire'

export const forkIdleRecoveryApi: ForkIdleRecoveryApi = {
  inbox: () => ipcRenderer.invoke(CHANNELS.inbox),
  answer: (request) => ipcRenderer.invoke(CHANNELS.answer, request),
  pause: (request) => ipcRenderer.invoke(CHANNELS.pause, request),
  status: () => ipcRenderer.invoke(CHANNELS.status),
  babysit: () => ipcRenderer.invoke(CHANNELS.babysit),
  reportBotAsks: (request) => ipcRenderer.invoke(CHANNELS.botAsks, request),
  onChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(CHANNELS.changed, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.changed, handler)
    }
  }
}
