// window.api.forkWorkerCleanup: worker cleanup's notices, held list and Undo (FORK.md
// "Worker cleanup").
import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  FORK_WORKER_CLEANUP_CHANNELS,
  type ForkWorkerCleanupApi,
  type ForkWorkerCleanupHeld,
  type ForkWorkerCleanupNotice
} from '../../shared/fork/worker-cleanup'

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const forkWorkerCleanupApi: ForkWorkerCleanupApi = {
  onNotice: (listener) =>
    listen<ForkWorkerCleanupNotice>(FORK_WORKER_CLEANUP_CHANNELS.notice, listener),
  onHeld: (listener) =>
    listen<ForkWorkerCleanupHeld[]>(FORK_WORKER_CLEANUP_CHANNELS.held, listener),
  readHeld: () => ipcRenderer.invoke(FORK_WORKER_CLEANUP_CHANNELS.readHeld),
  undo: (noticeId) => ipcRenderer.invoke(FORK_WORKER_CLEANUP_CHANNELS.undo, noticeId)
}
