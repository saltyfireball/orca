// window.api.forkSyncStatus: the fork-sync workflow's last published status (FORK.md "Sync status").
import { ipcRenderer } from 'electron'
import {
  FORK_SYNC_STATUS_CHANNELS,
  type ForkSyncStatusApi
} from '../../shared/fork/fork-sync-status'

export const forkSyncStatusApi: ForkSyncStatusApi = {
  get: () => ipcRenderer.invoke(FORK_SYNC_STATUS_CHANNELS.get)
}
