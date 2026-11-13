// SLRM-2099: the latest system memory sample and what the warning settings make of it. No Electron
// here: the memory collector and the launch gates read it, and both also run outside Electron.
import {
  buildForkMemoryStatus,
  resolveForkMemorySettings,
  type ForkMemoryGlobalSettings,
  type ForkMemorySettings,
  type ForkMemoryStatus,
  type ForkSystemMemory
} from '../../../shared/fork/memory-truth'
import { readForkSystemMemory } from './system-memory'

/** A sample this fresh is reused instead of spawning vm_stat/sysctl again. */
export const FORK_SYSTEM_SAMPLE_REUSE_MS = 2_000

let readSettings: () => ForkMemoryGlobalSettings | null | undefined = () => null
let latest: ForkSystemMemory | null = null
let inflight: Promise<ForkSystemMemory> | null = null
let reader: () => Promise<ForkSystemMemory> = () => readForkSystemMemory()
const listeners = new Set<(status: ForkMemoryStatus) => void>()

export function installForkMemorySettingsReader(
  next: () => ForkMemoryGlobalSettings | null | undefined
): void {
  readSettings = next
}

/** Tests swap the OS read for a fake. */
export function setForkSystemMemoryReaderForTests(
  next: (() => Promise<ForkSystemMemory>) | null
): void {
  reader = next ?? (() => readForkSystemMemory())
  latest = null
  inflight = null
}

export function forkMemorySettings(): ForkMemorySettings {
  try {
    return resolveForkMemorySettings(readSettings())
  } catch {
    return resolveForkMemorySettings(null)
  }
}

export function forkMemoryStatus(): ForkMemoryStatus {
  return buildForkMemoryStatus(latest, forkMemorySettings())
}

/** Main-process check: is system memory past the warning threshold right now (last sample)? */
export function isMemoryOverLaunchThreshold(): boolean {
  return forkMemoryStatus().over
}

/** True only when over the threshold and the user turned on pausing new agent launches. */
export function areForkAgentLaunchesPaused(): boolean {
  return forkMemoryStatus().launchesPaused
}

export const FORK_MEMORY_LAUNCH_PAUSED_MESSAGE =
  'New agents are paused: system memory is past the warning threshold. Close some sessions, ' +
  'or turn off "Pause new agents" in Settings > Advanced > Memory.'

/** Throw before a launch when paused; the message says why and how to undo it. */
export function assertForkAgentLaunchAllowed(): void {
  if (areForkAgentLaunchesPaused()) {
    throw new Error(FORK_MEMORY_LAUNCH_PAUSED_MESSAGE)
  }
}

export function onForkMemoryStatus(listener: (status: ForkMemoryStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tell listeners the status may have changed (a new sample, or settings edited). */
export function emitForkMemoryStatus(): void {
  const status = forkMemoryStatus()
  for (const listener of listeners) {
    try {
      listener(status)
    } catch (err) {
      console.warn('[memory] status listener failed', err)
    }
  }
}

/** Take a system sample (or reuse one under 2 s old) and publish it. */
export async function sampleForkSystemMemory(now = Date.now()): Promise<ForkSystemMemory> {
  if (latest && now - latest.sampledAt < FORK_SYSTEM_SAMPLE_REUSE_MS) {
    return latest
  }
  if (!inflight) {
    inflight = reader()
      .then((sample) => {
        latest = sample
        emitForkMemoryStatus()
        return sample
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}
