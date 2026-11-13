// window.api.forkSyncStatus.get in main (FORK.md "Sync status"). net.fetch follows the app's
// proxy and certificate settings, as the updater's own fetches do. The renderer asks only while
// the notice is on, so switching it off stops the reads.
import { ipcMain, net } from 'electron'
import { FORK_SYNC_STATUS_CHANNELS } from '../../../shared/fork/fork-sync-status'
import { createForkSyncStatusReader } from './sync-status-fetch'

let installed = false

export function installForkSyncStatusBridge(): void {
  if (installed) {
    return
  }
  installed = true
  const read = createForkSyncStatusReader((url, init) => net.fetch(url, init))
  ipcMain.handle(FORK_SYNC_STATUS_CHANNELS.get, () => read())
}
