import { orchestrationDbFile } from '../../orchestration/db/orchestration-db-file'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { OrcaRuntimeWithPtyForegroundProcessReads } from '../../client/runtime-client-state'
import { getWorkerTerminalAutoReleaseScheduler } from '../../orchestration/terminal-authority/release/worker-terminal-auto-release-scheduler'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import {
  forkWorkerCleanupOwnsRelease,
  installForkWorkerCleanup
} from '../../../fork/worker-cleanup/worker-cleanup-service'

// Keyed by runtime, not a field: the database can open while the runtime is still constructing.
const runtimesWatchingAutoReleaseSetting = new WeakSet<object>()

export abstract class OrcaRuntimeWithOrchestrationDatabaseBinding extends OrcaRuntimeWithPtyForegroundProcessReads {
  protected orchestrationDbPath(): string {
    return orchestrationDbFile(getAppEnvironment().getPath('userData'))
  }

  protected bindWorkerTerminalAutoRelease(db: OrchestrationDb): void {
    db.workerTerminalAutoReleaseListener = () => {
      if (this._orchestrationDb === db) {
        getWorkerTerminalAutoReleaseScheduler(this).rearm()
      }
    }
    // Fork worker cleanup takes over finished workers while its setting is on (FORK.md).
    db.workerAutoReleaseEnabled = () =>
      this.store?.getSettings?.()?.orchestrationWorkerAutoReleaseEnabled !== false &&
      !forkWorkerCleanupOwnsRelease(this.store?.getSettings?.())
    installForkWorkerCleanup(this, this.store)
    if (this.store?.onSettingsChanged && !runtimesWatchingAutoReleaseSetting.has(this)) {
      runtimesWatchingAutoReleaseSetting.add(this)
      // Turning the setting off drops the timer; turning it on finds the deadlines still due.
      this.store.onSettingsChanged((updates) => {
        const watched =
          'orchestrationWorkerAutoReleaseEnabled' in updates || 'forkWorkerCleanup' in updates
        if (watched && this._orchestrationDb) {
          getWorkerTerminalAutoReleaseScheduler(this).rearm()
        }
      })
    }
  }
}
