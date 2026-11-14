// SLRM-2096 (FORK.md "Lost work"): the renderer's IPC for the lost work scan. `installForkLostWork`
// runs from the workspace cleanup handlers' registration (one line) and also hands the store to the
// `fork.lostWork.scan` RPC.
import { ipcMain } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import { abortWhenRendererGone } from '../../ipc/renderer-lifetime-abort'
import {
  LOST_WORK_CHANNELS,
  type LostWorkActionArgs,
  type LostWorkScanArgs,
  type LostWorkScanProgressEvent
} from '../../../shared/fork/lost-work'
import {
  runForkLostWorkAction,
  runForkLostWorkScan,
  setForkLostWorkStore
} from './lost-work-service'

// Module scope keeps a window's running scan cancellable across handler re-registration.
const activeScans = new Map<string, AbortController>()

function isScanId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

export function installForkLostWork(store: Store): void {
  setForkLostWorkStore(store)
  ipcMain.removeHandler(LOST_WORK_CHANNELS.scan)
  ipcMain.removeHandler(LOST_WORK_CHANNELS.cancel)
  ipcMain.removeHandler(LOST_WORK_CHANNELS.act)

  ipcMain.handle(LOST_WORK_CHANNELS.scan, async (event, args: LostWorkScanArgs) => {
    const key = isScanId(args?.scanId) ? `${event.sender.id}\0${args.scanId}` : null
    const controller = new AbortController()
    if (key) {
      activeScans.get(key)?.abort()
      activeScans.set(key, controller)
    }
    const lifetime = abortWhenRendererGone(event.sender)
    lifetime.signal.addEventListener('abort', () => controller.abort(), { once: true })
    const repoIds = Array.isArray(args?.repoIds) ? new Set(args.repoIds) : null
    try {
      return await runForkLostWorkScan(
        store,
        controller.signal,
        repoIds ? (repo) => repoIds.has(repo.id) : undefined,
        // SLRM-2175: the dialog shows projects done of total and each repository's rows as it ends.
        (progress) => {
          if (isScanId(args?.scanId) && !controller.signal.aborted && !event.sender.isDestroyed()) {
            const payload: LostWorkScanProgressEvent = { scanId: args.scanId, ...progress }
            event.sender.send(LOST_WORK_CHANNELS.progress, payload)
          }
        }
      )
    } finally {
      lifetime.dispose()
      if (key && activeScans.get(key) === controller) {
        activeScans.delete(key)
      }
    }
  })

  ipcMain.handle(LOST_WORK_CHANNELS.cancel, (event, scanId: unknown) => {
    const controller = isScanId(scanId) ? activeScans.get(`${event.sender.id}\0${scanId}`) : null
    if (!controller || controller.signal.aborted) {
      return false
    }
    controller.abort()
    return true
  })

  ipcMain.handle(LOST_WORK_CHANNELS.act, (_event, args: LostWorkActionArgs) =>
    runForkLostWorkAction(store, args)
  )
}
