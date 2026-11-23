import type { BrowserWindow } from 'electron'
import { mainProcessState as state } from '../main-process-state'
import { startForkRuntimeSettleServices } from '../../fork/runtime-settle-hooks'

// Defer synchronous disk work (95-280ms measured under load) past first-load renderer startup.
export const AGENT_LAUNCH_RECORD_WARMUP_DELAY_MS = 1_500

/** Warm once startup settles and a launch-capable client connects, avoiding first-launch disk cost. */
function markStartupSettled(): void {
  const runtime = state.core.runtime
  runtime?.noteAgentLaunchStartupSettled()
  // Fork (SLRM-2268, SLRM-2309): unattended and limit resume, once per process; orcad calls it too.
  // Called here, not from `orca-runtime.ts`, whose upstream copy is at its line limit.
  if (runtime) {
    startForkRuntimeSettleServices(runtime)
  }
}

function warmLater(): void {
  setTimeout(markStartupSettled, AGENT_LAUNCH_RECORD_WARMUP_DELAY_MS).unref?.()
}

/** Defer until after first load to protect startup and first paint. */
export function scheduleAgentLaunchRecordWarmup(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed() || !window.webContents.isLoading()) {
    warmLater()
    return
  }
  window.webContents.once('did-finish-load', warmLater)
}
