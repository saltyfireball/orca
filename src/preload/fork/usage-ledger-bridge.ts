// window.api.forkUsageLedger: prompt cache states for the cache-cold cue (FORK.md "Usage ledger
// and cache-cold cue", SLRM-2103).
import { ipcRenderer } from 'electron'
import {
  FORK_USAGE_LEDGER_CHANNELS as CHANNELS,
  type ForkCacheState,
  type ForkUsageLedgerApi
} from '../../shared/fork/usage-ledger'

export const forkUsageLedgerApi: ForkUsageLedgerApi = {
  cacheStates: () => ipcRenderer.invoke(CHANNELS.cacheStates),
  onCacheChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, states: ForkCacheState[]) =>
      callback(states)
    ipcRenderer.on(CHANNELS.cacheChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.cacheChanged, listener)
  },
  // SLRM-2104 (FORK.md "Usage and cost report").
  report: (params) => ipcRenderer.invoke(CHANNELS.report, params),
  clear: () => ipcRenderer.invoke(CHANNELS.clear),
  defaultPrices: () => ipcRenderer.invoke(CHANNELS.defaultPrices)
}
