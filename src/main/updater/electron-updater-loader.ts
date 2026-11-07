import type { autoUpdater as electronUpdaterAutoUpdater } from 'electron-updater'
import { guardForkUpdaterFeed } from './fork/fork-updater-feed-guard'

export type ElectronAutoUpdater = typeof electronUpdaterAutoUpdater

export function loadElectronAutoUpdater(): ElectronAutoUpdater {
  // Loading validates app.getVersion(); defer until packaged-update guards pass.
  return guardForkUpdaterFeed(
    (require('electron-updater') as { autoUpdater: ElectronAutoUpdater }).autoUpdater
  )
}
